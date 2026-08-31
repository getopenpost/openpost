import { beforeEach, describe, expect, it } from 'vitest';
import type { TimelineItem, TimelineTrack } from '$lib/video-editor/project/types';
import { commandHistory } from '../commands/command-store.svelte';
import { timelineStore } from '../stores/timeline-store.svelte';
import {
	addEffectTemplates,
	addAdjustmentLayerWithEffects,
	addGpuEffect,
	isEffectAtDefaults,
	moveEffectOnItems,
	removeEffectOnItems,
	replaceColorGradeEffects,
	resetEffectOnItems,
	setAllEffectsEnabledOnItems,
	setEffectEnabledOnItems,
	setGpuEffectParam,
	upsertGpuEffectParams,
	upsertGpuEffectParamsOnItems
} from './effects';
import { getGpuEffectDefaultParams } from '$lib/video-editor/effects/gpu/registry';
import { buildEffectKeyframeProperty } from '$lib/video-editor/effects/effect-keyframes';

function track(id: string, kind: TimelineTrack['kind'], order: number): TimelineTrack {
	return {
		id,
		name: id,
		kind,
		height: 64,
		locked: false,
		visible: true,
		muted: false,
		solo: false,
		order
	};
}

function item(id: string, type: TimelineItem['type'], trackId: string): TimelineItem {
	return { id, trackId, from: 0, durationInFrames: 30, label: id, type };
}

beforeEach(() => {
	timelineStore.__resetForTesting();
	commandHistory.clearHistory();
	timelineStore.setAll({
		tracks: [track('video-track', 'video', 0), track('audio-track', 'audio', 1)],
		items: [
			item('video', 'video', 'video-track'),
			item('title', 'text', 'video-track'),
			item('audio', 'audio', 'audio-track')
		],
		fps: 30
	});
});

describe('addEffectTemplates', () => {
	it('creates a populated adjustment layer in one undo step', () => {
		const itemId = addAdjustmentLayerWithEffects('Warm', [
			{
				kind: 'gpu',
				effectId: 'gpu-temperature',
				params: { temperature: 0.3 }
			}
		]);
		expect(timelineStore.itemById.get(itemId)).toMatchObject({
			type: 'adjustment',
			effects: [
				{
					type: 'gpu',
					effectId: 'gpu-temperature',
					params: { temperature: 0.3 }
				}
			]
		});
		expect(commandHistory.undoStack).toHaveLength(1);
		expect(commandHistory.getLastCommandType()).toBe('ADD_ADJUSTMENT_LAYER_WITH_EFFECTS');

		commandHistory.undo();
		expect(timelineStore.itemById.has(itemId)).toBe(false);
	});

	it('applies fresh effect instances to visual clips as one undoable edit', () => {
		expect(
			addEffectTemplates(
				['video', 'title', 'audio'],
				[
					{ kind: 'css', effectType: 'brightness' },
					{ kind: 'gpu', effectId: 'gpu-gaussian-blur' }
				]
			)
		).toBe(true);

		const videoEffects = timelineStore.itemById.get('video')?.effects ?? [];
		const titleEffects = timelineStore.itemById.get('title')?.effects ?? [];
		expect(videoEffects).toHaveLength(2);
		expect(titleEffects).toHaveLength(2);
		expect(timelineStore.itemById.get('audio')?.effects).toBeUndefined();
		expect(videoEffects.map((effect) => effect.id)).not.toEqual(
			titleEffects.map((effect) => effect.id)
		);
		expect(commandHistory.undoStack).toHaveLength(1);
		expect(commandHistory.getLastCommandType()).toBe('ADD_EFFECTS');

		commandHistory.undo();
		expect(timelineStore.itemById.get('video')?.effects).toBeUndefined();
		expect(timelineStore.itemById.get('title')?.effects).toBeUndefined();
	});

	it('preserves preset parameters and bypass state while normalizing bad values', () => {
		expect(
			addEffectTemplates(
				['video'],
				[
					{ kind: 'css', effectType: 'blur', amount: 200, enabled: false },
					{
						kind: 'gpu',
						effectId: 'gpu-contrast',
						params: { amount: 99 },
						enabled: false
					}
				]
			)
		).toBe(true);
		expect(timelineStore.itemById.get('video')?.effects).toMatchObject([
			{ type: 'blur', amount: 20, enabled: false },
			{
				type: 'gpu',
				effectId: 'gpu-contrast',
				params: { amount: 3 },
				enabled: false
			}
		]);
	});
});

