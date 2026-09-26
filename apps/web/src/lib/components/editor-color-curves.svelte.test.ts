import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { userEvent } from 'vitest/browser';
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

describe('curve point slider keyboard', () => {
	async function renderWithMiddlePoint() {
		const ondraft = vi.fn();
		const oncommit = vi.fn();
		const screen = await render(EditorColorCurves, {
			gpuEffect: {
				id: 'curves',
				enabled: true,
				params: {
					masterPoints: JSON.stringify([
						[0, 0],
						[0.5, 0.5],
						[1, 1]
					])
				}
			},
			ondraft,
			oncommit
		});
		const point = screen.getByRole('slider', { name: 'Master curve point 2' });
		(point.element() as HTMLElement).focus();
		await expect.element(point).toHaveFocus();
		return { point, ondraft, oncommit };
	}

	function middleOutput(call: unknown): number {
		const params = (call as [{ masterPoints: string }])[0];
		const parsed = JSON.parse(params.masterPoints) as Array<[number, number]>;
		return parsed[1]![1]!;
	}

	it('moves output in large steps with PageUp and PageDown', async () => {
		const { ondraft } = await renderWithMiddlePoint();
		await userEvent.keyboard('{PageUp}');
		expect(middleOutput(ondraft.mock.calls.at(-1))).toBeCloseTo(0.6, 10);
		await userEvent.keyboard('{PageDown}');
		expect(middleOutput(ondraft.mock.calls.at(-1))).toBeCloseTo(0.5, 10);
	});

	it('jumps output to min with Home and max with End', async () => {
		const { ondraft } = await renderWithMiddlePoint();
		await userEvent.keyboard('{Home}');
		expect(middleOutput(ondraft.mock.calls.at(-1))).toBe(0);
		await userEvent.keyboard('{End}');
		expect(middleOutput(ondraft.mock.calls.at(-1))).toBe(1);
	});

	it('keeps arrow small steps', async () => {
		const { ondraft } = await renderWithMiddlePoint();
		await userEvent.keyboard('{ArrowUp}');
		expect(middleOutput(ondraft.mock.calls.at(-1))).toBeCloseTo(0.51, 10);
	});
});
