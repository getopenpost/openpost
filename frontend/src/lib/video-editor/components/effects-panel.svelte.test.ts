import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import { setLocale } from '$lib/paraglide/runtime';
import type { TimelineItem, TimelineTrack } from '$lib/video-editor/project/types';
import { timelineStore } from '$lib/video-editor/timeline/stores/timeline-store.svelte';
import { clearEffectDragData, getEffectDragData } from '$lib/video-editor/timeline/effect-drop';
import { getGpuEffectDefaultParams } from '$lib/video-editor/effects/gpu/registry';
import { ensureEffectPreviewPipeline } from '$lib/video-editor/effects/preview/effect-preview-engine';
import { EFFECT_PRESETS_STORAGE_KEY } from '$lib/video-editor/effects/effect-presets';
import { commandHistory } from '$lib/video-editor/timeline/commands/command-store.svelte';
import { colorPreviewStore } from '$lib/video-editor/effects/color-preview-store.svelte';
import { spatialEffectEditorStore } from '$lib/video-editor/preview/spatial-effect-editor.svelte';
import EffectsPanel from './effects-panel.svelte';

const videoTrack: TimelineTrack = {
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

const videoItem: TimelineItem = {
	id: 'video',
	trackId: videoTrack.id,
	from: 0,
	durationInFrames: 60,
	label: 'Video',
	type: 'video'
};

beforeEach(() => {
	setLocale('en', { reload: false });
	clearEffectDragData();
	colorPreviewStore.__resetForTesting();
	spatialEffectEditorStore.__resetForTesting();
	localStorage.removeItem(EFFECT_PRESETS_STORAGE_KEY);
	timelineStore.__resetForTesting();
	timelineStore.setAll({
		tracks: [videoTrack],
		items: [{ ...videoItem, effects: undefined }],
		fps: 30
	});
});

afterEach(async () => {
	await page.viewport(1280, 900);
	setLocale('en', { reload: false });
	spatialEffectEditorStore.__resetForTesting();
});

describe('EffectsPanel spatial point editor', () => {
	it('uses one clear toggle and exits when the selection becomes incompatible', async () => {
		await page.viewport(390, 844);
		const twirl: TimelineItem = {
			...videoItem,
			effects: [
				{
					id: 'twirl',
					type: 'gpu',
					effectId: 'gpu-twirl',
					enabled: true,
					params: { amount: 1, radius: 0.5, centerX: 0.5, centerY: 0.5 }
				}
			]
		};
		const second = { ...twirl, id: 'video-2', label: 'Video 2' };
		timelineStore.setAll({ tracks: [videoTrack], items: [twirl, second], fps: 30 });
		const onedit = vi.fn();
		const screen = await render(EffectsPanel, {
			itemId: twirl.id,
			itemIds: [twirl.id],
			onedit
		});
		screen.container.style.width = '320px';
		const edit = screen.getByRole('button', { name: 'Edit Twirl center on canvas' });
		await expect.element(edit).toBeEnabled();
		await edit.click();
		expect(spatialEffectEditorStore.editingItemId).toBe(twirl.id);
		expect(spatialEffectEditorStore.editingEffectId).toBe('twirl');
		const stop = screen.getByRole('button', { name: 'Stop editing Twirl center' });
		expect(stop.element().getAttribute('aria-pressed')).toBe('true');
		await expect.element(screen.getByText('Editing center')).toBeVisible();
		expect(onedit).not.toHaveBeenCalled();
		expect(screen.container.scrollWidth).toBeLessThanOrEqual(screen.container.clientWidth);
		await page.screenshot({
			element: screen.container,
			path: '../../../../.svelte-kit/openpost-spatial-effect-toggle.png'
		});

		await screen.rerender({
			itemId: twirl.id,
			itemIds: [twirl.id, second.id],
			onedit
		});
		await vi.waitFor(() => expect(spatialEffectEditorStore.isEditing).toBe(false));
		await expect
			.element(screen.getByRole('button', { name: 'Edit Twirl center on canvas' }))
			.toBeDisabled();
	});
});

describe('EffectsPanel effect drag source', () => {
	it('runs effect stack actions from the row context menu', async () => {
		timelineStore.setAll({
			tracks: [videoTrack],
			items: [
				{
					...videoItem,
					effects: [
						{ id: 'brightness', type: 'brightness', enabled: true, amount: 1 },
						{ id: 'contrast', type: 'contrast', enabled: true, amount: 1 }
					]
				}
			],
			fps: 30
		});
		const onedit = vi.fn();
		const screen = await render(EffectsPanel, { itemId: 'video', onedit });
		const openBrightnessMenu = () => {
			const trigger = screen.container.querySelector<HTMLElement>(
				'[data-effect-id="brightness"] [data-effect-context-trigger]'
			);
			expect(trigger).not.toBeNull();
			trigger!.dispatchEvent(
				new MouseEvent('contextmenu', {
					bubbles: true,
					cancelable: true,
					clientX: 80,
					clientY: 80
				})
			);
		};

		openBrightnessMenu();
		await screen.getByRole('menuitem', { name: 'Move effect down' }).click();
		expect(timelineStore.itemById.get('video')?.effects?.map((effect) => effect.id)).toEqual([
			'contrast',
			'brightness'
		]);

		openBrightnessMenu();
		await screen.getByRole('menuitem', { name: 'Disable effect' }).click();
		expect(timelineStore.itemById.get('video')?.effects?.[1]?.enabled).toBe(false);

		openBrightnessMenu();
		await screen.getByRole('menuitem', { name: 'Remove effect' }).click();
		expect(timelineStore.itemById.get('video')?.effects?.map((effect) => effect.id)).toEqual([
			'contrast'
		]);
		expect(onedit).toHaveBeenCalledTimes(3);
	});

	it('localizes GPU effect choices in the rendered picker', async () => {
		setLocale('pt', { reload: false });
		await render(EffectsPanel, { itemId: 'video', onedit: vi.fn() });
		const addEffect = document.querySelector<HTMLButtonElement>(
			'button[aria-expanded][aria-label="Adicionar efeito"]'
		)!;
		addEffect.click();

		await vi.waitFor(() => {
			expect(document.querySelector('[data-effect-option="gpu:gpu-brightness"]')).not.toBeNull();
		});
		expect(
			document.querySelector('[data-effect-option="gpu:gpu-brightness"]')?.textContent
		).toContain('Luminosidade');
		addEffect.click();
	});

	it('shows real lazily-rendered previews in the searchable effect picker', async () => {
		await render(EffectsPanel, { itemId: 'video', onedit: vi.fn() });
		const picker = document.querySelector<HTMLButtonElement>(
			'button[aria-expanded][aria-label="Add effect"]'
		);
		expect(picker).not.toBeNull();
		picker!.click();
		expect(await ensureEffectPreviewPipeline()).not.toBeNull();

		await vi.waitFor(() => {
			expect(document.querySelector('[data-effect-option="brightness"] canvas')).not.toBeNull();
			expect(
				document.querySelector('[data-effect-option="gpu:gpu-brightness"] canvas')
			).not.toBeNull();
		});
		const cssCanvas = document.querySelector<HTMLCanvasElement>(
			'[data-effect-option="brightness"] canvas'
		);
		await vi.waitFor(() => expect(cssCanvas?.dataset.renderMode).toBe('css'));
		expect(cssCanvas?.dataset.rendered).toBe('true');

		const search = document.querySelector<HTMLInputElement>('[data-slot="command-input"]');
		expect(search).not.toBeNull();
		search!.value = 'pixelate';
		search!.dispatchEvent(new InputEvent('input', { bubbles: true }));
		await vi.waitFor(() => {
			expect(document.querySelector('[data-effect-option="gpu:gpu-pixelate"]')).not.toBeNull();
			expect(document.querySelector('[data-effect-option="brightness"]')).toBeNull();
		});
		const gpuCanvas = document.querySelector<HTMLCanvasElement>(
			'[data-effect-option="gpu:gpu-pixelate"] canvas'
		);
		await vi.waitFor(() => expect(gpuCanvas?.dataset.renderMode).toBe('gpu'), {
			timeout: 10_000
		});
		const pixels = gpuCanvas?.getContext('2d')?.getImageData(0, 0, 4, 4).data;
		expect(pixels && [...pixels].some((channel) => channel !== 0)).toBe(true);
		picker!.click();
	});

	it('only offers dragging when a clip is selected', async () => {
		const screen = await render(EffectsPanel, { itemId: null, onedit: vi.fn() });
		const picker = screen.getByRole('button', { name: 'Add effect' }).element();
		const dragHandle = screen.container.querySelector<HTMLElement>('[data-effect-drag-handle]');

		expect(picker.hasAttribute('disabled')).toBe(true);
		expect(dragHandle).not.toBeNull();
		expect(dragHandle?.hasAttribute('disabled')).toBe(true);
		expect(dragHandle?.getAttribute('draggable')).toBe('false');
	});

	it('publishes the selected effect for timeline dragover and clears it on drag end', async () => {
		const onedit = vi.fn();
		const screen = await render(EffectsPanel, { itemId: 'video', onedit });
		const dragHandle = screen.container.querySelector<HTMLElement>('[data-effect-drag-handle]');
		expect(dragHandle).not.toBeNull();
		const dataTransfer = new DataTransfer();

		dragHandle!.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer }));
		expect(getEffectDragData()).toEqual({
			type: 'timeline-effect',
			label: 'Brightness',
			effects: [{ kind: 'css', effectType: 'brightness' }]
		});
		expect(JSON.parse(dataTransfer.getData('application/json'))).toEqual(getEffectDragData());
		expect(onedit).not.toHaveBeenCalled();

		dragHandle!.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer }));
		expect(getEffectDragData()).toBeNull();
	});

	it('applies the selected effect immediately as one undoable edit', async () => {
		const onedit = vi.fn();
		const screen = await render(EffectsPanel, { itemId: 'video', onedit });
		const undoCount = commandHistory.undoStack.length;

		await screen.getByRole('button', { name: 'Add effect' }).click();
		document.querySelector<HTMLElement>('[data-effect-option="brightness"]')!.click();

		await vi.waitFor(() => {
			expect(timelineStore.itemById.get('video')?.effects).toMatchObject([
				{ type: 'brightness', amount: 1.2, enabled: true }
			]);
		});
		expect(onedit).toHaveBeenCalledTimes(1);
		expect(commandHistory.undoStack).toHaveLength(undoCount + 1);
		expect(commandHistory.getLastCommandType()).toBe('ADD_EFFECTS');
	});

	it('applies an exact built-in stack to every selected clip as one edit', async () => {
		timelineStore.setAll({
			tracks: [videoTrack],
			items: [videoItem, { ...videoItem, id: 'video-2', from: 90, label: 'Video 2' }],
			fps: 30
		});
		const onedit = vi.fn();
		const screen = await render(EffectsPanel, {
			itemId: 'video',
			itemIds: ['video', 'video-2'],
			onedit
		});
		document
			.querySelector<HTMLButtonElement>('button[aria-expanded][aria-label="Add effect"]')!
			.click();
		let presetSearch: HTMLInputElement | null = null;
		await vi.waitFor(() => {
			presetSearch = document.querySelector<HTMLInputElement>('[data-slot="command-input"]');
			expect(presetSearch).not.toBeNull();
		});
		presetSearch!.value = 'Noir';
		presetSearch!.dispatchEvent(new InputEvent('input', { bubbles: true }));
		let noir: HTMLElement | null = null;
		await vi.waitFor(() => {
			noir = document.querySelector<HTMLElement>('[data-effect-option="preset:noir"]');
			expect(noir).not.toBeNull();
			expect(noir?.querySelector<HTMLCanvasElement>('canvas')?.dataset.renderMode).toBe('gpu');
		});
		await screen.getByText('Noir', { exact: true }).click();

		await vi.waitFor(() => {
			for (const id of ['video', 'video-2']) {
				expect(timelineStore.itemById.get(id)?.effects).toMatchObject([
					{
						type: 'gpu',
						effectId: 'gpu-grayscale',
						params: { amount: 1 },
						enabled: true
					},
					{
						type: 'gpu',
						effectId: 'gpu-contrast',
						params: { amount: 1.3 },
						enabled: true
					}
				]);
			}
		});
		expect(onedit).toHaveBeenCalledTimes(1);
	});

	it('saves, previews, and deletes a full user effect preset', async () => {
		timelineStore.setAll({
			items: [
				{
					...videoItem,
					effects: [
						{ id: 'blur', type: 'blur', amount: 7, enabled: false },
						{
							id: 'contrast',
							type: 'gpu',
							effectId: 'gpu-contrast',
							params: { amount: 1.7 },
							enabled: true
						}
					]
				}
			]
		});
		const screen = await render(EffectsPanel, { itemId: 'video', onedit: vi.fn() });
		await screen.getByRole('button', { name: 'Save current effects as preset' }).click();
		const name = document.querySelector<HTMLInputElement>('[aria-label="Preset name"]');
		expect(name).not.toBeNull();
		name!.value = 'My stack';
		name!.dispatchEvent(new InputEvent('input', { bubbles: true }));
		await screen.getByText('Save', { exact: true }).click();

		await vi.waitFor(() => {
			const stored = localStorage.getItem(EFFECT_PRESETS_STORAGE_KEY);
			expect(stored).toContain('My stack');
			expect(stored).toContain('gpu-contrast');
		});
		document
			.querySelector<HTMLButtonElement>('button[aria-expanded][aria-label="Add effect"]')!
			.click();
		let presetSearch: HTMLInputElement | null = null;
		await vi.waitFor(() => {
			presetSearch = document.querySelector<HTMLInputElement>('[data-slot="command-input"]');
			expect(presetSearch).not.toBeNull();
		});
		presetSearch!.value = 'My stack';
		presetSearch!.dispatchEvent(new InputEvent('input', { bubbles: true }));
		let userOption: HTMLElement | null = null;
		await vi.waitFor(() => {
			userOption = document.querySelector<HTMLElement>('[data-effect-option^="user-preset:"]');
			expect(userOption).not.toBeNull();
			expect(userOption?.querySelector<HTMLCanvasElement>('canvas')?.dataset.renderMode).toBe(
				'gpu'
			);
		});
		await screen.getByRole('button', { name: 'Delete preset My stack' }).click();
		await vi.waitFor(() => {
			expect(localStorage.getItem(EFFECT_PRESETS_STORAGE_KEY)).toBe('[]');
		});
	});
});