describe('setGpuEffectParam', () => {
	it('stores typed ASCII controls and rejects values outside the schema', () => {
		expect(addGpuEffect('video', 'gpu-ascii')).toBe(true);
		const effect = timelineStore.itemById
			.get('video')
			?.effects?.find((entry) => entry.type === 'gpu');
		if (!effect || effect.type !== 'gpu') throw new Error('ASCII effect missing');

		expect(setGpuEffectParam('video', effect.id, 'matchSourceColor', false)).toBe(true);
		expect(setGpuEffectParam('video', effect.id, 'charSet', 'custom')).toBe(true);
		expect(
			setGpuEffectParam(
				'video',
				effect.id,
				'customChars',
				'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*'
			)
		).toBe(true);
		expect(setGpuEffectParam('video', effect.id, 'font', 'comic-sans')).toBe(false);

		const updated = timelineStore.itemById
			.get('video')
			?.effects?.find((entry) => entry.id === effect.id);
		if (!updated || updated.type !== 'gpu') throw new Error('updated ASCII effect missing');
		expect(updated.params.matchSourceColor).toBe(false);
		expect(updated.params.charSet).toBe('custom');
		expect([...String(updated.params.customChars)]).toHaveLength(64);
		expect(updated.params.font).toBe('monospace');
	});
});

