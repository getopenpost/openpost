import { expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import '../../routes/layout.css';
import EditorColorScopes from './editor-color-scopes.svelte';
import ColorScopeOverlay from '$lib/video-editor/components/color-scope-overlay.svelte';

it('leaves guides to the CPU renderer when WebGPU is unavailable', async () => {
	const screen = await render(EditorColorScopes, { itemId: null });
	const scopes = screen.container.querySelector('[data-scope-backend="cpu"]');

	expect(scopes).not.toBeNull();
	expect(scopes?.querySelector('[data-scope-overlay]')).toBeNull();
});

it('keeps the luma endpoint labels inside the scope frame', async () => {
	const screen = await render(ColorScopeOverlay, { scope: 'waveform' });
	screen.container.style.cssText =
		'position: relative; display: block; width: 320px; height: 160px; overflow: hidden;';
	const frame = screen.container.getBoundingClientRect();
	const overlay = screen.container.querySelector('[data-scope-overlay="waveform"]');
	const labels = Array.from(overlay?.querySelectorAll('span') ?? []);

	for (const endpoint of ['100', '0']) {
		const label = labels.find((candidate) => candidate.textContent?.trim() === endpoint);
		expect(label, `Expected ${endpoint} scope label`).toBeDefined();
		const bounds = label!.getBoundingClientRect();
		expect(bounds.top).toBeGreaterThanOrEqual(frame.top);
		expect(bounds.bottom).toBeLessThanOrEqual(frame.bottom);
	}
});
