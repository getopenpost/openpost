import { expect, it } from 'vitest';
import { renderTextItemRaster } from '../media/text-raster';

it('keeps timer artwork visible over an authored opaque background', () => {
	const canvas = document.createElement('canvas');
	canvas.width = canvas.height = 200;
	const context = canvas.getContext('2d')!;
	renderTextItemRaster(
		context,
		{
			id: 'ring',
			type: 'text',
			trackId: 'track',
			label: 'Ring',
			from: 0,
			durationInFrames: 300,
			timer: { style: 'ring', format: 'clock', direction: 'down' },
			color: '#ffffff',
			backgroundColor: '#ff0000',
			backgroundFit: 'box',
			fontSize: 24,
			textAlign: 'center',
			verticalAlign: 'middle'
		},
		200,
		200,
		{ absoluteFrame: 0, fps: 30 }
	);
	expect([...context.getImageData(100, 20, 1, 1).data]).toEqual([255, 255, 255, 255]);
	expect([...context.getImageData(100, 5, 1, 1).data]).toEqual([255, 0, 0, 255]);
});
