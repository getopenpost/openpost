import { describe, expect, it } from 'vitest';
import { TransitionPipeline } from './gpu/pipeline';
import { getGpuTransitionIds } from './gpu/registry';
import { transitionRegistry } from './registry';
import type { TransitionDefinition } from './types';
import './index';

const WIDTH = 40;
const HEIGHT = 30;
const BYTES_PER_PIXEL = 4;
const BYTES_PER_ROW = 256;
const PIXEL_THRESHOLD = 12;

function fixture(kind: 'outgoing' | 'incoming'): OffscreenCanvas {
	const canvas = new OffscreenCanvas(WIDTH, HEIGHT);
	const context = canvas.getContext('2d');
	if (!context) throw new Error('Canvas2D is unavailable.');
	const gradient = context.createLinearGradient(0, 0, WIDTH, HEIGHT);
	if (kind === 'outgoing') {
		gradient.addColorStop(0, '#e63232');
		gradient.addColorStop(0.5, '#f4c430');
		gradient.addColorStop(1, '#6414a8');
	} else {
		gradient.addColorStop(0, '#16b8e0');
		gradient.addColorStop(0.5, '#20d060');
		gradient.addColorStop(1, '#102878');
	}
	context.fillStyle = gradient;
	context.fillRect(0, 0, WIDTH, HEIGHT);
	context.fillStyle = kind === 'outgoing' ? '#ffffff' : '#080808';
	context.fillRect(kind === 'outgoing' ? 3 : WIDTH - 14, 4, 11, 8);
	context.strokeStyle = kind === 'outgoing' ? '#101010' : '#ffffff';
	context.lineWidth = 2;
	context.beginPath();
	context.moveTo(0, kind === 'outgoing' ? HEIGHT - 3 : 3);
	context.lineTo(WIDTH, kind === 'outgoing' ? 3 : HEIGHT - 3);
	context.stroke();
	return canvas;
}

function canvasPixels(canvas: OffscreenCanvas): Uint8ClampedArray {
	const context = canvas.getContext('2d', { willReadFrequently: true });
	if (!context) throw new Error('Canvas2D is unavailable.');
	return context.getImageData(0, 0, WIDTH, HEIGHT).data;
}

function defaultProperties(definition: TransitionDefinition): Record<string, unknown> {
	return Object.fromEntries(
		(definition.parameters ?? []).map((parameter) => [parameter.key, parameter.defaultValue])
	);
}

async function renderPixels(
	device: GPUDevice,
	pipeline: TransitionPipeline,
	id: string,
	left: OffscreenCanvas,
	right: OffscreenCanvas,
	progress: number,
	direction: string | undefined,
	properties: Record<string, unknown>
): Promise<Uint8Array> {
	const output = device.createTexture({
		size: { width: WIDTH, height: HEIGHT },
		format: 'rgba8unorm',
		usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC
	});
	const readback = device.createBuffer({
		size: BYTES_PER_ROW * HEIGHT,
		usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
	});
	try {
		expect(
			pipeline.renderToTexture(
				id,
				left,
				right,
				output,
				progress,
				WIDTH,
				HEIGHT,
				direction,
				properties
			),
			`${id} must submit its WebGPU render pass`
		).toBe(true);
		const encoder = device.createCommandEncoder();
		encoder.copyTextureToBuffer(
			{ texture: output },
			{ buffer: readback, bytesPerRow: BYTES_PER_ROW, rowsPerImage: HEIGHT },
			{ width: WIDTH, height: HEIGHT }
		);
		device.queue.submit([encoder.finish()]);
		await device.queue.onSubmittedWorkDone();
		await readback.mapAsync(GPUMapMode.READ);
		const padded = new Uint8Array(readback.getMappedRange());
		const pixels = new Uint8Array(WIDTH * HEIGHT * BYTES_PER_PIXEL);
		for (let row = 0; row < HEIGHT; row += 1) {
			pixels.set(
				padded.subarray(row * BYTES_PER_ROW, row * BYTES_PER_ROW + WIDTH * BYTES_PER_PIXEL),
				row * WIDTH * BYTES_PER_PIXEL
			);
		}
		return pixels;
	} finally {
		if (readback.mapState === 'mapped') readback.unmap();
		readback.destroy();
		output.destroy();
	}
}

