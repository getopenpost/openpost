export type FrameCaptureFormat = 'png' | 'jpeg';

const FRAME_CAPTURE_QUALITY = 0.92;

function frameMimeType(format: FrameCaptureFormat): string {
	return `image/${format}`;
}

function frameExtension(format: FrameCaptureFormat): string {
	return format === 'jpeg' ? 'jpg' : 'png';
}

function frameTimecode(seconds: number): string {
	const milliseconds = Math.max(0, Math.round(seconds * 1000));
	const hours = Math.floor(milliseconds / 3_600_000);
	const minutes = Math.floor((milliseconds % 3_600_000) / 60_000);
	const wholeSeconds = Math.floor((milliseconds % 60_000) / 1000);
	const remainder = milliseconds % 1000;
	return [hours, minutes, wholeSeconds]
		.map((value) => String(value).padStart(2, '0'))
		.concat(String(remainder).padStart(3, '0'))
		.join('-');
}

export function frameCaptureFileName(
	sourceName: string,
	time: number,
	format: FrameCaptureFormat
): string {
	const baseName = sourceName
		.replace(/\.[^.]+$/u, '')
		.replace(/[^a-z0-9._-]+/giu, '-')
		.replace(/^-+|-+$/gu, '')
		.slice(0, 80);
	return `${baseName || 'frame'}-${frameTimecode(time)}.${frameExtension(format)}`;
}

export function captureVideoFrame(
	video: HTMLVideoElement,
	format: FrameCaptureFormat
): Promise<Blob> {
	if (
		video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA ||
		video.videoWidth <= 0 ||
		video.videoHeight <= 0
	) {
		throw new Error('The current video frame is not ready.');
	}
	const canvas = document.createElement('canvas');
	canvas.width = video.videoWidth;
	canvas.height = video.videoHeight;
	const context = canvas.getContext('2d');
	if (!context) throw new Error('Frame capture is unavailable in this browser.');
	context.drawImage(video, 0, 0, canvas.width, canvas.height);
	return new Promise((resolve, reject) => {
		canvas.toBlob(
			(blob) => {
				if (blob) resolve(blob);
				else reject(new Error('The browser could not encode this frame.'));
			},
			frameMimeType(format),
			FRAME_CAPTURE_QUALITY
		);
	});
}
