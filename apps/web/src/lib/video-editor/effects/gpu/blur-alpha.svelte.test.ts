import { expect, it } from 'vitest';
import { GpuCompositor } from './compositor';
import { getGpuEffectDefaultParams } from './registry';

it.each([
	{ effectId: 'gpu-box-blur', edgeX: 32, amount: 0.1 },
	{ effectId: 'gpu-gaussian-blur', edgeX: 32, amount: 0.1 },
	{ effectId: 'gpu-motion-blur', edgeX: 32, amount: 0.1 },
	{ effectId: 'gpu-radial-blur', edgeX: 31, amount: 1 },
	{ effectId: 'gpu-zoom-blur', edgeX: 31, amount: 0.1 }
])(
	'keeps red transparent edges red after $effectId over a white background',
	({ effectId, edgeX, amount }) => {
		const source = new OffscreenCanvas(64, 16);
		const sourceContext = source.getContext('2d')!;
		sourceContext.fillStyle = '#ff0000';
		sourceContext.fillRect(0, 0, 32, 16);
		const backdrop = new OffscreenCanvas(64, 16);
		const backdropContext = backdrop.getContext('2d')!;
		backdropContext.fillStyle = '#ffffff';
		backdropContext.fillRect(0, 0, 64, 16);
		const canvas = new OffscreenCanvas(64, 16);
		const compositor = GpuCompositor.create(canvas)!;
		try {
			expect(
				compositor.render(
					source,
					64,
					16,
					[
						{
							effectId,
							params: {
								...getGpuEffectDefaultParams(effectId),
								radius: 4,
								amount,
								angle: 0,
								shutterAngle: 360,
								centerX: effectId === 'gpu-radial-blur' ? 1 : 0
							}
						}
					],
					{ backdrop }
				)
			).toBe(true);
			const read = new OffscreenCanvas(64, 16).getContext('2d')!;
			read.drawImage(canvas, 0, 0);
			const edge = read.getImageData(edgeX, 8, 1, 1).data;
			// Mixing pure red with white can reduce green and blue, never red.
			// These bounds also prove the sample actually lies in the softened edge.
			expect(edge[1]).toBeGreaterThan(60);
			expect(edge[1]).toBeLessThan(220);
			expect(edge[0]).toBeGreaterThanOrEqual(250);
			expect(edge[3]).toBe(255);
		} finally {
			compositor.dispose();
		}
	}
);

it.each([
	{ name: 'two consecutive blurs', ids: ['gpu-box-blur', 'gpu-gaussian-blur'], channel: 0 },
	{ name: 'color before blur', ids: ['gpu-invert', 'gpu-box-blur'], channel: 1 },
	{ name: 'color after blur', ids: ['gpu-box-blur', 'gpu-invert'], channel: 1 }
])('preserves translucent edge colors through $name', ({ ids, channel }) => {
	const source = new OffscreenCanvas(64, 16);
	const context = source.getContext('2d')!;
	context.fillStyle = '#ff0000';
	context.fillRect(0, 0, 32, 16);
	const canvas = new OffscreenCanvas(64, 16);
	const compositor = GpuCompositor.create(canvas)!;
	try {
		expect(
			compositor.render(
				source,
				64,
				16,
				ids.map((effectId) => ({
					effectId,
					params: { ...getGpuEffectDefaultParams(effectId), radius: 4 }
				}))
			)
		).toBe(true);
		context.clearRect(0, 0, 64, 16);
		context.drawImage(canvas, 0, 0);
		const edge = context.getImageData(32, 8, 1, 1).data;
		expect(edge[3]).toBeGreaterThan(40);
		expect(edge[3]).toBeLessThan(220);
		expect(edge[channel]).toBeGreaterThanOrEqual(250);
		expect(edge[channel === 0 ? 1 : 0]).toBeLessThan(5);
	} finally {
		compositor.dispose();
	}
});

it('preserves source bytes across identity blur settings', () => {
	const canvas = new OffscreenCanvas(2, 1);
	const compositor = GpuCompositor.create(canvas)!;
	const pixels = new ImageData(new Uint8ClampedArray([140, 60, 20, 100, 0, 255, 0, 255]), 2, 1);
	const output = new OffscreenCanvas(2, 1).getContext('2d')!;
	try {
		expect(compositor.render(pixels, 2, 1, [])).toBe(true);
		output.drawImage(canvas, 0, 0);
		const expected = [...output.getImageData(0, 0, 2, 1).data];
		expect(
			compositor.render(
				pixels,
				2,
				1,
				[
					'gpu-box-blur',
					'gpu-gaussian-blur',
					'gpu-motion-blur',
					'gpu-radial-blur',
					'gpu-zoom-blur'
				].map((effectId) => ({
					effectId,
					params: { ...getGpuEffectDefaultParams(effectId), radius: 0, amount: 0 }
				}))
			)
		).toBe(true);
		output.clearRect(0, 0, 2, 1);
		output.drawImage(canvas, 0, 0);
		expect([...output.getImageData(0, 0, 2, 1).data]).toEqual(expected);
	} finally {
		compositor.dispose();
	}
});

it('ignores hidden transparent colors when blurring a faint source at reduced resolution', () => {
	const pixels = new ImageData(64, 16);
	for (let y = 0; y < 16; y++) {
		for (let x = 0; x < 64; x++) {
			pixels.data.set(x < 32 ? [255, 0, 0, 32] : [0, 255, 0, 0], (y * 64 + x) * 4);
		}
	}
	const backdrop = new OffscreenCanvas(32, 8);
	const context = backdrop.getContext('2d')!;
	context.fillStyle = '#ffffff';
	context.fillRect(0, 0, 32, 8);
	const canvas = new OffscreenCanvas(32, 8);
	const compositor = GpuCompositor.create(canvas)!;
	try {
		expect(
			compositor.render(
				pixels,
				32,
				8,
				[
					{
						effectId: 'gpu-box-blur',
						params: { ...getGpuEffectDefaultParams('gpu-box-blur'), radius: 4 }
					}
				],
				{ backdrop, referenceSize: { width: 64, height: 16 } }
			)
		).toBe(true);
		context.drawImage(canvas, 0, 0);
		const edge = context.getImageData(16, 4, 1, 1).data;
		// Only faint red contributes coverage; fully transparent green contributes nothing.
		expect(edge[0]).toBeGreaterThanOrEqual(254);
		expect(edge[1]).toBe(edge[2]);
		expect(edge[1]).toBeGreaterThan(230);
		expect(edge[1]).toBeLessThan(254);
		expect(edge[3]).toBe(255);
	} finally {
		compositor.dispose();
	}
});
