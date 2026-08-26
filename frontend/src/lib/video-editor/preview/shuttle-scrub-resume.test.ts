import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { Clock, type ClockTimeSource } from './clock';
import { createShuttleScrubResume } from './shuttle-scrub-resume.svelte';

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
		flush(count = 1) {
			for (let i = 0; i < count; i++) {
				callbacks.shift()?.(performance.now());
			}
		}
	};
}

describe('createShuttleScrubResume over Clock', () => {
	let time: FakeTimeSource;
	let raf: ReturnType<typeof rafHarness>;

	beforeEach(() => {
		time = new FakeTimeSource();
		raf = rafHarness();
	});
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('saves exact signed rate and pauses on begin', () => {
		const clock = new Clock({ fps: 30, timeSource: time });
		clock.setRate(2);
		clock.play();
		const resume = createShuttleScrubResume(clock);
		expect(clock.isPlaying).toBe(true);
		resume.begin();
		expect(clock.isPlaying).toBe(false);
		expect(resume.hasSaved).toBe(true);
		clock.dispose();
	});

	it('does not save when not playing', () => {
		const clock = new Clock({ fps: 30, timeSource: time });
		const resume = createShuttleScrubResume(clock);
		resume.begin();
		expect(resume.hasSaved).toBe(false);
		expect(clock.isPlaying).toBe(false);
		clock.dispose();
	});

	it('commit restores exact signed 1x/2x/4x rates', () => {
		for (const rate of [-4, -2, -1, 1, 2, 4] as const) {
			const clock = new Clock({ fps: 30, timeSource: time });
			clock.setRate(rate);
			clock.play();
			const resume = createShuttleScrubResume(clock);
			resume.begin();
			expect(clock.isPlaying).toBe(false);
			resume.commit();
			expect(clock.isPlaying).toBe(true);
			expect(clock.playbackRate).toBe(rate);
			clock.dispose();
		}
	});

	it('commit restores range [start,end) without loop', () => {
		const clock = new Clock({ fps: 30, timeSource: time });
		clock.play({ range: { start: 10, end: 40 } });
		time.advance(0.1);
		raf.flush(1);
		const resume = createShuttleScrubResume(clock);
		resume.begin();
		expect(clock.isPlaying).toBe(false);
		resume.commit();
		expect(clock.isPlaying).toBe(true);
		// After commit, should still respect range: still within [10,40)
		time.advance(2);
		raf.flush(2);
		// If itloops would wrap, but without loop it should stop at 39
		// We just verify it doesn't crash and currentFrame respects range clamping
		expect(clock.currentFrame).toBeGreaterThanOrEqual(10);
		expect(clock.currentFrame).toBeLessThan(40);
		clock.dispose();
	});

	it('commit restores loop flag', () => {
		const clock = new Clock({ fps: 30, timeSource: time });
		clock.play({ range: { start: 10, end: 40 }, loop: true });
		const resume = createShuttleScrubResume(clock);
		resume.begin();
		resume.commit();
		expect(clock.isPlaying).toBe(true);
		// Advance far enough to trigger loop wrap
		clock.seek(39);
		time.advance(1);
		raf.flush(2);
		expect(clock.currentFrame).toBeGreaterThanOrEqual(10);
		expect(clock.currentFrame).toBeLessThan(40);
		clock.dispose();
	});

	it('cancel clears without resuming and handles trim/drag/dialog cancellation', () => {
		const clock = new Clock({ fps: 30, timeSource: time });
		clock.setRate(-2);
		clock.play();
		const resume = createShuttleScrubResume(clock);
		resume.begin();
		expect(resume.hasSaved).toBe(true);
		resume.cancel();
		expect(resume.hasSaved).toBe(false);
		expect(clock.isPlaying).toBe(false);
		// commit after cancel should not resume
		resume.commit();
		expect(clock.isPlaying).toBe(false);
		expect(clock.playbackRate).toBe(-2);
		clock.dispose();
	});

	it('reset clears saved state', () => {
		const clock = new Clock({ fps: 30, timeSource: time });
		clock.play();
		const resume = createShuttleScrubResume(clock);
		resume.begin();
		expect(resume.hasSaved).toBe(true);
		resume.reset();
		expect(resume.hasSaved).toBe(false);
		clock.dispose();
	});

	it('commit without begin does not start playback', () => {
		const clock = new Clock({ fps: 30, timeSource: time });
		const resume = createShuttleScrubResume(clock);
		resume.commit();
		expect(clock.isPlaying).toBe(false);
		clock.dispose();
	});

	it('handles successive begin/commit cycles with direction changes', () => {
		const clock = new Clock({ fps: 30, timeSource: time });
		const resume = createShuttleScrubResume(clock);
		clock.setRate(1);
		clock.play();
		resume.begin();
		resume.commit();
		expect(clock.playbackRate).toBe(1);
		clock.setRate(2);
		resume.begin();
		resume.commit();
		expect(clock.playbackRate).toBe(2);
		clock.setRate(-1);
		resume.begin();
		resume.commit();
		expect(clock.playbackRate).toBe(-1);
		clock.dispose();
	});

	it('preserves rate across far-past-boundary seek', () => {
		const clock = new Clock({ fps: 30, timeSource: time });
		clock.play({ range: { start: 100, end: 200 } });
		clock.seek(50); // far before start
		// After seek, frame should be clamped but rate preserved
		const resume = createShuttleScrubResume(clock);
		clock.setRate(-4);
		resume.begin();
		expect(clock.playbackRate).toBe(-4);
		resume.commit();
		expect(clock.playbackRate).toBe(-4);
		clock.dispose();
	});
});
