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

	it.each([
		{
			name: 'forward range end',
			rate: 1,
			start: 10,
			range: { start: 10, end: 40 },
			finalFrame: 39,
			endedFrame: 40
		},
		{
			name: 'reverse range start',
			rate: -1,
			start: 39,
			range: { start: 10, end: 40 },
			finalFrame: 10,
			endedFrame: 10
		},
		{
			name: 'reverse timeline start',
			rate: -1,
			start: 20,
			range: undefined,
			finalFrame: 0,
			endedFrame: 0
		}
	])(
		'updates the displayed frame when stopping at $name after a delayed tick',
		({ rate, start, range, finalFrame, endedFrame }) => {
			const clock = new Clock({ fps: 30, timeSource: time });
			const ended = vi.fn();
			let displayedFrame = -1;
			clock.on('ended', ended);
			clock.on('framechange', (frame) => {
				displayedFrame = frame;
			});
			clock.seek(start);
			clock.setRate(rate);
			clock.play({ range });
			time.advance(5);
			raf.flush(2);

			expect(ended).toHaveBeenCalledWith(endedFrame);
			expect(clock.isPlaying).toBe(false);
			expect(displayedFrame).toBe(finalFrame);
			clock.dispose();
		}
	);

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

	it('updates the displayed frame when pausing between animation ticks', () => {
		const clock = new Clock({ fps: 30, timeSource: time });
		let displayedFrame = -1;
		clock.on('framechange', (frame) => {
			displayedFrame = frame;
		});
		clock.play();
		time.advance(0.5);
		clock.pause();
		expect(displayedFrame).toBe(15);
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
