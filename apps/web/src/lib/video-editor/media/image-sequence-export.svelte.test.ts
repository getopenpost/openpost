import { expect, it } from 'vitest';
import { createBlankProject } from '../project/defaults';
import { renderImageSequenceFrames } from './image-sequence-export';

it.each(['png', 'webp', 'jpeg'] as const)(
	'preserves authored geometry and canvas clipping in resized %s sequences',
	async (format) => {
		const project = createBlankProject('Sequence geometry');
		project.metadata = { width: 64, height: 64, fps: 30 };
		project.timeline!.items = [
			{
				id: 'square',
				type: 'shape',
				shapeType: 'rectangle',
				fillColor: '#ff0000',
				trackId: 'track-video-main',
				from: 0,
				durationInFrames: 1,
				label: 'Square',
				transform: { width: 32, height: 32 }
			},
			{
				id: 'outside',
				type: 'shape',
				shapeType: 'rectangle',
				fillColor: '#00ff00',
				trackId: 'track-video-overlay',
				from: 0,
				durationInFrames: 1,
				label: 'Outside canvas',
				transform: { x: 48, width: 16, height: 16 }
			}
		];
		for (const width of [128, 256]) {
			let frames = 0;
			for await (const frame of renderImageSequenceFrames(project, {
				format,
				width,
				height: 128,
				range: { startFrame: 0, endFrame: 1 }
			})) {
				frames++;
				const bitmap = await createImageBitmap(frame.blob);
				try {
					expect([bitmap.width, bitmap.height]).toEqual([width, 128]);
					const canvas = new OffscreenCanvas(width, 128);
					const context = canvas.getContext('2d')!;
					context.drawImage(bitmap, 0, 0);
					const pixel = (x: number, y: number) => context.getImageData(x, y, 1, 1).data;
					// The square doubles to 64x64 and stays centered, even with pillarboxing.
					expect(pixel(width / 2 - 28, 36)[0]).toBeGreaterThan(240);
					expect(pixel(width / 2 + 28, 92)[0]).toBeGreaterThan(240);
					expect(pixel(width / 2 + 36, 64)[0]).toBeLessThan(15);
					// Pixels authored outside the original canvas never appear in the output.
					expect(
						context
							.getImageData(0, 0, width, 128)
							.data.some((value, index) => index % 4 === 1 && value > 240)
					).toBe(false);
					expect(pixel(0, 0)[3]).toBe(format === 'jpeg' ? 255 : 0);
				} finally {
					bitmap.close();
				}
			}
			expect(frames).toBe(1);
		}
	}
);
