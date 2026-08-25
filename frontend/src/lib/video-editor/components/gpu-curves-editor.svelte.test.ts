import { expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import { getGpuEffectDefaultParams } from '$lib/video-editor/effects/gpu/registry';
import type { GpuEffect } from '$lib/video-editor/effects/types';
import GpuCurvesEditor from './gpu-curves-editor.svelte';

function curvesEffect(enabled = true): GpuEffect {
	return {
		id: 'curves-effect',
		type: 'gpu',
		effectId: 'gpu-curves',
		params: getGpuEffectDefaultParams('gpu-curves'),
		enabled
	};
}

function pointer(target: Element, type: string, x: number, y: number, pointerId = 1): void {
	target.dispatchEvent(
		new PointerEvent(type, {
			bubbles: true,
			button: 0,
			clientX: x,
			clientY: y,
			pointerId
		})
	);
}

it('adds and drags a point with live preview and one release commit', async () => {
	await page.viewport(320, 720);
	const ondraft = vi.fn();
	const oncommit = vi.fn();
	const screen = await render(GpuCurvesEditor, { gpuEffect: curvesEffect(), ondraft, oncommit });
	screen.container.style.width = '300px';
	screen.container.style.padding = '8px';
	screen.container.style.background = 'oklch(0.12 0.008 55)';
	const svg = screen.container.querySelector<SVGSVGElement>('[data-curves-editor]');
	expect(svg).not.toBeNull();
	svg!.style.width = '256px';
	svg!.style.height = '256px';
	const rect = svg!.getBoundingClientRect();
	const hit = svg!.querySelector('rect');
	expect(hit).not.toBeNull();

	pointer(hit!, 'pointerdown', rect.left + rect.width * 0.5, rect.top + rect.height * 0.3);
	pointer(svg!, 'pointermove', rect.left + rect.width * 0.6, rect.top + rect.height * 0.2);
	pointer(svg!, 'pointerup', rect.left + rect.width * 0.6, rect.top + rect.height * 0.2);

	await vi.waitFor(() => expect(oncommit).toHaveBeenCalledTimes(1));
	const rawCommitted = oncommit.mock.calls[0]?.[0];
	expect(rawCommitted).toBeDefined();
	// SAFETY: curves editor commits { masterPoints: string } payload once per drag.
	const committed = rawCommitted as { masterPoints: string };
	// SAFETY: masterPoints is JSON array of [x,y] pairs produced by serializeCurveChannelPoints.
	const points = JSON.parse(committed.masterPoints) as number[][];
	expect(points).toHaveLength(5);
	expect(points[2]?.[0]).toBeCloseTo(0.6, 1);
	expect(points[2]?.[1]).toBeCloseTo(0.8, 1);
	expect(ondraft.mock.calls.some(([value]) => value?.masterPoints)).toBe(true);
	expect(ondraft).toHaveBeenLastCalledWith(null);
	expect(screen.container.scrollWidth).toBeLessThanOrEqual(screen.container.clientWidth);
	for (const button of screen.container.querySelectorAll('button')) {
		expect(button.classList.contains('min-h-11') || button.classList.contains('size-11')).toBe(
			true
		);
	}
	for (const handle of screen.container.querySelectorAll('[data-curve-point]')) {
		expect(handle.getAttribute('width')).toBe('44');
		expect(handle.getAttribute('height')).toBe('44');
	}
	await page.screenshot({
		element: screen.container,
		path: '../../../../.svelte-kit/openpost-curves-editor-phone.png'
	});
	await screen.unmount();
});

it('coalesces keyboard nudges and supports an explicit inner-point removal', async () => {
	const ondraft = vi.fn();
	const oncommit = vi.fn();
	const screen = await render(GpuCurvesEditor, { gpuEffect: curvesEffect(), ondraft, oncommit });
	const point = screen.container.querySelector<SVGRectElement>('[data-curve-point="1"]');
	expect(point).not.toBeNull();
	point!.focus();
	point!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
	point!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));

	await vi.waitFor(() => expect(oncommit).toHaveBeenCalledTimes(1), { timeout: 1_000 });
	const rawNudged = oncommit.mock.calls[0]?.[0];
	expect(rawNudged).toBeDefined();
	// SAFETY: nudged commit payload is { masterPoints: string }.
	const nudgedRaw = rawNudged as { masterPoints: string };
	// SAFETY: parsed points are numeric [x,y] pairs.
	const nudged = JSON.parse(nudgedRaw.masterPoints) as number[][];
	expect(nudged[1]?.[1]).toBeCloseTo(0.27, 2);

	await screen.getByRole('button', { name: 'Remove selected point' }).click();
	await vi.waitFor(() => expect(oncommit).toHaveBeenCalledTimes(2));
	const rawRemoved = oncommit.mock.calls[1]?.[0];
	expect(rawRemoved).toBeDefined();
	// SAFETY: removed commit payload is { masterPoints: string }.
	const removedRaw = rawRemoved as { masterPoints: string };
	// SAFETY: parsed points are numeric [x,y] pairs.
	const removed = JSON.parse(removedRaw.masterPoints) as number[][];
	expect(removed).toHaveLength(3);
	await screen.unmount();
});

