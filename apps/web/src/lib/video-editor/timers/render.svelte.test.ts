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

it('renders independent progress and track colors, width, rotation, and hidden numbers', () => {
	const canvas = document.createElement('canvas');
	canvas.width = canvas.height = 200;
	const context = canvas.getContext('2d')!;
	renderTextItemRaster(
		context,
		{
			id: 'custom-ring',
			type: 'text',
			trackId: 'track',
			label: 'Ring',
			from: 0,
			durationInFrames: 301,
			color: '#ffffff',
			fontSize: 24,
			textAlign: 'center',
			verticalAlign: 'middle',
			timer: {
				style: 'ring',
				format: 'clock',
				direction: 'down',
				progressColor: '#00ff00',
				trackColor: '#ff0000',
				trackOpacity: 1,
				thickness: 10,
				startAngle: 0,
				showValue: false,
				rounded: false
			}
		},
		200,
		200,
		{ absoluteFrame: 150, fps: 30 }
	);
	expect([...context.getImageData(100, 180, 1, 1).data]).toEqual([0, 255, 0, 255]);
	expect([...context.getImageData(100, 20, 1, 1).data]).toEqual([255, 0, 0, 255]);
	expect([...context.getImageData(100, 174, 1, 1).data]).toEqual([0, 255, 0, 255]);
	expect(context.getImageData(75, 75, 50, 50).data.every((value) => value === 0)).toBe(true);
});

it('keeps gaps between thick rounded ring segments', () => {
	const canvas = document.createElement('canvas');
	canvas.width = canvas.height = 200;
	const context = canvas.getContext('2d')!;
	renderTextItemRaster(
		context,
		{
			id: 'segmented-ring',
			type: 'text',
			trackId: 'track',
			label: 'Ring',
			from: 0,
			durationInFrames: 300,
			timer: {
				style: 'ring',
				format: 'clock',
				direction: 'down',
				thickness: 25,
				segments: 12,
				rounded: true,
				showValue: false,
				startAngle: 0
			}
		},
		200,
		200,
		{ absoluteFrame: 0, fps: 30 }
	);
	// Three o'clock is a gap; half a segment clockwise is solid artwork.
	expect(context.getImageData(170, 100, 1, 1).data[3]).toBe(0);
	expect(context.getImageData(169, 117, 1, 1).data[3]).toBe(255);
});
