import { expect, test } from 'vitest';
import { createVideoScrubber } from './video-scrubber';

class SlowVideo extends EventTarget {
	seeking = false;
	duration = 60;
	writes: number[] = [];
	private time = 0;
	get currentTime() {
		return this.time;
	}
	set currentTime(value: number) {
		this.writes.push(value);
		this.time = value;
		this.seeking = true;
	}
	finish() {
		this.seeking = false;
		this.dispatchEvent(new Event('seeked'));
	}
}

test('a slow decoder finishes a frame before seeking the latest scrub target', () => {
	const video = new SlowVideo();
	const scrubber = createVideoScrubber(video);
	scrubber.seek(1);
	for (let time = 2; time <= 30; time++) scrubber.seek(time);
	expect(video.writes).toEqual([1]);
	expect(scrubber.pending).toBe(true);
	video.finish();
	expect(video.writes).toEqual([1, 30]);
	video.finish();
	expect(scrubber.pending).toBe(false);
	scrubber.destroy();
});

test('changing source drops queued seeks on the old video', () => {
	const video = new SlowVideo();
	const scrubber = createVideoScrubber(video);
	scrubber.seek(2);
	scrubber.seek(5);
	scrubber.destroy();
	video.finish();
	expect(video.writes).toEqual([2]);
});
