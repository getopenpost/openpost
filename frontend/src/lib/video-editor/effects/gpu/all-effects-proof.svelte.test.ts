// oxlint-disable anti-slop/no-runtime-typeof -- test showcase param generation needs runtime union narrowing
import { describe, expect, it } from 'vitest';
import { CanvasStackCompositor } from '../../media/canvas-stack-compositor';
import { createGpuCompositor, type GpuCompositor } from './compositor';
import { GPU_EFFECT_CATALOG, getGpuEffect, getGpuEffectDefaultParams } from './registry';
import { createIdentityLutData, encodeLutData } from './lut';
import { serializeCurveChannelPoints } from './curves';
import type { GpuParamValues } from './types';
import type { TimelineItem } from '../../project/types';

const WIDTH = 64;
const HEIGHT = 48;
const DIFF_THRESHOLD = 6;
const PRESERVE_MAX_CHANGED_RATIO = 0.02;
const CHANGED_MIN_CHANGED_RATIO = 0.02;
const SHOWCASE_MIN_CHANGED_VS_DEFAULT = 0.02;

const PRESERVE_AT_DEFAULT = new Set<string>([
	'gpu-brightness',
	'gpu-contrast',
	'gpu-exposure',
	'gpu-hue-shift',
	'gpu-levels',
	'gpu-saturation',
	'gpu-temperature',
	'gpu-vibrance',
	'gpu-curves',
	'gpu-lut',
	'gpu-color-wheels',
	'gpu-secondary-qualifier'
]);

function makeFixture(width = WIDTH, height = HEIGHT): HTMLCanvasElement {
	const canvas = document.createElement('canvas');
	canvas.width = width;
	canvas.height = height;
	const context = canvas.getContext('2d');
	if (!context) throw new Error('2D canvas unavailable');
	const gradient = context.createLinearGradient(0, 0, width, height);
	gradient.addColorStop(0, '#0a0f1e');
	gradient.addColorStop(0.28, '#c03a1a');
	gradient.addColorStop(0.55, '#e8c24a');
	gradient.addColorStop(0.78, '#4aa0d8');
	gradient.addColorStop(1, '#faf6f0');
	context.fillStyle = gradient;
	context.fillRect(0, 0, width, height);
	context.fillStyle = '#00ff00';
	context.fillRect(3, 3, 14, 10);
	context.fillStyle = '#e040a0';
	context.fillRect(
		Math.floor(width / 3),
		Math.floor(height / 3),
		Math.floor(width / 3),
		Math.floor(height / 3)
	);
	context.fillStyle = '#0080ff';
	context.fillRect(width - 16, height - 12, 12, 8);
	for (let x = 0; x < width; x += 8) {
		context.fillStyle = x % 16 === 0 ? '#000000' : '#ffffff';
		context.fillRect(x, 0, 4, 6);
	}
	for (let x = 0; x < width; x += 6) {
		for (let y = height - 8; y < height; y += 4) {
			const on = (Math.floor(x / 6) + Math.floor((y - (height - 8)) / 4)) % 2 === 0;
			context.fillStyle = on ? '#111111' : '#eeeeee';
			context.fillRect(x, y, 6, 4);
		}
	}
	context.strokeStyle = '#ffffff';
	context.lineWidth = 1;
	context.beginPath();
	context.moveTo(0, 0);
	context.lineTo(width, height);
	context.stroke();
	context.strokeStyle = 'rgba(255,255,255,0.5)';
	context.lineWidth = 0.5;
	context.beginPath();
	context.moveTo(width, 0);
	context.lineTo(0, height);
	context.stroke();
	return canvas;
}

function readGlPixels(canvas: HTMLCanvasElement): Uint8Array {
	const gl = canvas.getContext('webgl2');
	if (!gl) throw new Error('WebGL2 unavailable');
	const data = new Uint8Array(canvas.width * canvas.height * 4);
	gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, data);
	return data;
}

function read2dPixels(canvas: HTMLCanvasElement): Uint8Array {
	const context = canvas.getContext('2d', { willReadFrequently: true });
	if (!context) throw new Error('2D canvas unavailable');
	return new Uint8Array(context.getImageData(0, 0, canvas.width, canvas.height).data);
}

