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

	it('publishes each frame once when its listener pauses playback', () => {
		const clock = new Clock({ fps: 30, timeSource: time });
		const frames: number[] = [];
		clock.on('framechange', (frame) => {
			frames.push(frame);
			if (frame === 5) clock.pause();
		});
		try {
			clock.play();
			time.advance(5 / 30);
			raf.flush();
			expect(frames).toEqual([0, 5]);
			expect(clock.isPlaying).toBe(false);
		} finally {
			clock.dispose();
		}
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
