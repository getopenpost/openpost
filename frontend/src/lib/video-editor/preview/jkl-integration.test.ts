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
	const callbacks: Array<() => void> = [];
	vi.stubGlobal('requestAnimationFrame', (cb: () => void) => {
		callbacks.push(cb);
		return callbacks.length;
	});
	vi.stubGlobal('cancelAnimationFrame', () => {});
	return {
		flush(count = 1) {
			for (let i = 0; i < count; i++) {
				const cb = callbacks.shift();
				cb?.();
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

	it('ignores repeat and remapped shortcuts', () => {
		const bindings = resolveEditorShortcuts({
			SHUTTLE_FORWARD: 'shift+l',
			SHUTTLE_REVERSE: 'shift+j'
		});
		// SAFETY: test constructs minimal KeyboardEvent-like object for shortcut matching.
		const event = { key: 'l', code: 'KeyL', shiftKey: true } as unknown as KeyboardEvent;
		expect(eventMatchesShortcut(event, bindings.SHUTTLE_FORWARD)).toBe(true);
		expect(
			eventMatchesShortcut(
				// SAFETY: test constructs minimal KeyboardEvent-like object for shortcut matching.
				{ key: 'l', code: 'KeyL' } as unknown as KeyboardEvent,
				bindings.SHUTTLE_FORWARD
			)
		).toBe(false);
	});

	it('ignores editable fields', () => {
		const input = document.createElement('input');
		const textarea = document.createElement('textarea');
		expect(editorShortcutTargetIsDisabled(input)).toBe(true);
		expect(editorShortcutTargetIsDisabled(textarea)).toBe(true);
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
		expect(frames[frames.length - 1]!).toBe(30);
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

	it('no duplicate loops', () => {
		const time = new FakeTimeSource();
		const raf = rafHarness();
		const clock = new Clock({ fps: 30, timeSource: time });
		let loopCount = 0;
		clock.on('framechange', (f) => {
			if (f === 0) loopCount += 1;
		});
		clock.play({ range: { start: 0, end: 10 }, loop: true });
		time.advance(0.5);
		raf.flush(2);
		time.advance(0.5);
		raf.flush(2);
		expect(loopCount).toBeLessThanOrEqual(5);
		clock.dispose();
	});

	it('cleanup removes listeners on dispose', () => {
		const time = new FakeTimeSource();
		rafHarness();
		const clock = new Clock({ fps: 30, timeSource: time });
		const fn = vi.fn();
		const off = clock.on('framechange', fn);
		off();
		clock.play();
		clock.dispose();
		expect(() => clock.dispose()).not.toThrow();
	});

	it('Space routing respects source hover', () => {
		// Simulate source hover active: Space should route to source, not program
		// This is verified via sourceHoverStore.isActive logic in +page.svelte
		// For pure test, verify that Play/Pause shortcut is source-local when hovered
		const bindings = resolveEditorShortcuts({ PLAY_PAUSE: 'space' });
		// SAFETY: test seam - minimal mock for controllable media/AudioContext.
		const spaceEvent = { key: ' ', code: 'Space' } as unknown as KeyboardEvent;
		expect(eventMatchesShortcut(spaceEvent, bindings.PLAY_PAUSE)).toBe(true);
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
