/** Keep one decoder seek in flight. New pointer positions replace the queued target. */
export function createVideoScrubber(
	video: Pick<
		HTMLVideoElement,
		'currentTime' | 'duration' | 'seeking' | 'addEventListener' | 'removeEventListener'
	>
) {
	let target: number | null = null;
	let disposed = false;
	function flush(): void {
		if (disposed || video.seeking || target === null) return;
		const next = target;
		target = null;
		if (video.currentTime !== next) video.currentTime = next;
	}
	video.addEventListener('seeked', flush);
	video.addEventListener('loadedmetadata', flush);
	return {
		get pending() {
			return target !== null || video.seeking;
		},
		seek(time: number) {
			if (disposed || !Number.isFinite(time)) return;
			target = Math.max(0, Math.min(time, Number.isFinite(video.duration) ? video.duration : time));
			flush();
		},
		destroy() {
			disposed = true;
			target = null;
			video.removeEventListener('seeked', flush);
			video.removeEventListener('loadedmetadata', flush);
		}
	};
}
