import { afterEach, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import EffectThumbnail from './effect-thumbnail.svelte';

afterEach(() => vi.restoreAllMocks());

it('recovers a failed bundled poster without an unhandled rejection', async () => {
	const compile = vi.spyOn(WebGL2RenderingContext.prototype, 'compileShader');
	vi.spyOn(HTMLImageElement.prototype, 'decode').mockRejectedValueOnce(
		new Error('Poster unavailable')
	);
	const screen = await render(EffectThumbnail, {
		effectId: 'gpu-paper-heatmap',
		viewport: document.body
	});
	await expect.poll(() => screen.container.querySelector('canvas')?.dataset.rendered).toBe('true');
	expect(screen.container.querySelector('canvas')?.dataset.renderMode).toBe('fallback');
	expect(compile).not.toHaveBeenCalled();
});

it('keeps an empty preview safe when both poster and sample are unavailable', async () => {
	vi.spyOn(HTMLImageElement.prototype, 'decode').mockRejectedValueOnce(
		new Error('Poster unavailable')
	);
	let failures = 0;
	vi.spyOn(HTMLImageElement.prototype, 'src', 'set').mockImplementation(
		function (this: HTMLImageElement) {
			queueMicrotask(() => {
				failures++;
				this.dispatchEvent(new Event('error'));
			});
		}
	);
	const screen = await render(EffectThumbnail, {
		effectId: 'gpu-paper-water',
		viewport: document.body
	});
	await expect.poll(() => failures).toBe(2);
	await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
	expect(screen.container.querySelector('canvas')?.dataset.rendered).toBe('false');
});
