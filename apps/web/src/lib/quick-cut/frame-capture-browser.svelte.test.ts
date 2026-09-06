import { describe, expect, it } from 'vitest';
import { BufferTarget, CanvasSource, Output, WebMOutputFormat } from 'mediabunny';
import { captureVideoFrame, frameCaptureFileName } from './frame-capture';

async function createVideo(): Promise<File> {
	const sourceCanvas = document.createElement('canvas');
	sourceCanvas.width = 80;
	sourceCanvas.height = 48;
	const context = sourceCanvas.getContext('2d')!;
	const target = new BufferTarget();
	const output = new Output({ format: new WebMOutputFormat(), target });
	const video = new CanvasSource(sourceCanvas, { codec: 'vp9', bitrate: 300_000 });
	output.addVideoTrack(video);
	await output.start();
	for (let frame = 0; frame < 6; frame++) {
		context.fillStyle = '#e02020';
		context.fillRect(0, 0, sourceCanvas.width, sourceCanvas.height);
		await video.add(frame / 30, 1 / 30);
	}
	video.close();
	await output.finalize();
	if (!target.buffer) throw new Error('No video fixture buffer.');
	return new File([target.buffer], 'field interview.webm', { type: 'video/webm' });
}

async function loadVideo(file: File): Promise<{ element: HTMLVideoElement; url: string }> {
	const element = document.createElement('video');
	const url = URL.createObjectURL(file);
	element.muted = true;
	element.playsInline = true;
	element.src = url;
	document.body.append(element);
	await new Promise<void>((resolve, reject) => {
		element.onloadeddata = () => resolve();
		element.onerror = () => reject(new Error('Could not decode test video.'));
	});
	await element.play();
	await new Promise<void>((resolve) => element.requestVideoFrameCallback(() => resolve()));
	element.pause();
	return { element, url };
}

describe('Quick Cut frame capture', () => {
	it('encodes the visible source frame at its decoded dimensions', async () => {
		const { element, url } = await loadVideo(await createVideo());
		try {
			const blob = await captureVideoFrame(element, 'png');
			expect(blob.type).toBe('image/png');
			const jpeg = await captureVideoFrame(element, 'jpeg');
			expect(jpeg.type).toBe('image/jpeg');
			const bitmap = await createImageBitmap(blob);
			expect([bitmap.width, bitmap.height]).toEqual([80, 48]);
			const canvas = document.createElement('canvas');
			canvas.width = bitmap.width;
			canvas.height = bitmap.height;
			const context = canvas.getContext('2d')!;
			context.drawImage(bitmap, 0, 0);
			const [red, green, blue] = context.getImageData(40, 24, 1, 1).data;
			expect(red).toBeGreaterThan(green + 80);
			expect(red).toBeGreaterThan(blue + 80);
			bitmap.close();
		} finally {
			element.remove();
			URL.revokeObjectURL(url);
		}
	}, 30000);

	it('builds a source-based timestamped file name', () => {
		expect(frameCaptureFileName('Field interview.mov', 3723.045, 'jpeg')).toBe(
			'Field-interview-01-02-03-045.jpg'
		);
	});
});
