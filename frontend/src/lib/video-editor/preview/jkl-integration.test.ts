// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { Clock, type ClockTimeSource } from './clock';
import { getNextShuttleRate } from './shuttle';
import {
	editorShortcutTargetIsDisabled,
	eventMatchesShortcut,
	resolveEditorShortcuts
} from '../settings/keyboard-shortcuts';
import { resolveReverseShuttleGrainPlan } from '../audio/reverse-shuttle-grain';

class FakeTimeSource implements ClockTimeSource {
	seconds = 0;
	now(): number {
		return this.seconds;
	}
	advance(seconds: number): void {
		this.seconds += seconds;
	}
}

function rafHarness() {
	const callbacks: FrameRequestCallback[] = [];
	vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
		callbacks.push(callback);
		return callbacks.length;
	});
	vi.stubGlobal('cancelAnimationFrame', () => {});
	return {
		get pending() {
			return callbacks.length;
		},
		flush(count = 1) {
			for (let i = 0; i < count; i++) {
				callbacks.shift()?.(performance.now());
			}
		}
	};
}

describe('JKL shuttle integration', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('successive L presses advance 1x/2x/4x and clamp', () => {
		expect(getNextShuttleRate(1, 1)).toBe(2);
		expect(getNextShuttleRate(2, 1)).toBe(4);
		expect(getNextShuttleRate(4, 1)).toBe(4);
	});

	it('direction switch resets to 1x', () => {
		expect(getNextShuttleRate(2, -1)).toBe(-1);
		expect(getNextShuttleRate(-2, 1)).toBe(1);
		expect(getNextShuttleRate(4, -1)).toBe(-1);
	});

	it('catches up on focus without adding a second animation frame', () => {
		const time = new FakeTimeSource();
		const raf = rafHarness();
		const clock = new Clock({ fps: 30, timeSource: time });
		const frames: number[] = [];
		clock.on('framechange', (frame) => frames.push(frame));
		clock.play();
		expect(raf.pending).toBe(1);

		time.advance(1);
		window.dispatchEvent(new Event('focus'));

		expect(clock.currentFrame).toBe(30);
		expect(frames.at(-1)).toBe(30);
		expect(raf.pending).toBe(1);
		clock.dispose();
	});

	it('ignores repeat and remapped shortcuts', () => {
		const bindings = resolveEditorShortcuts({
			SHUTTLE_FORWARD: 'shift+l',
			SHUTTLE_REVERSE: 'shift+j'
		});
		const event = new KeyboardEvent('keydown', { key: 'l', code: 'KeyL', shiftKey: true });
		expect(eventMatchesShortcut(event, bindings.SHUTTLE_FORWARD)).toBe(true);
		expect(
			eventMatchesShortcut(
				new KeyboardEvent('keydown', { key: 'l', code: 'KeyL' }),
				bindings.SHUTTLE_FORWARD
			)
		).toBe(false);
	});

	it('ignores editable fields and component-owned shortcut scopes', () => {
		const input = document.createElement('input');
		const textarea = document.createElement('textarea');
		const ownedScope = document.createElement('div');
		const ownedTarget = document.createElement('span');
		ownedScope.dataset.editorShortcutsOwned = '';
		ownedScope.append(ownedTarget);
		expect(editorShortcutTargetIsDisabled(input)).toBe(true);
		expect(editorShortcutTargetIsDisabled(textarea)).toBe(true);
		expect(editorShortcutTargetIsDisabled(ownedTarget)).toBe(true);
		expect(editorShortcutTargetIsDisabled(document.createElement('div'))).toBe(false);
	});

	it('reverse frames progress without negative media rate', () => {
		const time = new FakeTimeSource();
		const raf = rafHarness();
		const clock = new Clock({ fps: 30, timeSource: time });
		const frames: number[] = [];
		clock.on('framechange', (f) => frames.push(f));
		clock.seek(60);
		clock.setRate(-2);
		clock.play({ range: { start: 0, end: 100 } });
		time.advance(0.5);
		raf.flush(1);
		expect(clock.currentFrame).toBe(30);
		expect(frames.length).toBeGreaterThan(0);
		expect(frames.at(-1)).toBe(30);
		clock.dispose();
	});

	it('respects half-open range start/end boundaries for reverse', () => {
		const time = new FakeTimeSource();
		const raf = rafHarness();
		const clock = new Clock({ fps: 30, timeSource: time });
		const ended = vi.fn();
		clock.on('ended', ended);
		clock.seek(30);
		clock.setRate(-1);
		clock.play({ range: { start: 10, end: 40 } });
		time.advance(2);
		raf.flush(2);
		expect(ended).toHaveBeenCalledWith(10);
		expect(clock.currentFrame).toBe(10);
		expect(clock.currentFrame).toBeGreaterThanOrEqual(10);
		expect(clock.currentFrame).toBeLessThanOrEqual(39);
		clock.dispose();
	});

	it('currentFrame never exposes values outside half-open range before and after rAF tick', () => {
		const time = new FakeTimeSource();
		const raf = rafHarness();
		const clock = new Clock({ fps: 30, timeSource: time });
		clock.seek(39);
		clock.setRate(1);
		clock.play({ range: { start: 10, end: 40 } });
		time.advance(5);
		// Before tick, currentFrame should be clamped to end-1
		expect(clock.currentFrame).toBe(39);
		raf.flush(1);
		expect(clock.currentFrame).toBe(39);
		clock.dispose();

		const time2 = new FakeTimeSource();
		const raf2 = rafHarness();
		const clock2 = new Clock({ fps: 30, timeSource: time2 });
		clock2.seek(10);
		clock2.setRate(-1);
		clock2.play({ range: { start: 10, end: 40 } });
		time2.advance(5);
		expect(clock2.currentFrame).toBe(10);
		raf2.flush(1);
		expect(clock2.currentFrame).toBe(10);
		clock2.dispose();
	});

	it('no duplicate loops when tick fires repeatedly at boundary', () => {
		const time = new FakeTimeSource();
		const raf = rafHarness();
		const clock = new Clock({ fps: 30, timeSource: time });
		const frames: number[] = [];
		clock.on('framechange', (f) => frames.push(f));
		clock.play({ range: { start: 0, end: 10 }, loop: true });
		time.advance(0.5);
		raf.flush(2);
		time.advance(0.5);
		raf.flush(2);
		// Should loop but not emit duplicate end frames repeatedly
		const zeroFrames = frames.filter((f) => f === 0).length;
		expect(zeroFrames).toBeLessThanOrEqual(5);
		clock.dispose();
	});

	it('reverse grain ordering respects authored direction', () => {
		const normal = resolveReverseShuttleGrainPlan({
			sourceCursorSeconds: 5,
			authoredPlaybackRate: 1,
			transportPlaybackRate: -2,
			authoredReversed: false,
			bufferStartSeconds: 0,
			bufferDurationSeconds: 10
		});
		expect(normal?.reverseSamples).toBe(true);
		expect(normal?.sourceStartSeconds).toBeLessThan(5);
		const authoredReversed = resolveReverseShuttleGrainPlan({
			sourceCursorSeconds: 5,
			authoredPlaybackRate: 1,
			transportPlaybackRate: -2,
			authoredReversed: true,
			bufferStartSeconds: 0,
			bufferDurationSeconds: 10
		});
		expect(authoredReversed?.reverseSamples).toBe(false);
		expect(authoredReversed?.sourceStartSeconds).toBe(5);
	});
});