function changedRatio(a: Uint8Array, b: Uint8Array, threshold = DIFF_THRESHOLD): number {
	let changed = 0;
	const total = a.length / 4;
	for (let i = 0; i < a.length; i += 4) {
		const dr = Math.abs((a[i] ?? 0) - (b[i] ?? 0));
		const dg = Math.abs((a[i + 1] ?? 0) - (b[i + 1] ?? 0));
		const db = Math.abs((a[i + 2] ?? 0) - (b[i + 2] ?? 0));
		const da = Math.abs((a[i + 3] ?? 0) - (b[i + 3] ?? 0));
		if (dr > threshold || dg > threshold || db > threshold || da > threshold) changed++;
	}
	return changed / total;
}

function meanAbsDiff(a: Uint8Array, b: Uint8Array): number {
	let sum = 0;
	for (let i = 0; i < a.length; i++) sum += Math.abs((a[i] ?? 0) - (b[i] ?? 0));
	return sum / a.length;
}

function warmLutEncoded(): string {
	const data = createIdentityLutData(2);
	for (let i = 0; i < data.length; i += 4) {
		const r = data[i] ?? 0;
		const b = data[i + 2] ?? 0;
		data[i] = Math.min(255, Math.round(r * 1.15 + 12));
		data[i + 2] = Math.max(0, Math.round(b * 0.92 - 4));
	}
	return encodeLutData(data);
}

function showcaseParams(effectId: string): GpuParamValues {
	const definition = getGpuEffect(effectId);
	if (!definition) return {};
	const defaults = getGpuEffectDefaultParams(effectId);
	const next: GpuParamValues = { ...defaults };
	switch (effectId) {
		case 'gpu-lut':
			return { ...next, intensity: 1, lutSize: 2, lutData: warmLutEncoded() };
		case 'gpu-curves':
			return {
				...next,
				masterPoints: serializeCurveChannelPoints([
					{ x: 0, y: 0 },
					{ x: 0.3, y: 0.08 },
					{ x: 0.7, y: 0.92 },
					{ x: 1, y: 1 }
				])
			};
		case 'gpu-gradient-map':
			return { ...next, preset: 'viridis', mix: 1 };
		case 'gpu-ascii':
			return { ...next, charSet: 'dense', font: 'courier', transparentBg: false };
		case 'gpu-dither':
			return { ...next, pattern: 'lines', mode: 'linear', angle: 22, cellSize: 12 };
		case 'gpu-chroma-key':
			return { ...next, keyColor: 'blue', tolerance: 0.25, softness: 0.12 };
		case 'gpu-secondary-qualifier':
			return {
				...next,
				invertMask: true,
				showMask: false,
				strength: 1,
				hueCenter: 120,
				exposure: 0.7,
				saturation: 0.6
			};
		case 'gpu-power-window':
			return { ...next, invertMask: true, sizeX: 0.3, sizeY: 0.3, feather: 0.1, exposure: 0.6 };
		case 'gpu-halftone':
			return { ...next, type: 'dots', grid: 'lines', size: 0.8, radius: 1.6 };
		case 'gpu-blocks':
			return { ...next, size: 18, depth: 0.9, studSize: 0.7 };
		default:
			break;
	}
	for (const param of definition.schema) {
		if (!param.type || param.type === 'number') {
			// oxlint-disable-next-line anti-slop/no-runtime-typeof -- numeric schema guard narrows union before SAFETY cast
			const raw = next[param.name];
			// SAFETY: raw is numeric when typeof check passes; param.default is numeric by schema.
			const current = typeof raw === 'number' ? (raw as number) : param.default;
			const range = param.max - param.min;
			if (range <= 0) continue;
			if (param.quality === true) continue;
			if (current === param.min) {
				next[param.name] = param.min + range * 0.75;
			} else if (current === param.max) {
				next[param.name] = param.max - range * 0.75;
			} else {
				const distToMin = current - param.min;
				const distToMax = param.max - current;
				if (distToMax >= distToMin) {
					next[param.name] = Math.min(param.max, current + range * 0.45);
				} else {
					next[param.name] = Math.max(param.min, current - range * 0.45);
				}
				// SAFETY: showcase value is numeric for number params; current is numeric.
				if (Math.abs((next[param.name] as number) - current) < param.step * 0.5) {
					next[param.name] = param.default === param.min ? param.max : param.min;
				}
			}
		} else if (param.type === 'select') {
			const options = param.options.map((entry) => entry.value);
			const current = String(next[param.name] ?? param.default);
			const other = options.find((value) => value !== current);
			if (other) next[param.name] = other;
		} else if (param.type === 'boolean') {
			// SAFETY: boolean params are stored as boolean by schema.
			next[param.name] = !(next[param.name] as boolean);
		} else if (param.type === 'color') {
			const current = String(next[param.name] ?? param.default).toLowerCase();
			next[param.name] = current === '#ff0000' ? '#00ff80' : '#ff0000';
		} else if (param.type === 'text') {
			if (param.name === 'customChars') next[param.name] = '01#@';
			else if (param.name === 'customStops')
				next[param.name] = '#ff0000, #ffff00, #00ffff, #0000ff';
			else {
				const current = String(next[param.name] ?? '');
				next[param.name] = current.length > 2 ? current.slice(0, 2) : `${current}XYZ`;
				if (param.maxLength !== undefined)
					next[param.name] = String(next[param.name]).slice(0, param.maxLength);
			}
		}
	}
	return next;
}

