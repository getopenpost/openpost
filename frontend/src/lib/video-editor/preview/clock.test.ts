import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { Clock, type ClockTimeSource } from './clock';

class FakeTimeSource implements ClockTimeSource {
	seconds = 0;
	now(): number {
		return this.seconds;
	}
	advance(seconds: number): void {
		this.seconds += seconds;
	}
}

interface RafHarness {
	flush: (count?: number) => void;
}

function rafHarness(): RafHarness {
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

describe('Clock', () => {
	let time: FakeTimeSource;
	let raf: ReturnType<typeof rafHarness>;

	beforeEach(() => {
		time = new FakeTimeSource();
		raf = rafHarness();
	});
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('stays paused and seekable without playing', () => {
		const clock = new Clock({ fps: 30, timeSource: time });
		clock.seek(45);
		expect(clock.currentFrame).toBe(45);
		expect(clock.isPlaying).toBe(false);
		clock.dispose();
	});

	it('advances frames at fps × rate while playing', () => {
		const clock = new Clock({ fps: 30, timeSource: time });
		const frames: number[] = [];
		clock.on('framechange', (f) => frames.push(f));

		clock.play();
		time.advance(1); // one second
		raf.flush(2);
		expect(clock.currentFrame).toBe(30);

		clock.setRate(2);
		time.advance(0.5); // half second at 2x
		raf.flush(2);
		expect(clock.currentFrame).toBe(60);

		clock.dispose();
	});

	it('stops at range end and emits ended', () => {
		const clock = new Clock({ fps: 30, timeSource: time });
		const ended = vi.fn();
		clock.on('ended', ended);

		clock.play({ range: { start: 10, end: 40 } });
		time.advance(5); // would be frame 160 unbounded
		raf.flush(2);

		expect(ended).toHaveBeenCalledWith(40);
		expect(clock.isPlaying).toBe(false);
		clock.dispose();
	});

	it('loops back to range start', () => {
		const clock = new Clock({ fps: 30, timeSource: time });
		clock.play({ range: { start: 10, end: 40 }, loop: true });
		time.advance(5);
		raf.flush(1);
		expect(clock.currentFrame).toBeLessThan(40);
		clock.dispose();
	});

	it('seek pauses and resumes playback', () => {
		const clock = new Clock({ fps: 30, timeSource: time });
		clock.play();
		clock.seek(100);
		expect(clock.currentFrame).toBe(100);
		expect(clock.isPlaying).toBe(true);
		clock.dispose();
	});

	it('setFps re-anchors without jumping', () => {
		const clock = new Clock({ fps: 30, timeSource: time });
		clock.play();
		time.advance(1);
		raf.flush(1);
		const before = clock.currentFrame;
		clock.setFps(60);
		expect(clock.currentFrame).toBe(before);
		clock.dispose();
	});

	it('throttles timeupdate events', () => {
		const clock = new Clock({ fps: 30, timeSource: time });
		const updates = vi.fn();
		clock.on('timeupdate', updates);
		clock.play();
		time.advance(0.05);
		raf.flush(1);
		time.advance(0.05);
		raf.flush(1);
		time.advance(0.3);
		raf.flush(1);
		expect(updates.mock.calls.length).toBeLessThanOrEqual(2);
		clock.dispose();
	});

	it('advances reverse at negative rate with ceil semantics', () => {
		const clock = new Clock({ fps: 30, timeSource: time });
		clock.seek(120);
		clock.setRate(-2);
		clock.play({ range: { start: 0, end: 300 } });
		time.advance(0.5);
		raf.flush(1);
		expect(clock.currentFrame).toBe(90);
		clock.dispose();
	});

	it('restarts reverse playback from last frame at first boundary', () => {
		const clock = new Clock({ fps: 30, timeSource: time });
		clock.seek(0);
		clock.setRate(-1);
		clock.play({ range: { start: 0, end: 300 } });
		expect(clock.currentFrame).toBe(299);
		clock.dispose();
	});

	it('stops at range start when reversing without loop', () => {
		const clock = new Clock({ fps: 30, timeSource: time });
		const ended = vi.fn();
		clock.on('ended', ended);
		clock.seek(30);
		clock.setRate(-1);
		clock.play({ range: { start: 10, end: 40 } });
		time.advance(2); // would go negative
		raf.flush(2);
		expect(ended).toHaveBeenCalledWith(10);
		expect(clock.isPlaying).toBe(false);
		expect(clock.currentFrame).toBe(10);
		clock.dispose();
	});

	it('loops reverse back to range end', () => {
		const clock = new Clock({ fps: 30, timeSource: time });
		clock.seek(20);
		clock.setRate(-2);
		clock.play({ range: { start: 10, end: 40 }, loop: true });
		time.advance(1); // 20 -60 = -40 <10 so loop
		raf.flush(1);
		expect(clock.currentFrame).toBe(39);
		clock.dispose();
	});

	it('handles successive J/L rates 1x/2x/4x and direction change', async () => {
		const { getNextShuttleRate } = await import('./shuttle');
		expect(getNextShuttleRate(1, 1)).toBe(2);
		expect(getNextShuttleRate(2, 1)).toBe(4);
		expect(getNextShuttleRate(4, 1)).toBe(4);
		expect(getNextShuttleRate(2, -1)).toBe(-1);
		expect(getNextShuttleRate(-1, -1)).toBe(-2);
		const clock = new Clock({ fps: 30, timeSource: time });
		clock.setRate(2);
		expect(clock.playbackRate).toBe(2);
		clock.setRate(-1);
		expect(clock.playbackRate).toBe(-1);
		clock.dispose();
	});

	it('does not create duplicate loops when tick fires repeatedly at boundary', () => {
		const clock = new Clock({ fps: 30, timeSource: time });
		const frames: number[] = [];
		clock.on('framechange', (f) => frames.push(f));
		clock.play({ range: { start: 0, end: 10 }, loop: true });
		time.advance(0.5); // 15 frames >10 loop once
		raf.flush(2);
		time.advance(0.1);
		raf.flush(2);
		const endedCount = frames.filter((f) => f === 0).length;
		expect(endedCount).toBeLessThanOrEqual(3);
		clock.dispose();
	});

	it('pause resets rate handling and emits correctly', () => {
		const clock = new Clock({ fps: 30, timeSource: time });
		clock.setRate(2);
		clock.play();
		const paused = vi.fn();
		clock.on('pause', paused);
		time.advance(0.2);
		raf.flush(1);
		clock.pause();
		expect(paused).toHaveBeenCalled();
		expect(clock.isPlaying).toBe(false);
		clock.setRate(1);
		expect(clock.playbackRate).toBe(1);
		clock.dispose();
	});
});