describe('effect stack actions', () => {
	beforeEach(() => {
		const defaults = getGpuEffectDefaultParams('gpu-gaussian-blur');
		const stack = (prefix: string) => [
			{
				id: `${prefix}-brightness`,
				type: 'brightness' as const,
				amount: 1.8,
				enabled: true
			},
			{
				id: `${prefix}-contrast`,
				type: 'contrast' as const,
				amount: 1.25,
				enabled: true
			},
			{
				id: `${prefix}-blur`,
				type: 'gpu' as const,
				effectId: 'gpu-gaussian-blur',
				params: { ...defaults, radius: 18 },
				enabled: false
			}
		];
		timelineStore._updateItems([
			{ id: 'video', patch: { effects: stack('video') } },
			{ id: 'title', patch: { effects: stack('title') } }
		]);
		commandHistory.clearHistory();
	});

	it('reorders, resets, bypasses, and removes mapped selected effects atomically', () => {
		const modifiedBlur = timelineStore.itemById.get('video')?.effects?.[2];
		if (!modifiedBlur) throw new Error('modified blur effect missing');
		expect(isEffectAtDefaults(modifiedBlur)).toBe(false);
		expect(moveEffectOnItems('video', ['video', 'title'], 'video-contrast', -1)).toBe(true);
		for (const itemId of ['video', 'title']) {
			expect(timelineStore.itemById.get(itemId)?.effects?.map((effect) => effect.type)).toEqual([
				'contrast',
				'brightness',
				'gpu'
			]);
		}
		expect(commandHistory.getLastCommandType()).toBe('MOVE_EFFECT');
		expect(moveEffectOnItems('video', ['video', 'title'], 'video-contrast', -1)).toBe(false);

		expect(resetEffectOnItems('video', ['video', 'title'], 'video-blur')).toBe(true);
		for (const itemId of ['video', 'title']) {
			const effect = timelineStore.itemById.get(itemId)?.effects?.[2];
			expect(effect && isEffectAtDefaults(effect)).toBe(true);
			expect(effect?.enabled).toBe(false);
		}

		expect(setEffectEnabledOnItems('video', ['video', 'title'], 'video-contrast', false)).toBe(
			true
		);
		expect(
			timelineStore.items
				.filter((candidate) => candidate.id === 'video' || candidate.id === 'title')
				.map((candidate) => candidate.effects?.[0]?.enabled)
		).toEqual([false, false]);

		expect(removeEffectOnItems('video', ['video', 'title'], 'video-brightness')).toBe(true);
		for (const itemId of ['video', 'title']) {
			expect(timelineStore.itemById.get(itemId)?.effects?.map((effect) => effect.type)).toEqual([
				'contrast',
				'gpu'
			]);
		}
		expect(commandHistory.undoStack).toHaveLength(4);
		expect(commandHistory.getLastCommandType()).toBe('REMOVE_EFFECTS');

		commandHistory.undo();
		expect(timelineStore.itemById.get('video')?.effects?.map((effect) => effect.type)).toEqual([
			'contrast',
			'brightness',
			'gpu'
		]);
	});

	it('bypasses and restores complete selected stacks as one undoable edit', () => {
		expect(setAllEffectsEnabledOnItems(['video', 'title', 'audio'], false)).toBe(true);
		for (const itemId of ['video', 'title']) {
			expect(timelineStore.itemById.get(itemId)?.effects?.every((effect) => !effect.enabled)).toBe(
				true
			);
		}
		expect(timelineStore.itemById.get('audio')?.effects).toBeUndefined();
		expect(commandHistory.undoStack).toHaveLength(1);
		expect(commandHistory.getLastCommandType()).toBe('SET_ALL_EFFECTS_ENABLED');
		expect(setAllEffectsEnabledOnItems(['video', 'title'], false)).toBe(false);

		commandHistory.undo();
		for (const itemId of ['video', 'title']) {
			expect(timelineStore.itemById.get(itemId)?.effects?.map((effect) => effect.enabled)).toEqual([
				true,
				true,
				false
			]);
		}
	});

	it('maps visible stack actions around hidden grading effects', () => {
		const wheels = (prefix: string) => ({
			id: `${prefix}-wheels`,
			type: 'gpu' as const,
			effectId: 'gpu-color-wheels',
			params: getGpuEffectDefaultParams('gpu-color-wheels'),
			enabled: true
		});
		for (const itemId of ['video', 'title']) {
			timelineStore._updateItems([
				{
					id: itemId,
					patch: {
						effects: [
							{
								id: `${itemId}-brightness`,
								type: 'brightness',
								amount: 1.2,
								enabled: true
							},
							wheels(itemId),
							{
								id: `${itemId}-contrast`,
								type: 'contrast',
								amount: 1,
								enabled: true
							}
						]
					}
				}
			]);
		}
		commandHistory.clearHistory();
		const hidden = ['gpu-color-wheels'];

		expect(moveEffectOnItems('video', ['video', 'title'], 'video-contrast', -1, hidden)).toBe(true);
		for (const itemId of ['video', 'title']) {
			expect(timelineStore.itemById.get(itemId)?.effects?.map((effect) => effect.type)).toEqual([
				'contrast',
				'gpu',
				'brightness'
			]);
		}

		expect(setAllEffectsEnabledOnItems(['video', 'title'], false, hidden)).toBe(true);
		for (const itemId of ['video', 'title']) {
			expect(timelineStore.itemById.get(itemId)?.effects?.map((effect) => effect.enabled)).toEqual([
				false,
				true,
				false
			]);
		}
		expect(commandHistory.undoStack).toHaveLength(2);
	});

	it('prunes mapped effect lanes when the owning effect leaves the stack', () => {
		for (const itemId of ['video', 'title']) {
			const effectId = `${itemId}-blur`;
			const property = buildEffectKeyframeProperty('gpu-gaussian-blur', effectId, 'radius');
			timelineStore._updateItems([
				{
					id: itemId,
					patch: {
						keyframes: {
							opacity: { frames: [0], values: [1] },
							[property]: { frames: [0], values: [18] }
						}
					}
				}
			]);
		}
		commandHistory.clearHistory();

		expect(removeEffectOnItems('video', ['video', 'title'], 'video-blur')).toBe(true);
		for (const itemId of ['video', 'title']) {
			const property = buildEffectKeyframeProperty('gpu-gaussian-blur', `${itemId}-blur`, 'radius');
			expect(timelineStore.itemById.get(itemId)?.keyframes?.[property]).toBeUndefined();
			expect(timelineStore.itemById.get(itemId)?.keyframes?.opacity).toBeDefined();
		}
		expect(commandHistory.undoStack).toHaveLength(1);
		commandHistory.undo();
		expect(timelineStore.itemById.get('video')?.keyframes).toHaveProperty(
			'effect:gpu-gaussian-blur:video-blur:radius'
		);
	});
});

