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
	readonly pending: number;
}

function rafHarness(): RafHarness {
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

	it('keeps exactly one animation frame scheduled across repeated loop wraps', () => {
		const clock = new Clock({ fps: 30, timeSource: time });
		const frames: number[] = [];
		clock.on('framechange', (f) => frames.push(f));
		clock.play({ range: { start: 0, end: 10 }, loop: true });
		frames.length = 0;
		expect(raf.pending).toBe(1);
		time.advance(0.5);
		raf.flush(1);
		expect(clock.currentFrame).toBe(0);
		expect(raf.pending).toBe(1);
		time.advance(0.5);
		raf.flush(1);
		expect(clock.currentFrame).toBe(0);
		expect(raf.pending).toBe(1);
		expect(frames.filter((frame) => frame === 0)).toHaveLength(2);
		clock.dispose();
	});

	it('clamps a paused frame to its range and stops reverse playback at timeline zero', () => {
		const ranged = new Clock({ fps: 30, timeSource: time });
		ranged.play({ range: { start: 10, end: 40 } });
		time.advance(10);
		ranged.pause();
		expect(ranged.currentFrame).toBe(39);
		ranged.dispose();

		const reverseTime = new FakeTimeSource();
		const reverseRaf = rafHarness();
		const reverse = new Clock({ fps: 30, timeSource: reverseTime });
		reverse.seek(5);
		reverse.setRate(-1);
		reverse.play();
		reverseTime.advance(1);
		expect(reverse.currentFrame).toBe(0);
		reverseRaf.flush(1);
		expect(reverse.currentFrame).toBe(0);
		expect(reverse.isPlaying).toBe(false);
		reverse.dispose();
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

	it('clamps far-past forward boundary to end-1 before and after tick', () => {
		const clock = new Clock({ fps: 30, timeSource: time });
		clock.seek(30);
		clock.play({ range: { start: 10, end: 40 } });
		time.advance(10); // far beyond
		expect(clock.currentFrame).toBe(39);
		raf.flush(1);
		expect(clock.currentFrame).toBe(39);
		clock.dispose();
	});

	it('clamps far-past reverse boundary to start before and after tick', () => {
		const clock = new Clock({ fps: 30, timeSource: time });
		clock.seek(30);
		clock.setRate(-2);
		clock.play({ range: { start: 10, end: 40 } });
		time.advance(10); // far beyond reverse
		expect(clock.currentFrame).toBe(10);
		raf.flush(1);
		expect(clock.currentFrame).toBe(10);
		clock.dispose();
	});

	it('forward end lands on end-1, reverse end lands on start', () => {
		const fwd = new Clock({ fps: 30, timeSource: time });
		fwd.play({ range: { start: 10, end: 40 } });
		time.advance(10);
		raf.flush(2);
		expect(fwd.isPlaying).toBe(false);
		expect(fwd.currentFrame).toBe(39);
		fwd.dispose();

		const time2 = new FakeTimeSource();
		const raf2 = rafHarness();
		const rev = new Clock({ fps: 30, timeSource: time2 });
		rev.seek(30);
		rev.setRate(-1);
		rev.play({ range: { start: 10, end: 40 } });
		time2.advance(10);
		raf2.flush(2);
		expect(rev.isPlaying).toBe(false);
		expect(rev.currentFrame).toBe(10);
		rev.dispose();
	});

	it('exact signed 1x/2x/4x produce correct frame deltas with ceil/floor', () => {
		for (const rate of [1, 2, 4] as const) {
			const t = new FakeTimeSource();
			rafHarness();
			const c = new Clock({ fps: 30, timeSource: t });
			c.setRate(rate);
			c.seek(0);
			c.play();
			t.advance(1);
			expect(c.currentFrame).toBe(30 * rate);
			c.dispose();
		}
		for (const rate of [-1, -2, -4] as const) {
			const t = new FakeTimeSource();
			rafHarness();
			const c = new Clock({ fps: 30, timeSource: t });
			c.seek(120);
			c.setRate(rate);
			c.play({ range: { start: 0, end: 300 } });
			t.advance(1);
			expect(c.currentFrame).toBe(120 + 30 * rate);
			c.dispose();
		}
	});

	it('loop wraps to opposite valid frame for both directions', () => {
		const fwd = new Clock({ fps: 30, timeSource: time });
		fwd.play({ range: { start: 10, end: 40 }, loop: true });
		time.advance(5);
		raf.flush(1);
		expect(fwd.currentFrame).toBeGreaterThanOrEqual(10);
		expect(fwd.currentFrame).toBeLessThan(40);
		fwd.dispose();
		const t2 = new FakeTimeSource();
		const raf2b = rafHarness();
		const rev = new Clock({ fps: 30, timeSource: t2 });
		rev.seek(15);
		rev.setRate(-1);
		rev.play({ range: { start: 10, end: 40 }, loop: true });
		t2.advance(5);
		raf2b.flush(1);
		expect(rev.currentFrame).toBeGreaterThanOrEqual(10);
		expect(rev.currentFrame).toBeLessThan(40);
		rev.dispose();
	});

	it('dispose cancels raf and clears listeners', () => {
		const clock = new Clock({ fps: 30, timeSource: time });
		const fn = vi.fn();
		clock.on('framechange', fn);
		clock.play();
		clock.dispose();
		expect(clock.isPlaying).toBe(false);
		// Second dispose should not throw
		expect(() => clock.dispose()).not.toThrow();
	});
});
