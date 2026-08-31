import { beforeEach, expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { colorPreviewStore } from '$lib/video-editor/effects/color-preview-store.svelte';
import { getGpuEffectDefaultParams } from '$lib/video-editor/effects/gpu/registry';
import type { TimelineItem, TimelineTrack } from '$lib/video-editor/project/types';
import { commandHistory } from '$lib/video-editor/timeline/commands/command-store.svelte';
import { timelineStore } from '$lib/video-editor/timeline/stores/timeline-store.svelte';
import ColorPrimaryControls from './color-primary-controls.svelte';

const track: TimelineTrack = {
	id: 'video-track',
	name: 'Video',
	kind: 'video',
	height: 64,
	locked: false,
	visible: true,
	muted: false,
	solo: false,
	order: 0
};

const item: TimelineItem = {
	id: 'video',
	trackId: track.id,
	from: 0,
	durationInFrames: 90,
	label: 'Interview',
	type: 'video'
};

beforeEach(() => {
	colorPreviewStore.__resetForTesting();
	timelineStore.__resetForTesting();
	timelineStore.setAll({ tracks: [track], items: [item], fps: 30 });
	commandHistory.clearHistory();
});

test('creates the real color-wheel effect from a keyboard wheel edit as one undo step', async () => {
	const onedit = vi.fn();
	const screen = await render(ColorPrimaryControls, { itemId: item.id, onedit });
	const wheels = screen.getByRole('slider', { name: /color wheel$/ }).elements();

	expect(wheels).toHaveLength(4);
	wheels[0]?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));

	await vi.waitFor(() => {
		const effect = timelineStore.itemById
			.get(item.id)
			?.effects?.find(
				(candidate) => candidate.type === 'gpu' && candidate.effectId === 'gpu-color-wheels'
			);
		expect(effect?.type === 'gpu' ? effect.params.shadowsAmount : null).toBeCloseTo(0.01);
	});
	expect(onedit).toHaveBeenCalledOnce();
	expect(commandHistory.undoStack).toHaveLength(1);

	commandHistory.undo();
	expect(timelineStore.itemById.get(item.id)?.effects).toBeUndefined();
});

test('scrubs the master with Shift precision and decomposes an edited RGB channel', async () => {
	const onedit = vi.fn();
	const screen = await render(ColorPrimaryControls, { itemId: item.id, onedit });
	const master = screen.getByRole('textbox', { name: 'Lift master' }).element();
	master.setPointerCapture = vi.fn();
	master.hasPointerCapture = vi.fn(() => false);
	master.dispatchEvent(
		new PointerEvent('pointerdown', {
			bubbles: true,
			button: 0,
			clientX: 100,
			pointerId: 4
		})
	);
	master.dispatchEvent(
		new PointerEvent('pointermove', {
			bubbles: true,
			clientX: 120,
			pointerId: 4,
			shiftKey: true
		})
	);
	master.dispatchEvent(
		new PointerEvent('pointerup', { bubbles: true, clientX: 120, pointerId: 4 })
	);

	await vi.waitFor(() => {
		const effect = timelineStore.itemById
			.get(item.id)
			?.effects?.find(
				(candidate) => candidate.type === 'gpu' && candidate.effectId === 'gpu-color-wheels'
			);
		expect(effect?.type === 'gpu' ? effect.params.lift : null).toBeCloseTo(0.02);
	});
	expect(commandHistory.undoStack).toHaveLength(1);

	const red = screen.getByRole('textbox', { name: 'Lift Red' }).element();
	red.focus();
	red.value = '0.12';
	red.dispatchEvent(
		new InputEvent('input', { bubbles: true, inputType: 'insertText', data: '0.12' })
	);
	red.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }));

	await vi.waitFor(() => {
		const effect = timelineStore.itemById
			.get(item.id)
			?.effects?.find(
				(candidate) => candidate.type === 'gpu' && candidate.effectId === 'gpu-color-wheels'
			);
		if (effect?.type !== 'gpu') throw new Error('Color wheels effect missing');
		expect(effect.params.lift).toBeCloseTo(0.0533, 4);
		expect(effect.params.shadowsHue).toBe(0);
		expect(effect.params.shadowsAmount).toBeCloseTo(0.1, 3);
	});
	expect(onedit).toHaveBeenCalledTimes(2);
	expect(commandHistory.undoStack).toHaveLength(2);
});