describe('all 54 FreeCut-parity GPU effects - browser proof', () => {
	it('catalog has 54 entries', () => {
		expect(GPU_EFFECT_CATALOG).toHaveLength(54);
		expect(new Set(GPU_EFFECT_CATALOG.map((entry) => entry.id)).size).toBe(54);
	});

	it('proves every effect through one reusable preview compositor and one shared export stack', () => {
		const width = WIDTH;
		const height = HEIGHT;
		const source = makeFixture(width, height);

		// One reusable WebGL2 compositor for the preview path.
		const previewCanvas = document.createElement('canvas');
		const previewCompositor: GpuCompositor | null = createGpuCompositor(previewCanvas);
		expect(previewCompositor).not.toBeNull();
		if (!previewCompositor) return;

		// One reusable export/shared stack (preview and export share CanvasStackCompositor).
		const exportCanvas = document.createElement('canvas');
		const exportStack = new CanvasStackCompositor(exportCanvas);

		// Baselines computed once, not per effect.
		const previewBaseline = (() => {
			const ok = previewCompositor.render(source, width, height, [], { time: 0 });
			expect(ok, previewCompositor.failureReason() ?? 'preview baseline failed').toBe(true);
			return readGlPixels(previewCanvas);
		})();
		const exportBaseline = (() => {
			exportStack.beginFrame(width, height, '#0a0f1e');
			const baseItem: TimelineItem = {
				id: 'baseline',
				trackId: 'track-0',
				from: 0,
				durationInFrames: 100,
				label: 'Baseline',
				type: 'image',
				transform: { width, height },
				effects: []
			};
			exportStack.compositeLayer({ source, width, height }, baseItem, 1, 0);
			return read2dPixels(exportCanvas);
		})();

		try {
			for (const entry of GPU_EFFECT_CATALOG) {
				const effectId = entry.id;
				const defaults = getGpuEffectDefaultParams(effectId);
				const showcase = showcaseParams(effectId);

				// Preview path - default.
				{
					const ok = previewCompositor.render(
						source,
						width,
						height,
						[{ effectId, params: defaults }],
						{ time: 0 }
					);
					expect(
						ok,
						previewCompositor.failureReason() ?? `preview default failed for ${effectId}`
					).toBe(true);
					const pixels = readGlPixels(previewCanvas);
					expect(pixels.length).toBe(width * height * 4);
					const ratio = changedRatio(previewBaseline, pixels);
					if (PRESERVE_AT_DEFAULT.has(effectId)) {
						expect(
							ratio,
							`${effectId} default should preserve (preview ${(ratio * 100).toFixed(1)}%)`
						).toBeLessThan(PRESERVE_MAX_CHANGED_RATIO);
					} else {
						const mean = meanAbsDiff(previewBaseline, pixels);
						expect(
							ratio > CHANGED_MIN_CHANGED_RATIO || mean > 0.8,
							`${effectId} default should change (preview ${(ratio * 100).toFixed(1)}%, mean ${mean.toFixed(2)})`
						).toBe(true);
						if (effectId === 'gpu-chroma-key') {
							let alphaChanged = 0;
							for (let i = 3; i < previewBaseline.length; i += 4)
								if (Math.abs((previewBaseline[i] ?? 0) - (pixels[i] ?? 0)) > DIFF_THRESHOLD)
									alphaChanged++;
							expect(alphaChanged, `${effectId} should change alpha`).toBeGreaterThan(0);
						}
					}
				}

				// Export/shared path - default.
				{
					exportStack.beginFrame(width, height, '#0a0f1e');
					const item: TimelineItem = {
						id: `def-${effectId}`,
						trackId: 'track-0',
						from: 0,
						durationInFrames: 100,
						label: entry.label,
						type: 'image',
						transform: { width, height },
						effects: [{ id: 'e', type: 'gpu', effectId, params: defaults, enabled: true }]
					};
					exportStack.compositeLayer({ source, width, height }, item, 1, 0);
					expect(
						exportStack.exactRenderFailureReason(),
						`export default failed for ${effectId}`
					).toBeNull();
					const pixels = read2dPixels(exportCanvas);
					const ratio = changedRatio(exportBaseline, pixels);
					if (PRESERVE_AT_DEFAULT.has(effectId)) {
						expect(
							ratio,
							`${effectId} default should preserve (export ${(ratio * 100).toFixed(1)}%)`
						).toBeLessThan(PRESERVE_MAX_CHANGED_RATIO);
					} else {
						const mean = meanAbsDiff(exportBaseline, pixels);
						expect(
							ratio > CHANGED_MIN_CHANGED_RATIO || mean > 0.8,
							`${effectId} default should change (export ${(ratio * 100).toFixed(1)}%, mean ${mean.toFixed(2)})`
						).toBe(true);
					}
				}

				// Preview + export with non-default showcase params - must still compile.
				let defaultPreviewPixels: Uint8Array | null = null;
				{
					const okDef = previewCompositor.render(
						source,
						width,
						height,
						[{ effectId, params: defaults }],
						{ time: 0 }
					);
					expect(okDef).toBe(true);
					defaultPreviewPixels = readGlPixels(previewCanvas);
					const okShow = previewCompositor.render(
						source,
						width,
						height,
						[{ effectId, params: showcase }],
						{ time: 0 }
					);
					expect(
						okShow,
						previewCompositor.failureReason() ?? `preview showcase failed for ${effectId}`
					).toBe(true);
					const showPixels = readGlPixels(previewCanvas);
					if (PRESERVE_AT_DEFAULT.has(effectId)) {
						const r = changedRatio(previewBaseline, showPixels);
						expect(
							r,
							`${effectId} showcase should change (preview ${(r * 100).toFixed(1)}%)`
						).toBeGreaterThan(CHANGED_MIN_CHANGED_RATIO);
					} else {
						const vsDefault = changedRatio(defaultPreviewPixels!, showPixels);
						const vsBaseline = changedRatio(previewBaseline, showPixels);
						expect(
							vsDefault > SHOWCASE_MIN_CHANGED_VS_DEFAULT || vsBaseline > CHANGED_MIN_CHANGED_RATIO,
							`${effectId} showcase should diverge (preview vsDefault ${(vsDefault * 100).toFixed(1)}% vsBaseline ${(vsBaseline * 100).toFixed(1)}%)`
						).toBe(true);
					}
					// Time-driven effects must accept time without shader error.
					const okTimed = previewCompositor.render(
						source,
						width,
						height,
						[{ effectId, params: showcase }],
						{ time: 1.37 }
					);
					expect(
						okTimed,
						previewCompositor.failureReason() ?? `preview timed failed for ${effectId}`
					).toBe(true);
				}

				{
					exportStack.beginFrame(width, height, '#0a0f1e');
					const defItem: TimelineItem = {
						id: `def2-${effectId}`,
						trackId: 'track-0',
						from: 0,
						durationInFrames: 100,
						label: entry.label,
						type: 'image',
						transform: { width, height },
						effects: [{ id: 'e', type: 'gpu', effectId, params: defaults, enabled: true }]
					};
					exportStack.compositeLayer({ source, width, height }, defItem, 1, 0);
					const defPixels = read2dPixels(exportCanvas);
					exportStack.beginFrame(width, height, '#0a0f1e');
					const showItem: TimelineItem = {
						id: `show-${effectId}`,
						trackId: 'track-0',
						from: 0,
						durationInFrames: 100,
						label: entry.label,
						type: 'image',
						transform: { width, height },
						effects: [{ id: 'e', type: 'gpu', effectId, params: showcase, enabled: true }]
					};
					exportStack.compositeLayer({ source, width, height }, showItem, 1, 0);
					expect(
						exportStack.exactRenderFailureReason(),
						`export showcase failed for ${effectId}`
					).toBeNull();
					const showPixels = read2dPixels(exportCanvas);
					if (PRESERVE_AT_DEFAULT.has(effectId)) {
						const r = changedRatio(exportBaseline, showPixels);
						expect(
							r,
							`${effectId} showcase should change (export ${(r * 100).toFixed(1)}%)`
						).toBeGreaterThan(CHANGED_MIN_CHANGED_RATIO);
					} else {
						const vsDefault = changedRatio(defPixels, showPixels);
						const vsBaseline = changedRatio(exportBaseline, showPixels);
						expect(
							vsDefault > SHOWCASE_MIN_CHANGED_VS_DEFAULT || vsBaseline > CHANGED_MIN_CHANGED_RATIO,
							`${effectId} showcase should diverge (export vsDefault ${(vsDefault * 100).toFixed(1)}% vsBaseline ${(vsBaseline * 100).toFixed(1)}%)`
						).toBe(true);
					}
					exportStack.beginFrame(width, height, '#0a0f1e');
					exportStack.compositeLayer({ source, width, height }, showItem, 1, 1.37);
					expect(
						exportStack.exactRenderFailureReason(),
						`export timed failed for ${effectId}`
					).toBeNull();
				}
			}

			// Chain two effects through the same ping-pong compositor.
			{
				const ok = previewCompositor.render(
					source,
					width,
					height,
					[
						{ effectId: 'gpu-brightness', params: { amount: 0.2 } },
						{ effectId: 'gpu-contrast', params: { amount: 1.4 } },
						{ effectId: 'gpu-vignette', params: getGpuEffectDefaultParams('gpu-vignette') }
					],
					{ time: 0 }
				);
				expect(ok, previewCompositor.failureReason() ?? 'chain failed').toBe(true);
				const chainPixels = readGlPixels(previewCanvas);
				expect(changedRatio(previewBaseline, chainPixels)).toBeGreaterThan(
					CHANGED_MIN_CHANGED_RATIO
				);
			}

			// Disabled stack preserves.
			{
				exportStack.beginFrame(width, height, '#0a0f1e');
				const disabled: TimelineItem = {
					id: 'disabled',
					trackId: 'track-0',
					from: 0,
					durationInFrames: 100,
					label: 'Disabled',
					type: 'image',
					transform: { width, height },
					effects: [
						{
							id: 'x',
							type: 'gpu',
							effectId: 'gpu-brightness',
							params: { amount: 0 },
							enabled: false
						}
					]
				};
				exportStack.compositeLayer({ source, width, height }, disabled, 1, 0);
				const disabledPixels = read2dPixels(exportCanvas);
				expect(changedRatio(exportBaseline, disabledPixels)).toBeLessThan(
					PRESERVE_MAX_CHANGED_RATIO
				);
			}
		} finally {
			previewCompositor.dispose();
			exportStack.dispose();
		}
	});
});