describe('color grade actions', () => {
	it('lazily creates and then updates color wheels with one undo step per batch', () => {
		expect(
			upsertGpuEffectParams('video', 'gpu-color-wheels', {
				lift: -0.2,
				gain: 1.5,
				temperature: 20,
				tint: -10
			})
		).toBe(true);
		const created = timelineStore.itemById.get('video')?.effects?.[0];
		expect(created?.type === 'gpu' ? created.params : undefined).toMatchObject({
			lift: -0.2,
			gain: 1.5,
			temperature: 20,
			tint: -10
		});
		expect(commandHistory.undoStack).toHaveLength(1);

		expect(upsertGpuEffectParams('video', 'gpu-color-wheels', { gain: 2 })).toBe(true);
		const updated = timelineStore.itemById.get('video')?.effects?.[0];
		expect(updated?.id).toBe(created?.id);
		expect(updated?.type === 'gpu' ? updated.params.gain : undefined).toBe(2);
		expect(commandHistory.undoStack).toHaveLength(2);
	});

	it('replaces grades on several clips atomically while retaining non-color effects', () => {
		expect(addGpuEffect('video', 'gpu-color-wheels')).toBe(true);
		expect(addGpuEffect('video', 'gpu-gaussian-blur')).toBe(true);
		expect(addGpuEffect('title', 'gpu-curves')).toBe(true);
		commandHistory.clearHistory();

		expect(
			replaceColorGradeEffects(
				['video', 'title', 'audio'],
				[
					{
						effectId: 'gpu-color-wheels',
						params: { lift: -0.4 },
						enabled: true
					},
					{
						effectId: 'gpu-curves',
						params: { masterShadowY: 0.15 },
						enabled: true
					}
				]
			)
		).toBe(true);
		for (const itemId of ['video', 'title']) {
			const effects = timelineStore.itemById.get(itemId)?.effects ?? [];
			expect(
				effects.filter((effect) =>
					effect.type === 'gpu'
						? ['gpu-color-wheels', 'gpu-curves'].includes(effect.effectId)
						: false
				)
			).toHaveLength(2);
		}
		expect(
			timelineStore.itemById
				.get('video')
				?.effects?.some(
					(effect) => effect.type === 'gpu' && effect.effectId === 'gpu-gaussian-blur'
				)
		).toBe(true);
		expect(timelineStore.itemById.get('audio')?.effects).toBeUndefined();
		expect(commandHistory.undoStack).toHaveLength(1);
	});

	it('auto-balances every selected visual item in one undo step', () => {
		expect(
			upsertGpuEffectParamsOnItems(['video', 'title', 'audio'], 'gpu-color-wheels', {
				lift: -0.1,
				gain: 1.2
			})
		).toBe(true);
		for (const itemId of ['video', 'title']) {
			const effect = timelineStore.itemById.get(itemId)?.effects?.[0];
			expect(effect?.type === 'gpu' ? effect.params : undefined).toMatchObject({
				lift: -0.1,
				gain: 1.2
			});
		}
		expect(timelineStore.itemById.get('audio')?.effects).toBeUndefined();
		expect(commandHistory.undoStack).toHaveLength(1);
	});
});
