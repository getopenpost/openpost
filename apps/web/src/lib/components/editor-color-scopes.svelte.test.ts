import { expect, it, vi, onTestFinished } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import '../../routes/layout.css';
import EditorColorScopes from './editor-color-scopes.svelte';
import ColorScopeOverlay from '$lib/video-editor/components/color-scope-overlay.svelte';
import { drawCpuScope } from '$lib/video-editor/effects/scope-cpu-renderer';
import { ScopeRenderer } from '$lib/video-editor/effects/gpu-scopes';

it('shows the sampled channel levels after graphics initialization', async () => {
	const create = vi.spyOn(ScopeRenderer, 'create');
	const savedScope = localStorage.getItem('timeline:scopes:stackLayout');
	localStorage.setItem('timeline:scopes:stackLayout', 'parade');
	onTestFinished(() => {
		create.mockRestore();
		if (savedScope === null) localStorage.removeItem('timeline:scopes:stackLayout');
		else localStorage.setItem('timeline:scopes:stackLayout', savedScope);
	});
	const source = new OffscreenCanvas(384, 216);
	const input = source.getContext('2d')!;
	input.fillStyle = '#808080';
	input.fillRect(0, 0, source.width, source.height);
	const screen = await render(EditorColorScopes, {
		itemId: 'gray',
		sample: { itemId: 'gray', source, image: null }
	});
	screen.container.style.width = '342px';
	await vi.waitFor(() => expect(create).toHaveBeenCalledOnce());
	await create.mock.results[0]!.value;
	await vi.waitFor(async () => {
		const canvas = screen.container.querySelector<HTMLCanvasElement>('[data-color-scope-canvas]')!;
		// Read presented pixels: WebGPU canvas contents are discarded after presentation.
		const screenshot = await page.screenshot({ element: canvas, save: false });
		const bitmap = await createImageBitmap(
			await (await fetch(`data:image/png;base64,${screenshot}`)).blob()
		);
		const snapshot = new OffscreenCanvas(bitmap.width, bitmap.height).getContext('2d')!;
		snapshot.drawImage(bitmap, 0, 0);
		bitmap.close();
		// A neutral 50% input places the red trace halfway up its lane, not at zero.
		const pixels = snapshot.getImageData(
			0,
			Math.floor(snapshot.canvas.height * 0.4),
			Math.floor(snapshot.canvas.width / 3),
			Math.max(1, Math.floor(snapshot.canvas.height * 0.2))
		).data;
		let redTrace = false;
		for (let offset = 0; offset < pixels.length; offset += 4) {
			if (pixels[offset]! > 100 && pixels[offset]! > pixels[offset + 1]! * 1.5) redTrace = true;
		}
		expect(redTrace).toBe(true);
	});
});

it('uses one readable shared overlay for CPU scope guides', async () => {
	const image = new ImageData(new Uint8ClampedArray([32, 64, 96, 255]), 1, 1);
	const screen = await render(EditorColorScopes, { itemId: '' });
	screen.container.style.width = '342px';
	const scopes = screen.container.querySelector('[data-scope-backend="cpu"]');
	const canvas = screen.container.querySelector<HTMLCanvasElement>('[data-color-scope-canvas]');
	if (!canvas) throw new Error('Expected the CPU scope canvas');
	const context = canvas.getContext('2d');
	if (!context) throw new Error('Expected a 2D canvas context');
	const fillRect = vi.spyOn(context, 'fillRect');
	const fillText = vi.spyOn(context, 'fillText');

	await screen.rerender({ itemId: '', sample: { itemId: '', source: null, image } });

	await vi.waitFor(() => {
		expect(fillRect.mock.calls.length).toBeGreaterThan(3);
		const bounds = canvas.getBoundingClientRect();
		const ratio = Math.min(2, window.devicePixelRatio || 1);
		expect(canvas.width).toBe(Math.round(bounds.width * ratio));
		expect(canvas.height).toBe(Math.round(bounds.height * ratio));
	});
	expect(fillText).not.toHaveBeenCalled();
	fillRect.mockRestore();
	fillText.mockRestore();

	expect(scopes).not.toBeNull();
	expect(scopes?.querySelectorAll('[data-scope-overlay="parade"]')).toHaveLength(1);
	const redLabel = Array.from(scopes?.querySelectorAll('span') ?? []).find(
		(candidate) => candidate.textContent?.trim() === 'R'
	);
	expect(redLabel).toBeDefined();
	expect(getComputedStyle(redLabel!).fontSize).toBe('10px');
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

it('suppresses canvas labels when an external guide layer owns them', () => {
	const canvas = document.createElement('canvas');
	canvas.width = 360;
	canvas.height = 120;
	const context = canvas.getContext('2d');
	if (!context) throw new Error('Expected a 2D canvas context');
	const fillText = vi.spyOn(context, 'fillText');
	const stroke = vi.spyOn(context, 'stroke');

	drawCpuScope(
		context,
		new ImageData(new Uint8ClampedArray([32, 64, 96, 255]), 1, 1),
		'parade',
		canvas.width,
		canvas.height,
		{ guideOwner: 'external' }
	);

	expect(fillText).not.toHaveBeenCalled();
	expect(stroke).not.toHaveBeenCalled();
	fillText.mockRestore();
	stroke.mockRestore();
});
