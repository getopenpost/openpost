import { describe, expect, it, vi } from 'vitest';
import { ShaderBackgroundRenderer } from './shader-renderer';
import { SHADER_PRESETS } from './shaders';
import { CanvasStackCompositor } from '../media/canvas-stack-compositor';
import type { TimelineItem } from '../project/types';

function pixels(source: OffscreenCanvas | HTMLCanvasElement): Uint8ClampedArray {
	const canvas = new OffscreenCanvas(source.width, source.height);
	const context = canvas.getContext('2d')!;
	context.drawImage(source, 0, 0);
	return context.getImageData(0, 0, canvas.width, canvas.height).data;
}

describe('shader background rendering', () => {
	it('blocks exact export on a failed shader frame and recovers on the next render', () => {
		const stack = new CanvasStackCompositor(new OffscreenCanvas(160, 90));
		const item: TimelineItem = {
			id: 'lost-context',
			trackId: 'video',
			type: 'background',
			label: 'Aurora',
			from: 0,
			durationInFrames: 90,
			background: SHADER_PRESETS[0]!.background,
			transform: { width: 160, height: 90 }
		};
		stack.beginFrame(160, 90, '#000000');
		stack.compositeLayer(null, item, 1, 0);
		const original = pixels(stack.getCanvasForTest());
		const failure = vi
			.spyOn(ShaderBackgroundRenderer.prototype, 'render')
			.mockImplementationOnce(() => {
				throw new Error('Shader graphics context was lost.');
			});
		try {
			stack.beginFrame(160, 90, '#000000');
			stack.compositeLayer(null, item, 1, 1);
			expect(() => stack.assertExactRender()).toThrow('Shader graphics context was lost.');
			stack.beginFrame(160, 90, '#000000');
			stack.compositeLayer(null, item, 1, 0);
			expect(stack.exactRenderFailureReason()).toBeNull();
			expect(pixels(stack.getCanvasForTest())).toEqual(original);
		} finally {
			failure.mockRestore();
			stack.dispose();
		}
	});

	for (const preset of SHADER_PRESETS) {
		it(`${preset.label} animates, seeks deterministically and renders in an export compositor`, () => {
			const renderer = new ShaderBackgroundRenderer();
			const stack = new CanvasStackCompositor(new OffscreenCanvas(160, 90));
			try {
				const first = pixels(renderer.render(preset.background, 160, 90, 0));
				const later = pixels(renderer.render(preset.background, 160, 90, 2));
				expect(new Set(first).size).toBeGreaterThan(20);
				expect(later).not.toEqual(first);
				expect(pixels(renderer.render(preset.background, 160, 90, 0))).toEqual(first);
				const item: TimelineItem = {
					id: 'shader',
					trackId: 'video',
					type: 'background',
					label: preset.label,
					from: 0,
					durationInFrames: 90,
					background: preset.background,
					transform: { width: 160, height: 90 }
				};
				stack.beginFrame(160, 90, '#000000');
				stack.compositeLayer(null, item, 1, 2);
				expect(stack.exactRenderFailureReason()).toBeNull();
				expect(pixels(stack.getCanvasForTest())).toEqual(later);
				stack.beginFrame(160, 90, '#000000');
				stack.compositeLayer(null, item, 1, 0);
				expect(pixels(stack.getCanvasForTest())).toEqual(first);
				const frozen = { ...preset.background, speed: 0, phase: 2 };
				expect(pixels(renderer.render(frozen, 160, 90, 10))).toEqual(
					pixels(renderer.render(frozen, 160, 90, 0))
				);
			} finally {
				renderer.dispose();
				stack.dispose();
			}
		});
	}
});