test('cancels a thumb-wheel keyboard preview without storing the draft', async () => {
	timelineStore.setAll({
		tracks: [track],
		items: [
			{
				...item,
				effects: [
					{
						id: 'wheels',
						type: 'gpu',
						effectId: 'gpu-color-wheels',
						enabled: true,
						params: getGpuEffectDefaultParams('gpu-color-wheels')
					}
				]
			}
		],
		fps: 30
	});
	const onedit = vi.fn();
	const screen = await render(ColorPrimaryControls, { itemId: item.id, onedit });
	const master = screen.getByRole('slider', { name: 'Lift thumb wheel' });
	const element = master.element();
	element.focus();
	element.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
	expect(colorPreviewStore.effectDraft?.params.lift).toBeGreaterThan(0);
	element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
	element.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowRight', bubbles: true }));

	await expect.element(master).toHaveAttribute('aria-valuenow', '0');
	expect(colorPreviewStore.effectDraft).toBeNull();
	const effect = timelineStore.itemById.get(item.id)?.effects?.[0];
	expect(effect?.type === 'gpu' ? effect.params.lift : null).toBe(0);
	expect(commandHistory.undoStack).toHaveLength(0);
	expect(onedit).not.toHaveBeenCalled();
});

test('uses Resolve display units for dock parameters and resets the stored grade', async () => {
	const onedit = vi.fn();
	const screen = await render(ColorPrimaryControls, { itemId: item.id, onedit });
	const temperature = screen.getByRole('textbox', { name: 'Temperature' }).element();
	const saturation = screen.getByRole('textbox', { name: 'Saturation' }).element();

	expect(temperature.value).toBe('0.0');
	expect(saturation.value).toBe('50.00');

	temperature.focus();
	temperature.value = '400.0';
	temperature.dispatchEvent(new InputEvent('input', { bubbles: true }));
	temperature.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }));
	saturation.focus();
	saturation.value = '75.00';
	saturation.dispatchEvent(new InputEvent('input', { bubbles: true }));
	saturation.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }));

	await vi.waitFor(() => {
		const effect = timelineStore.itemById
			.get(item.id)
			?.effects?.find(
				(candidate) => candidate.type === 'gpu' && candidate.effectId === 'gpu-color-wheels'
			);
		if (effect?.type !== 'gpu') throw new Error('Color wheels effect missing');
		expect(effect.params.temperature).toBe(10);
		expect(effect.params.saturation).toBe(50);
	});

	screen.getByRole('button', { name: 'Reset Temperature' }).element().click();
	await vi.waitFor(() => {
		const effect = timelineStore.itemById
			.get(item.id)
			?.effects?.find(
				(candidate) => candidate.type === 'gpu' && candidate.effectId === 'gpu-color-wheels'
			);
		expect(effect?.type === 'gpu' ? effect.params.temperature : null).toBe(0);
	});
	expect(onedit).toHaveBeenCalledTimes(3);
	expect(commandHistory.undoStack).toHaveLength(3);
});

test('resets, bypasses, and removes the wheel grade from the panel header', async () => {
	const onedit = vi.fn();
	const screen = await render(ColorPrimaryControls, { itemId: item.id, onedit });
	const wheel = screen.getByRole('slider', { name: 'Lift color wheel' });
	wheel.element().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
	await vi.waitFor(() =>
		expect(screen.getByRole('button', { name: 'Disable effect' })).toBeEnabled()
	);

	await screen.getByRole('button', { name: 'Reset effect to defaults' }).click();
	let effect = timelineStore.itemById.get(item.id)?.effects?.[0];
	expect(effect?.type === 'gpu' ? effect.params.shadowsAmount : null).toBe(0);

	await screen.getByRole('button', { name: 'Disable effect' }).click();
	effect = timelineStore.itemById.get(item.id)?.effects?.[0];
	expect(effect?.enabled).toBe(false);
	await expect.element(screen.getByRole('button', { name: 'Enable effect' })).toBeVisible();
	wheel.element().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
	effect = timelineStore.itemById.get(item.id)?.effects?.[0];
	expect(effect?.type === 'gpu' ? effect.params.shadowsAmount : null).toBe(0);

	await screen.getByRole('button', { name: 'Remove effect' }).click();
	expect(timelineStore.itemById.get(item.id)?.effects).toBeUndefined();
	expect(onedit).toHaveBeenCalledTimes(4);
	expect(commandHistory.undoStack).toHaveLength(4);
});
