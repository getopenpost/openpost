import { afterEach, expect, it } from 'vitest';
import { BufferTarget, Mp4OutputFormat, Output, VideoSample, VideoSampleSource } from 'mediabunny';
import { createBlankProject } from '../project/defaults';
import { TimelineFrameRenderer } from './render-export';
import { mediaPool } from './pool.svelte';
import type { GpuParamValues } from '../effects/gpu/types';
import { GpuCompositor } from '../effects/gpu/compositor';
import { getGpuEffectDefaultParams } from '../effects/gpu/registry';

afterEach(() => mediaPool.clear());

it('keeps GPU box blur proportional when reducing a video export resolution', async () => {
	const sourceCanvas = new OffscreenCanvas(128, 64);
	const sourceContext = sourceCanvas.getContext('2d')!;
	sourceContext.fillStyle = '#ff0000';
	sourceContext.fillRect(0, 0, 64, 64);
	sourceContext.fillStyle = '#0000ff';
	sourceContext.fillRect(64, 0, 64, 64);
	const target = new BufferTarget();
	const output = new Output({ target, format: new Mp4OutputFormat() });
	const source = new VideoSampleSource({ codec: 'avc', bitrate: 1_000_000 });
	output.addVideoTrack(source, { frameRate: 30 });
	await output.start();
	const sample = new VideoSample(sourceCanvas, {
		timestamp: 0,
		duration: 1 / 30
	});
	await source.add(sample);
	sample.close();
	source.close();
	await output.finalize();
	const blob = new Blob([target.buffer!], { type: 'video/mp4' });
	const url = URL.createObjectURL(blob);
	mediaPool.upsert(
		{
			id: 'gpu-picture',
			storageType: 'cloud',
			remoteUrl: url,
			fileName: 'picture.mp4',
			fileSize: blob.size,
			mimeType: blob.type,
			codec: 'avc',
			bitrate: 1_000_000,
			width: 128,
			height: 64,
			duration: 1 / 30,
			fps: 30,
			tags: ['video']
		},
		'ready'
	);
	const project = createBlankProject('GPU blur scaling');
	project.metadata = { width: 128, height: 64, fps: 30 };
	project.timeline!.items = [
		{
			id: 'picture',
			type: 'video',
			mediaId: 'gpu-picture',
			trackId: 'track-video-main',
			from: 0,
			durationInFrames: 1,
			label: 'Picture',
			sourceWidth: 128,
			sourceHeight: 64,
			effects: [
				{
					id: 'blur',
					type: 'gpu',
					effectId: 'gpu-box-blur',
					enabled: true,
					params: { radius: 8 }
				}
			]
		}
	];
	const normal = new TimelineFrameRenderer(project);
	const small = new TimelineFrameRenderer(project, { width: 64, height: 32 });
	try {
		const nativePixel = (await normal.render(0)).getContext('2d')!.getImageData(54, 32, 1, 1).data;
		const smallPixel = (await small.render(0)).getContext('2d')!.getImageData(27, 16, 1, 1).data;
		// This location lies ten authored pixels before the color boundary, outside
		// an eight-pixel blur. A lower output resolution must not expand its reach.
		expect(nativePixel[2]).toBeLessThan(15);
		expect(smallPixel[2]).toBeLessThan(15);
	} finally {
		normal.dispose();
		small.dispose();
		URL.revokeObjectURL(url);
	}
});

