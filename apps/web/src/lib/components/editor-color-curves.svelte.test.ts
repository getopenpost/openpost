import { expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import '../../routes/layout.css';
import EditorColorCurves from './editor-color-curves.svelte';

it('keeps compact curve markers, hit targets, and strokes in screen space', async () => {
	await render(EditorColorCurves, {
		gpuEffect: { id: 'curves', enabled: true, params: {} },
		ondraft: vi.fn(),
		oncommit: vi.fn(),
		compact: true
	});

	const svg = document.querySelector<SVGSVGElement>('[data-curves-editor]');
	expect(svg).not.toBeNull();
	const plot = svg!.parentElement;
	expect(plot).not.toBeNull();
	plot!.style.cssText = 'flex: none; width: 1000px; height: 160px;';

	const marker = svg!.querySelector<SVGEllipseElement>('[data-curve-marker="1"]');
	const hitTarget = svg!.querySelector<SVGRectElement>('[data-curve-point="1"]');
	expect(marker).not.toBeNull();
	expect(hitTarget).not.toBeNull();

	await vi.waitFor(() => {
		const markerBox = marker!.getBoundingClientRect();
		const hitBox = hitTarget!.getBoundingClientRect();
		expect(markerBox.width).toBeCloseTo(14, 0);
		expect(markerBox.height).toBeCloseTo(14, 0);
		expect(hitBox.width).toBeCloseTo(44, 0);
		expect(hitBox.height).toBeCloseTo(44, 0);
	});

	expect(marker!.getAttribute('vector-effect')).toBe('non-scaling-stroke');
	expect(hitTarget!.getAttribute('vector-effect')).toBe('non-scaling-stroke');
	for (const stroke of svg!.querySelectorAll('line, path')) {
		expect(stroke.getAttribute('vector-effect')).toBe('non-scaling-stroke');
	}
});
