import { afterEach, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { getBackgroundPreset } from '../backgrounds/presets';
import BackgroundThumbnail from './background-thumbnail.svelte';

afterEach(() => vi.restoreAllMocks());

it('shows a background poster without compiling a shader while browsing', async () => {
	const compile = vi.spyOn(WebGL2RenderingContext.prototype, 'compileShader');
	const screen = await render(BackgroundThumbnail, {
		background: getBackgroundPreset('shader-paper-warp')!.background
	});
	await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
	await new Promise((resolve) => setTimeout(resolve, 250));
	expect(compile).not.toHaveBeenCalled();
	const poster = screen.container.querySelector('img')!;
	await poster.decode();
	expect(poster.naturalWidth).toBeGreaterThan(0);
});