it.each(['shape', 'text'] as const)(
	'keeps GPU blur on a rasterized %s proportional at reduced export resolution',
	async (type) => {
		const project = createBlankProject('Raster effect scaling');
		project.metadata = { width: 128, height: 128, fps: 30 };
		project.timeline!.items = [
			{
				id: 'raster',
				type,
				trackId: 'track-video-main',
				from: 0,
				durationInFrames: 1,
				label: 'Raster',
				text: 'I',
				color: '#ffffff',
				fontSize: 96,
				shapeType: 'ellipse',
				fillColor: '#ffffff',
				transform: { width: 100, height: 100 },
				effects: [
					{
						id: 'blur',
						type: 'gpu',
						effectId: 'gpu-box-blur',
						enabled: true,
						params: { radius: 8 }
					}
				]
			}
		];
		const normal = new TimelineFrameRenderer(project);
		const small = new TimelineFrameRenderer(project, { width: 64, height: 64 });
		try {
			const expectedCanvas = new OffscreenCanvas(64, 64);
			const expectedContext = expectedCanvas.getContext('2d')!;
			expectedContext.drawImage(await normal.render(0), 0, 0, 64, 64);
			const expected = expectedContext.getImageData(0, 0, 64, 64).data;
			const actual = (await small.render(0)).getContext('2d')!.getImageData(0, 0, 64, 64).data;
			let error = 0;
			let visiblePixels = 0;
			for (let i = 0; i < actual.length; i += 4) {
				error += Math.abs(actual[i]! - expected[i]!);
				if (expected[i]! > 128) visiblePixels++;
			}
			if (type === 'shape') {
				expect(visiblePixels).toBeGreaterThan(100);
				expect(error / (64 * 64)).toBeLessThan(3);
			} else {
				// Font hinting can change individual glyph pixels at a new size. Locate
				// the clean glyph edge, then check the authored eight-pixel blur reach.
				const cleanProject = structuredClone(project);
				cleanProject.timeline!.items[0]!.effects = [];
				const clean = new TimelineFrameRenderer(cleanProject, { width: 64, height: 64 });
				try {
					const cleanPixels = (await clean.render(0))
						.getContext('2d')!
						.getImageData(0, 32, 64, 1).data;
					const left = Array.from({ length: 64 }, (_, x) => x).find(
						(x) => cleanPixels[x * 4]! > 25
					)!;
					expect(left).toBeGreaterThan(15);
					expect(actual[(32 * 64 + left - 5) * 4]).toBeLessThan(2);
					expect(actual[(32 * 64 + left - 2) * 4]).toBeGreaterThan(5);
				} finally {
					clean.dispose();
				}
			}
		} finally {
			normal.dispose();
			small.dispose();
		}
	}
);

it.each<{ effectId: string; params: GpuParamValues }>([
	{ effectId: 'gpu-ascii', params: { asciiOpacity: 0, originalOpacity: 100, transparentBg: true } },
	{ effectId: 'gpu-pixel-sort-hq', params: { low: 1, high: 0 } }
])(
	'preserves actual source pixels for $effectId at lower preview quality',
	({ effectId, params }) => {
		const source = new OffscreenCanvas(32, 16);
		const context = source.getContext('2d')!;
		context.fillStyle = '#ff0000';
		context.fillRect(0, 0, 16, 16);
		context.fillStyle = '#0000ff';
		context.fillRect(16, 0, 16, 16);
		const canvas = new OffscreenCanvas(32, 16);
		const compositor = GpuCompositor.create(canvas)!;
		try {
			expect(
				compositor.render(
					source,
					32,
					16,
					[
						{
							effectId,
							params: { ...getGpuEffectDefaultParams(effectId), ...params }
						}
					],
					{ referenceSize: { width: 128, height: 64 } }
				)
			).toBe(true);
			context.drawImage(canvas, 0, 0);
			expect([...context.getImageData(4, 8, 1, 1).data]).toEqual([255, 0, 0, 255]);
			expect([...context.getImageData(28, 8, 1, 1).data]).toEqual([0, 0, 255, 255]);
		} finally {
			compositor.dispose();
		}
	}
);

it('keeps fluted glass margins fixed when preview raster quality changes', () => {
	const source = new OffscreenCanvas(64, 32);
	const context = source.getContext('2d')!;
	context.fillStyle = '#ff0000';
	context.fillRect(0, 0, 64, 32);
	const canvas = new OffscreenCanvas(64, 32);
	const compositor = GpuCompositor.create(canvas)!;
	try {
		expect(
			compositor.render(
				source,
				64,
				32,
				[
					{
						effectId: 'gpu-fluted-glass',
						params: {
							...getGpuEffectDefaultParams('gpu-fluted-glass'),
							marginRight: 0.25,
							shadows: 1,
							highlights: 0,
							distortion: 0,
							edges: 0
						}
					}
				],
				{ referenceSize: { width: 128, height: 64 } }
			)
		).toBe(true);
		context.drawImage(canvas, 0, 0);
		for (let x = 52; x < 60; x++)
			expect([...context.getImageData(x, 16, 1, 1).data]).toEqual([255, 0, 0, 255]);
	} finally {
		compositor.dispose();
	}
});