describe('EffectsPanel stack controls', () => {
	it('keeps dedicated color effects out of the general stack and picker', async () => {
		timelineStore.setAll({
			tracks: [videoTrack],
			items: [
				{
					...videoItem,
					effects: [
						{
							id: 'wheels',
							type: 'gpu',
							effectId: 'gpu-color-wheels',
							enabled: true,
							params: getGpuEffectDefaultParams('gpu-color-wheels')
						},
						{ id: 'brightness', type: 'brightness', amount: 1.2, enabled: true }
					]
				}
			],
			fps: 30
		});
		const screen = await render(EffectsPanel, {
			itemId: 'video',
			onedit: vi.fn(),
			hiddenGpuEffectIds: ['gpu-color-wheels', 'gpu-curves']
		});

		expect(screen.container.querySelector('[data-effect-id="wheels"]')).toBeNull();
		expect(screen.container.querySelector('[data-effect-id="brightness"]')).not.toBeNull();
		await screen.getByRole('button', { name: 'Add effect' }).click();
		expect(document.querySelector('[data-effect-option="gpu:gpu-color-wheels"]')).toBeNull();
		await screen.getByRole('button', { name: 'Add effect' }).click();

		await screen.getByRole('button', { name: 'Disable all effects' }).click();
		await vi.waitFor(() => {
			expect(timelineStore.itemById.get('video')?.effects).toMatchObject([
				{ id: 'wheels', enabled: true },
				{ id: 'brightness', enabled: false }
			]);
		});
	});

	it('collapses modified controls and bypasses the selected stacks atomically', async () => {
		const stack = (prefix: string) => [
			{ id: `${prefix}-brightness`, type: 'brightness' as const, amount: 1.8, enabled: true },
			{ id: `${prefix}-contrast`, type: 'contrast' as const, amount: 1.25, enabled: true }
		];
		timelineStore.setAll({
			tracks: [videoTrack],
			items: [
				{ ...videoItem, effects: stack('video') },
				{ ...videoItem, id: 'video-2', from: 90, effects: stack('video-2') }
			],
			fps: 30
		});
		commandHistory.clearHistory();
		const onedit = vi.fn();
		const screen = await render(EffectsPanel, {
			itemId: 'video',
			itemIds: ['video', 'video-2'],
			onedit
		});

		const brightnessRow = screen.container.querySelector<HTMLElement>(
			'[data-effect-id="video-brightness"]'
		);
		expect(brightnessRow).not.toBeNull();
		await screen.getByRole('button', { name: 'Brightness', exact: true }).click();
		expect(brightnessRow?.querySelector('[role="slider"]')).toBeNull();
		const modifiedMarker = brightnessRow?.querySelector<HTMLElement>('[data-effect-modified]');
		expect(modifiedMarker?.getAttribute('aria-label')).toBe('Modified from defaults');
		expect(modifiedMarker?.querySelector('[aria-hidden="true"]')).not.toBeNull();

		await screen.getByRole('button', { name: 'Disable all effects' }).click();
		await vi.waitFor(() => {
			for (const id of ['video', 'video-2']) {
				expect(timelineStore.itemById.get(id)?.effects?.every((effect) => !effect.enabled)).toBe(
					true
				);
			}
		});
		expect(onedit).toHaveBeenCalledTimes(1);
		expect(commandHistory.undoStack).toHaveLength(1);
		expect(commandHistory.getLastCommandType()).toBe('SET_ALL_EFFECTS_ENABLED');

		commandHistory.undo();
		for (const id of ['video', 'video-2']) {
			expect(timelineStore.itemById.get(id)?.effects?.every((effect) => effect.enabled)).toBe(true);
		}
	});

	it('reorders, resets, bypasses, and removes an effect with one edit per action', async () => {
		timelineStore.setAll({
			items: [
				{
					...videoItem,
					effects: [
						{ id: 'brightness', type: 'brightness', amount: 1.8, enabled: true },
						{ id: 'contrast', type: 'contrast', amount: 1.25, enabled: true }
					]
				}
			]
		});
		const onedit = vi.fn();
		await render(EffectsPanel, { itemId: 'video', itemIds: ['video'], onedit });

		const brightness = document.querySelector<HTMLElement>('[data-effect-id="brightness"]');
		expect(brightness).not.toBeNull();
		brightness!.querySelector<HTMLButtonElement>('[aria-label="Move effect down"]')!.click();
		await vi.waitFor(() => {
			expect(timelineStore.itemById.get('video')?.effects?.map((effect) => effect.id)).toEqual([
				'contrast',
				'brightness'
			]);
		});

		brightness!
			.querySelector<HTMLButtonElement>('[aria-label="Reset effect to defaults"]')!
			.click();
		await vi.waitFor(() => {
			expect(timelineStore.itemById.get('video')?.effects?.[1]).toMatchObject({
				id: 'brightness',
				amount: 1.2
			});
		});

		const contrast = document.querySelector<HTMLElement>('[data-effect-id="contrast"]');
		contrast!.querySelector<HTMLButtonElement>('[aria-label="Disable effect"]')!.click();
		await vi.waitFor(() => {
			expect(timelineStore.itemById.get('video')?.effects?.[0]?.enabled).toBe(false);
			expect(contrast?.dataset.enabled).toBe('false');
		});

		brightness!.querySelector<HTMLButtonElement>('[aria-label="Remove effect"]')!.click();
		await vi.waitFor(() => {
			expect(timelineStore.itemById.get('video')?.effects?.map((effect) => effect.id)).toEqual([
				'contrast'
			]);
		});
		expect(onedit).toHaveBeenCalledTimes(4);
	});
});

