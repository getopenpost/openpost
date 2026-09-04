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

	it('applies successive J/L rates and direction changes to the clock', async () => {
		const clock = new Clock({ fps: 30, timeSource: time });
		clock.setRate(2);
		expect(clock.playbackRate).toBe(2);
		clock.setRate(-1);
		expect(clock.playbackRate).toBe(-1);
		clock.dispose();
	});
});