it('samples the correct picture region for dithering at lower preview quality', () => {
	const source = new OffscreenCanvas(32, 16);
	const context = source.getContext('2d')!;
	context.fillStyle = '#000000';
	context.fillRect(0, 0, 16, 16);
	context.fillStyle = '#ffffff';
	context.fillRect(16, 0, 16, 16);
	const canvas = new OffscreenCanvas(32, 16);
	const compositor = GpuCompositor.create(canvas)!;
	try {
		expect(
			compositor.render(
				source,
				32,
				16,
				[
					{
						effectId: 'gpu-dither',
						params: { ...getGpuEffectDefaultParams('gpu-dither'), palette: 'bw' }
					}
				],
				{ referenceSize: { width: 128, height: 64 } }
			)
		).toBe(true);
		context.drawImage(canvas, 0, 0);
		expect([...context.getImageData(5, 5, 1, 1).data]).toEqual([0, 0, 0, 255]);
		expect([...context.getImageData(29, 5, 1, 1).data]).toEqual([255, 255, 255, 255]);
	} finally {
		compositor.dispose();
	}
});

it.each<{
	effectId: string;
	params: GpuParamValues;
	base: number;
	amplitude: number;
	frequency: number;
}>([
	{
		effectId: 'gpu-vhs',
		params: { bleed: 0, waviness: 0, noise: 0, scanline: 1 },
		base: 0.82,
		amplitude: 0.18,
		frequency: Math.PI
	},
	{
		effectId: 'gpu-trigger-wave',
		params: { strength: 0, chroma: 0, speed: 0, scanlineMix: 1 },
		base: 0.78,
		amplitude: 0.22,
		frequency: 2.4
	}
])(
	'preserves authored scanline spacing for $effectId in a reduced preview',
	({ effectId, params, base, amplitude, frequency }) => {
		const source = new OffscreenCanvas(32, 16);
		const context = source.getContext('2d')!;
		context.fillStyle = '#ffffff';
		context.fillRect(0, 0, 32, 16);
		const canvas = new OffscreenCanvas(32, 16);
		const compositor = GpuCompositor.create(canvas)!;
		try {
			expect(
				compositor.render(
					source,
					32,
					16,
					[
						{
							effectId,
							params: { ...getGpuEffectDefaultParams(effectId), ...params }
						}
					],
					{ referenceSize: { width: 128, height: 64 } }
				)
			).toBe(true);
			context.drawImage(canvas, 0, 0);
			for (const y of [2, 5, 10]) {
				// A displayed row covers four source pixels. The source-space row center
				// controls the authored waveform, independent of preview quality.
				const referenceY = (16 - y - 0.5) * 4;
				const expected = Math.round((base + amplitude * Math.sin(referenceY * frequency)) * 255);
				expect(Math.abs(context.getImageData(16, y, 1, 1).data[0]! - expected)).toBeLessThan(2);
			}
		} finally {
			compositor.dispose();
		}
	}
);

it('keeps the full picture when a scatter effect renders a smaller preview raster', () => {
	const source = new OffscreenCanvas(128, 64);
	const context = source.getContext('2d')!;
	context.fillStyle = '#ff0000';
	context.fillRect(0, 0, 64, 64);
	context.fillStyle = '#0000ff';
	context.fillRect(64, 0, 64, 64);
	const canvas = new OffscreenCanvas(32, 16);
	const compositor = GpuCompositor.create(canvas)!;
	try {
		expect(
			compositor.render(
				source,
				32,
				16,
				[
					{
						effectId: 'gpu-pixel-sort-hq',
						params: { ...getGpuEffectDefaultParams('gpu-pixel-sort-hq'), low: 1, high: 0 }
					}
				],
				{ referenceSize: { width: 128, height: 64 } }
			)
		).toBe(true);
		const pixels = new OffscreenCanvas(32, 16).getContext('2d')!;
		pixels.drawImage(canvas, 0, 0);
		expect([...pixels.getImageData(4, 8, 1, 1).data]).toEqual([255, 0, 0, 255]);
		expect([...pixels.getImageData(28, 8, 1, 1).data]).toEqual([0, 0, 255, 255]);
	} finally {
		compositor.dispose();
	}
});
