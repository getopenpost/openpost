import { expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import '../../routes/layout.css';
import EditorColorScopes from './editor-color-scopes.svelte';
import ColorScopeOverlay from '$lib/video-editor/components/color-scope-overlay.svelte';
import { drawCpuScope } from '$lib/video-editor/effects/scope-cpu-renderer';

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

it('centers CPU parade channel labels away from the luma guide labels', () => {
	const canvas = document.createElement('canvas');
	canvas.width = 360;
	canvas.height = 120;
	const context = canvas.getContext('2d');
	if (!context) throw new Error('Expected a 2D canvas context');
	const labels: Array<{ text: string; x: number; y: number }> = [];
	const fillText = vi.spyOn(context, 'fillText').mockImplementation((text, x, y) => {
		const point = context.getTransform().transformPoint(new DOMPoint(x, y));
		labels.push({ text: String(text), x: point.x, y: point.y });
	});

	drawCpuScope(
		context,
		new ImageData(new Uint8ClampedArray([32, 64, 96, 255]), 1, 1),
		'parade',
		canvas.width,
		canvas.height
	);
	fillText.mockRestore();

	expect(labels.filter(({ text }) => ['R', 'G', 'B'].includes(text))).toEqual([
		{ text: 'R', x: 60, y: 12 },
		{ text: 'G', x: 180, y: 12 },
		{ text: 'B', x: 300, y: 12 }
	]);
});