it('commits a pending keyboard edit to its original effect before props change', async () => {
	const firstCommit = vi.fn();
	const firstDraft = vi.fn();
	const secondCommit = vi.fn();
	const secondDraft = vi.fn();
	const screen = await render(GpuCurvesEditor, {
		gpuEffect: curvesEffect(),
		ondraft: firstDraft,
		oncommit: firstCommit
	});
	const point = screen.container.querySelector<SVGRectElement>('[data-curve-point="1"]');
	point?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
	await screen.rerender({
		gpuEffect: { ...curvesEffect(), id: 'second-curves-effect' },
		ondraft: secondDraft,
		oncommit: secondCommit
	});

	await vi.waitFor(() => expect(firstCommit).toHaveBeenCalledTimes(1));
	expect(secondCommit).not.toHaveBeenCalled();
	expect(firstDraft).toHaveBeenLastCalledWith(null);
	await screen.unmount();
});

it('reverts a captured pointer gesture when the browser cancels it', async () => {
	const ondraft = vi.fn();
	const oncommit = vi.fn();
	const screen = await render(GpuCurvesEditor, { gpuEffect: curvesEffect(), ondraft, oncommit });
	const svg = screen.container.querySelector<SVGSVGElement>('[data-curves-editor]');
	const point = screen.container.querySelector<SVGRectElement>('[data-curve-point="1"]');
	expect(svg).not.toBeNull();
	expect(point).not.toBeNull();
	const initialValue = point!.getAttribute('aria-valuetext');
	const rect = svg!.getBoundingClientRect();
	pointer(point!, 'pointerdown', rect.left + rect.width * 0.25, rect.top + rect.height * 0.75);
	pointer(svg!, 'pointermove', rect.left + rect.width * 0.5, rect.top + rect.height * 0.2);
	await vi.waitFor(() =>
		expect(ondraft.mock.calls.some(([value]) => value?.masterPoints)).toBe(true)
	);
	pointer(svg!, 'pointercancel', rect.left + rect.width * 0.5, rect.top + rect.height * 0.2);

	await vi.waitFor(() => {
		expect(
			screen.container
				.querySelector<SVGRectElement>('[data-curve-point="1"]')
				?.getAttribute('aria-valuetext')
		).toBe(initialValue);
	});
	expect(oncommit).not.toHaveBeenCalled();
	expect(ondraft).toHaveBeenLastCalledWith(null);
	await screen.unmount();
});

it('blocks graph changes while the effect is disabled', async () => {
	const ondraft = vi.fn();
	const oncommit = vi.fn();
	const screen = await render(GpuCurvesEditor, {
		gpuEffect: curvesEffect(false),
		ondraft,
		oncommit
	});
	const svg = screen.container.querySelector<SVGSVGElement>('[data-curves-editor]');
	const hit = svg?.querySelector('rect');
	expect(svg).not.toBeNull();
	expect(hit).not.toBeNull();
	pointer(hit!, 'pointerdown', 100, 100);
	pointer(svg!, 'pointerup', 100, 100);
	expect(oncommit).not.toHaveBeenCalled();
	expect(ondraft).not.toHaveBeenCalled();
	await screen.unmount();
});
