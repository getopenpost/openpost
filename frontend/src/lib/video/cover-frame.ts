const FRAME_SEEK_TIMEOUT_MS = 10_000;

export function clampCoverFrameTimestamp(timestampMs: number, durationMs: number): number {
	if (!Number.isFinite(durationMs) || durationMs <= 0) return 0;
	if (!Number.isFinite(timestampMs)) return 0;
	return Math.min(Math.max(Math.round(timestampMs), 0), Math.max(Math.round(durationMs) - 1, 0));
}

export function formatCoverFrameTimestamp(timestampMs: number): string {
	const totalSeconds = Math.max(0, Math.floor(timestampMs / 1000));
	const hours = Math.floor(totalSeconds / 3600);
	const minutes = Math.floor((totalSeconds % 3600) / 60);
	const seconds = totalSeconds % 60;
	if (hours > 0) {
		return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
	}
	return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export async function captureVideoFrame(
	video: HTMLVideoElement,
	timestampMs: number,
	maxWidth = 1280
): Promise<Blob> {
	if (!video.videoWidth || !video.videoHeight || !Number.isFinite(video.duration)) {
		throw new Error('Video metadata is not ready.');
	}

	const safeTimestamp = clampCoverFrameTimestamp(timestampMs, video.duration * 1000);
	await seekVideo(video, safeTimestamp / 1000);

	const scale = Math.min(1, maxWidth / video.videoWidth);
	const width = Math.max(1, Math.round(video.videoWidth * scale));
	const height = Math.max(1, Math.round(video.videoHeight * scale));
	const canvas = document.createElement('canvas');
	canvas.width = width;
	canvas.height = height;
	const context = canvas.getContext('2d');
	if (!context) throw new Error('Canvas rendering is unavailable.');
	context.drawImage(video, 0, 0, width, height);

	return await new Promise<Blob>((resolve, reject) => {
		canvas.toBlob(
			(blob) =>
				blob ? resolve(blob) : reject(new Error('The selected frame could not be encoded.')),
			'image/jpeg',
			0.9
		);
	});
}

async function seekVideo(video: HTMLVideoElement, seconds: number): Promise<void> {
	if (
		Math.abs(video.currentTime - seconds) < 0.01 &&
		video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
	) {
		return;
	}

	await new Promise<void>((resolve, reject) => {
		const timeout = window.setTimeout(
			() => finish(new Error('Timed out while seeking the video.')),
			FRAME_SEEK_TIMEOUT_MS
		);
		const finish = (error?: Error) => {
			window.clearTimeout(timeout);
			video.removeEventListener('seeked', handleSeeked);
			video.removeEventListener('error', handleError);
			if (error) reject(error);
			else resolve();
		};
		const handleSeeked = () => finish();
		const handleError = () => finish(new Error('The video could not be read.'));
		video.addEventListener('seeked', handleSeeked, { once: true });
		video.addEventListener('error', handleError, { once: true });
		video.currentTime = seconds;
	});
}
