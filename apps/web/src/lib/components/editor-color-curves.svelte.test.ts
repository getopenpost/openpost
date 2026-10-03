import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { userEvent } from 'vitest/browser';
import '../../routes/layout.css';
import EditorColorCurves from './editor-color-curves.svelte';
import type { GpuParamValues } from '$lib/video-editor/effects/gpu/types';
import {
	createShortcutMatcher,
	DEFAULT_EDITOR_SHORTCUTS
} from '$lib/video-editor/settings/keyboard-shortcuts';

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
		const ondraft = vi.fn<(params: GpuParamValues | null) => void>();
		const gpuEffect = $state<{
			id: string;
			enabled: boolean;
			params: GpuParamValues;
		}>({
			id: 'curves',
			enabled: true,
			params: {
				masterPoints: JSON.stringify([
					[0, 0],
					[0.5, 0.5],
					[1, 1]
				])
			}
		});
		const oncommit = vi.fn((params: GpuParamValues) => {
			gpuEffect.params = params;
		});
		const screen = await render(EditorColorCurves, {
			gpuEffect,
			ondraft,
			oncommit
		});
		const point = screen.getByRole('slider', { name: 'Master curve point 2' });
		// SAFETY: curve-point slider locators resolve to HTMLElement hosts, which support focus().
		(point.element() as HTMLElement).focus();
		await expect.element(point).toHaveFocus();
		return { screen, point, ondraft, oncommit };
	}

	function middleOutput(call: [GpuParamValues | null] | undefined): number {
		// SAFETY: the assertion selects the last non-null draft because committing clears the transient preview.
		const params = call![0];
		// SAFETY: the curves panel serializes master points as a string param.
		const raw = params!.masterPoints as string;
		// SAFETY: the curves panel serializes master points as an array of [x, y] pairs.
		const parsed = JSON.parse(raw) as Array<[number, number]>;
		return parsed[1]![1]!;
	}

	it.each(['Delete', 'Backspace'])(
		'keeps %s on protected endpoints inside the curve editor',
		async (key) => {
			const { screen, oncommit } = await renderWithMiddlePoint();
			const deleteSelection = vi.fn();
			const handled: boolean[] = [];
			const listener = (event: KeyboardEvent) => {
				if (event.key !== key) return;
				handled.push(event.defaultPrevented);
				if (
					createShortcutMatcher(event, DEFAULT_EDITOR_SHORTCUTS)?.(
						'DELETE_SELECTED',
						'RIPPLE_DELETE'
					)
				) {
					deleteSelection();
				}
			};
			window.addEventListener('keydown', listener);
			try {
				for (const name of ['Master curve point 1', 'Master curve point 3']) {
					const endpoint = screen.getByRole('slider', { name });
					const element = endpoint.element();
					if (!(element instanceof SVGElement)) throw new Error('Expected an SVG curve point');
					element.focus();
					await expect.element(endpoint).toHaveFocus();
					await userEvent.keyboard(`{${key}}`);
					await expect.element(endpoint).toBeVisible();
				}
				expect(handled).toEqual([true, true]);
				expect(deleteSelection).not.toHaveBeenCalled();
				expect(oncommit).not.toHaveBeenCalled();
			} finally {
				window.removeEventListener('keydown', listener);
			}
		}
	);

	it.each(['Delete', 'Backspace'])('removes an interior point with %s', async (key) => {
		const { oncommit } = await renderWithMiddlePoint();
		await userEvent.keyboard(`{${key}}`);
		expect(oncommit).toHaveBeenCalledOnce();
		expect(JSON.parse(String(oncommit.mock.calls[0]![0].masterPoints))).toEqual([
			[0, 0],
			[1, 1]
		]);
	});

	it('moves output in large steps with PageUp and PageDown', async () => {
		const { ondraft } = await renderWithMiddlePoint();
		await userEvent.keyboard('{PageUp}');
		expect(middleOutput(ondraft.mock.calls.findLast(([params]) => params !== null))).toBeCloseTo(
			0.6,
			10
		);
		await userEvent.keyboard('{PageDown}');
		expect(middleOutput(ondraft.mock.calls.findLast(([params]) => params !== null))).toBeCloseTo(
			0.5,
			10
		);
	});

	it('jumps output to min with Home and max with End', async () => {
		const { ondraft } = await renderWithMiddlePoint();
		await userEvent.keyboard('{Home}');
		expect(middleOutput(ondraft.mock.calls.findLast(([params]) => params !== null))).toBe(0);
		await userEvent.keyboard('{End}');
		expect(middleOutput(ondraft.mock.calls.findLast(([params]) => params !== null))).toBe(1);
	});

	it('keeps arrow small steps', async () => {
		const { ondraft } = await renderWithMiddlePoint();
		await userEvent.keyboard('{ArrowUp}');
		expect(middleOutput(ondraft.mock.calls.findLast(([params]) => params !== null))).toBeCloseTo(
			0.51,
			10
		);
	});
});