describe('EffectsPanel typed GPU controls', () => {
	it('coalesces a direct curve keyboard gesture into one undoable edit', async () => {
		const curveParams = getGpuEffectDefaultParams('gpu-curves');
		timelineStore.setAll({
			tracks: [videoTrack],
			items: [
				{
					...videoItem,
					effects: [
						{
							id: 'curves-effect',
							type: 'gpu',
							effectId: 'gpu-curves',
							enabled: true,
							params: { ...curveParams }
						}
					]
				},
				{
					...videoItem,
					id: 'video-2',
					from: 90,
					label: 'Video 2',
					effects: [
						{
							id: 'curves-effect-2',
							type: 'gpu',
							effectId: 'gpu-curves',
							enabled: true,
							params: { ...curveParams }
						}
					]
				}
			],
			fps: 30
		});
		const onedit = vi.fn();
		const screen = await render(EffectsPanel, {
			itemId: 'video',
			itemIds: ['video', 'video-2'],
			onedit
		});
		const point = screen.getByRole('slider', { name: 'Master curve point 2' }).element();
		const undoCount = commandHistory.undoStack.length;
		point.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
		point.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
		expect(colorPreviewStore.effectDraft?.effectIds.toSorted()).toEqual([
			'curves-effect',
			'curves-effect-2'
		]);

		await vi.waitFor(
			() => {
				for (const id of ['video', 'video-2']) {
					const effect = timelineStore.itemById.get(id)?.effects?.[0];
					expect(effect?.type === 'gpu' ? effect.params.masterPoints : undefined).toContain('0.27');
				}
			},
			{ timeout: 1_000 }
		);
		expect(onedit).toHaveBeenCalledTimes(1);
		expect(commandHistory.undoStack).toHaveLength(undoCount + 1);
		expect(commandHistory.getLastCommandType()).toBe('SET_GPU_EFFECT_DATA_ON_ITEMS');

		commandHistory.undo();
		await vi.waitFor(() => {
			for (const id of ['video', 'video-2']) {
				const effect = timelineStore.itemById.get(id)?.effects?.[0];
				expect(effect?.type === 'gpu' ? effect.params.masterPoints : undefined).toBe('');
			}
		});
	});

	it('keeps base parameter editing available when the playhead is outside the clip', async () => {
		timelineStore.setAll({
			tracks: [videoTrack],
			items: [
				{
					...videoItem,
					effects: [
						{
							id: 'contrast-effect',
							type: 'gpu',
							effectId: 'gpu-contrast',
							enabled: true,
							params: { amount: 1 }
						}
					]
				}
			],
			currentFrame: 90,
			fps: 30
		});
		const onedit = vi.fn();
		const screen = await render(EffectsPanel, { itemId: 'video', onedit });
		const amountSlider = screen.getByRole('slider', { name: 'Contrast: Amount' }).element();
		amountSlider.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
		amountSlider.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowRight', bubbles: true }));

		await vi.waitFor(() => {
			expect(timelineStore.itemById.get('video')?.effects?.[0]).toMatchObject({
				params: { amount: 1.01 }
			});
		});
		expect(timelineStore.itemById.get('video')?.keyframes).toBeUndefined();
		expect(
			screen
				.getByRole('button', { name: 'Add Contrast: Amount keyframe' })
				.element()
				.hasAttribute('disabled')
		).toBe(true);
		expect(onedit).toHaveBeenCalledTimes(1);
	});

	it('adds, removes, and auto-writes parameter keyframes at the playhead', async () => {
		timelineStore.setAll({
			tracks: [videoTrack],
			items: [
				{
					...videoItem,
					effects: [
						{
							id: 'contrast-effect',
							type: 'gpu',
							effectId: 'gpu-contrast',
							enabled: true,
							params: { amount: 1 }
						}
					]
				}
			],
			currentFrame: 0,
			fps: 30
		});
		const onedit = vi.fn();
		const screen = await render(EffectsPanel, { itemId: 'video', onedit });
		const property = 'effect:gpu-contrast:contrast-effect:amount';

		await screen.getByRole('button', { name: 'Add Contrast: Amount keyframe' }).click();
		await vi.waitFor(() => {
			expect(timelineStore.itemById.get('video')?.keyframes?.[property]).toMatchObject({
				frames: [0],
				values: [1]
			});
		});
		await screen.getByRole('button', { name: 'Remove Contrast: Amount keyframe' }).click();
		await vi.waitFor(() => {
			expect(timelineStore.itemById.get('video')?.keyframes?.[property]).toBeUndefined();
		});

		await screen.getByRole('button', { name: 'Enable auto-key for Contrast: Amount' }).click();
		await expect
			.element(screen.getByRole('button', { name: 'Disable auto-key for Contrast: Amount' }))
			.toHaveAttribute('aria-pressed', 'true');
		timelineStore._setCurrentFrame(15);
		const amountSlider = screen.getByRole('slider', { name: 'Contrast: Amount' }).element();
		amountSlider.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
		amountSlider.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowRight', bubbles: true }));
		await vi.waitFor(() => {
			expect(timelineStore.itemById.get('video')?.keyframes?.[property]).toMatchObject({
				frames: [15],
				values: [1.01]
			});
		});
		expect(onedit).toHaveBeenCalledTimes(3);
	});

	it('renders the ASCII control surface and commits conditional choices', async () => {
		timelineStore.setAll({
			tracks: [videoTrack],
			items: [
				{
					...videoItem,
					effects: [
						{
							id: 'ascii-effect',
							type: 'gpu',
							effectId: 'gpu-ascii',
							enabled: true,
							params: getGpuEffectDefaultParams('gpu-ascii')
						}
					]
				}
			],
			fps: 30
		});
		const onedit = vi.fn();
		const screen = await render(EffectsPanel, { itemId: 'video', onedit });

		await expect.element(screen.getByText('Character Set', { exact: true })).toBeVisible();
		await expect.element(screen.getByText('Font Size', { exact: true })).toBeVisible();
		await expect.element(screen.getByText('Background', { exact: true })).toBeVisible();
		expect(screen.getByText('Text Color', { exact: true }).query()).toBeNull();

		const matchSource = document.querySelector('[aria-label="ASCII: Match Source Color"]');
		expect(matchSource).toBeInstanceOf(HTMLElement);
		if (!(matchSource instanceof HTMLElement)) throw new Error('match-source checkbox missing');
		matchSource.click();
		await vi.waitFor(() => {
			const effect = timelineStore.itemById.get('video')?.effects?.[0];
			expect(effect?.type === 'gpu' ? effect.params.matchSourceColor : undefined).toBe(false);
		});
		await expect.element(screen.getByText('Text Color', { exact: true })).toBeVisible();
		const colorHex = document.querySelector('[aria-label="ASCII: Text Color hex"]');
		expect(colorHex).toBeInstanceOf(HTMLInputElement);
		if (!(colorHex instanceof HTMLInputElement)) throw new Error('text color input missing');
		colorHex.value = '#12345678';
		colorHex.dispatchEvent(new InputEvent('input', { bubbles: true }));
		colorHex.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
		await vi.waitFor(() => {
			const effect = timelineStore.itemById.get('video')?.effects?.[0];
			expect(effect?.type === 'gpu' ? effect.params.textColor : undefined).toBe('#12345678');
		});
		expect(onedit).toHaveBeenCalledTimes(2);
	});
});