function changedRatio(left: ArrayLike<number>, right: ArrayLike<number>): number {
	let changed = 0;
	for (let offset = 0; offset < left.length; offset += BYTES_PER_PIXEL) {
		if (
			Math.abs(left[offset]! - right[offset]!) > PIXEL_THRESHOLD ||
			Math.abs(left[offset + 1]! - right[offset + 1]!) > PIXEL_THRESHOLD ||
			Math.abs(left[offset + 2]! - right[offset + 2]!) > PIXEL_THRESHOLD ||
			Math.abs(left[offset + 3]! - right[offset + 3]!) > PIXEL_THRESHOLD
		) {
			changed += 1;
		}
	}
	return changed / (left.length / BYTES_PER_PIXEL);
}

describe('all 21 WebGPU transition shaders', () => {
	it('compile and render real endpoint and midpoint pixels on a GPU adapter', async () => {
		expect(navigator.gpu, 'Chromium must expose WebGPU for this proof').toBeDefined();
		const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
		expect(adapter, 'Chromium must provide a WebGPU adapter for this proof').not.toBeNull();
		const device = await adapter!.requestDevice();
		const validationErrors: string[] = [];
		device.addEventListener('uncapturederror', (event) => {
			validationErrors.push(event.error.message);
		});
		const pipeline = TransitionPipeline.create(device);
		expect(pipeline).not.toBeNull();
		const outgoing = fixture('outgoing');
		const incoming = fixture('incoming');
		const outgoingPixels = canvasPixels(outgoing);
		const incomingPixels = canvasPixels(incoming);
		const ids = getGpuTransitionIds();
		expect(ids).toHaveLength(21);

		try {
			for (const id of ids) {
				const definition = transitionRegistry.getDefinition(id);
				expect(definition, `${id} must have a product transition definition`).toBeDefined();
				const direction = definition!.directions?.[0];
				const properties = defaultProperties(definition!);
				const start = await renderPixels(
					device,
					pipeline!,
					id,
					outgoing,
					incoming,
					0,
					direction,
					properties
				);
				const midpoint = await renderPixels(
					device,
					pipeline!,
					id,
					outgoing,
					incoming,
					0.5,
					direction,
					properties
				);
				const end = await renderPixels(
					device,
					pipeline!,
					id,
					outgoing,
					incoming,
					1,
					direction,
					properties
				);
				expect(
					changedRatio(start, outgoingPixels),
					`${id} must start on the outgoing frame`
				).toBeLessThan(0.04);
				expect(
					changedRatio(end, incomingPixels),
					`${id} must end on the incoming frame`
				).toBeLessThan(0.04);
				expect(
					changedRatio(midpoint, outgoingPixels),
					`${id} midpoint must leave the outgoing frame`
				).toBeGreaterThan(0.04);
				expect(
					changedRatio(midpoint, incomingPixels),
					`${id} midpoint must not jump to the incoming frame`
				).toBeGreaterThan(0.04);
				if (definition!.hasDirection && (definition!.directions?.length ?? 0) > 1) {
					const firstDirection = await renderPixels(
						device,
						pipeline!,
						id,
						outgoing,
						incoming,
						0.37,
						definition!.directions![0],
						properties
					);
					const lastDirection = await renderPixels(
						device,
						pipeline!,
						id,
						outgoing,
						incoming,
						0.37,
						definition!.directions!.at(-1),
						properties
					);
					expect(
						changedRatio(firstDirection, lastDirection),
						`${id} must render advertised directions as different pixels`
					).toBeGreaterThan(0.03);
				}
			}
			await device.queue.onSubmittedWorkDone();
			expect(validationErrors).toEqual([]);
		} finally {
			pipeline?.destroy();
			device.destroy();
		}
	});
});
