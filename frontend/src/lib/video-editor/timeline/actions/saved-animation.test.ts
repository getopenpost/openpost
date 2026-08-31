import { beforeEach, describe, expect, it } from 'vitest';
import type { AnimationPreset, TimelineItem } from '$lib/video-editor/project/types';
import { commandHistory } from '../commands/command-store.svelte';
import { timelineStore } from '../stores/timeline-store.svelte';
import { transitionsStore } from './transitions-store.svelte';
import { applySavedAnimation } from './saved-animation';

function item(id: string, overrides: Partial<TimelineItem> = {}): TimelineItem {
	return {
		id,
		trackId: 'visual',
		from: 0,
		durationInFrames: 100,
		label: id,
		type: 'video',
		...overrides
	};
}

function preset(overrides: Partial<AnimationPreset> = {}): AnimationPreset {
	return {
		id: 'saved',
		name: 'Saved move',
		sourceItemType: 'video',
		properties: [
			{
				property: 'opacity',
				keyframes: [
					{ id: 'a', frame: 0, value: 0, easing: 'ease-in' },
					{ id: 'b', frame: 49, value: 1, easing: 'linear' }
				]
			}
		],
		effects: [],
		sourceDurationInFrames: 50,
		createdAt: 1,
		...overrides
	};
}

beforeEach(() => {
	timelineStore.__resetForTesting();
	commandHistory.clearHistory();
	transitionsStore.clear();
});

describe('applySavedAnimation', () => {
	it('retimes across several clips and records one undo step', () => {
		timelineStore._setItems([item('one'), item('two', { from: 120, durationInFrames: 50 })]);
		expect(
			applySavedAnimation({
				itemIds: ['one', 'two'],
				preset: preset(),
				mode: 'replace',
				retime: true
			})
		).toMatchObject({ ok: true, appliedItems: 2, writtenKeyframes: 4 });
		expect(timelineStore.itemById.get('one')?.keyframes?.opacity?.frames).toEqual([0, 99]);
		expect(timelineStore.itemById.get('two')?.keyframes?.opacity?.frames).toEqual([0, 49]);
		const sources = timelineStore.itemById.get('one')?.keyframes?.opacity?.sources;
		expect(sources?.[0]).toMatchObject({
			kind: 'saved-preset',
			presetId: 'saved',
			presetName: 'Saved move'
		});
		expect(sources?.[1]?.applicationId).toBe(sources?.[0]?.applicationId);
		expect(
			timelineStore.itemById.get('two')?.keyframes?.opacity?.sources?.[0]?.applicationId
		).not.toBe(sources?.[0]?.applicationId);
		expect(commandHistory.undoStack).toHaveLength(1);
	});

	it('keeps authored collisions in Add and clears only the incoming range in Replace', () => {
		timelineStore._setItems([
			item('one', {
				keyframes: {
					opacity: {
						frames: [0, 25, 80],
						values: [0.4, 0.5, 0.8],
						ids: ['authored', 'middle', 'late']
					}
				}
			})
		]);
		applySavedAnimation({
			itemIds: ['one'],
			preset: preset(),
			mode: 'add',
			retime: false
		});
		expect(timelineStore.itemById.get('one')?.keyframes?.opacity?.values[0]).toBe(0.4);
		applySavedAnimation({
			itemIds: ['one'],
			preset: preset(),
			mode: 'replace',
			retime: false
		});
		expect(timelineStore.itemById.get('one')?.keyframes?.opacity).toMatchObject({
			frames: [0, 49, 80],
			values: [0, 1, 0.8]
		});
	});

	it('applies every coupled transform lane and removes stale scalar components', () => {
		timelineStore._setItems([
			item('one', {
				keyframes: {
					width: { frames: [0], values: [400] },
					height: { frames: [0], values: [200] },
					anchorX: { frames: [0], values: [200] },
					anchorY: { frames: [0], values: [100] }
				},
				separatedVectorProperties: ['scale', 'anchor']
			})
		]);
		const recipe = preset({
			properties: [],
			vectorProperties: [
				{
					property: 'scale',
					keyframes: [{ id: 'scale', frame: 0, value: { x: 150, y: 75 }, easing: 'linear' }]
				},
				{
					property: 'anchor',
					keyframes: [{ id: 'anchor', frame: 0, value: { x: 250, y: 80 }, easing: 'linear' }]
				}
			]
		});
		expect(
			applySavedAnimation({
				itemIds: ['one'],
				preset: recipe,
				mode: 'replace',
				retime: false
			}).ok
		).toBe(true);
		const applied = timelineStore.itemById.get('one');
		expect(applied?.vectorKeyframes?.scale?.[0]?.value).toEqual({ x: 150, y: 75 });
		expect(applied?.vectorKeyframes?.anchor?.[0]?.value).toEqual({ x: 250, y: 80 });
		expect(applied?.keyframes).toBeUndefined();
		expect(applied?.separatedVectorProperties).toEqual([]);
	});

	it('remaps separate same-type effect instances and adds missing effects', () => {
		const recipe = preset({
			properties: [
				{
					property: 'effect:gpu-glow:source-a:strength',
					keyframes: [{ id: 'a', frame: 0, value: 0.2, easing: 'linear' }]
				},
				{
					property: 'effect:gpu-glow:source-b:strength',
					keyframes: [{ id: 'b', frame: 0, value: 0.8, easing: 'linear' }]
				}
			],
			effects: [
				{ id: 'source-a', type: 'gpu', effectId: 'gpu-glow', enabled: true, params: {} },
				{ id: 'source-b', type: 'gpu', effectId: 'gpu-glow', enabled: true, params: {} }
			]
		});
		timelineStore._setItems([
			item('one', {
				effects: [{ id: 'target-a', type: 'gpu', effectId: 'gpu-glow', enabled: true, params: {} }]
			})
		]);
		const result = applySavedAnimation({
			itemIds: ['one'],
			preset: recipe,
			mode: 'replace',
			retime: false
		});
		expect(result).toMatchObject({ ok: true, addedEffects: 1 });
		const applied = timelineStore.itemById.get('one')!;
		expect(applied.effects).toHaveLength(2);
		const effectProperties = Object.keys(applied.keyframes ?? {}).filter((property) =>
			property.startsWith('effect:gpu-glow:')
		);
		expect(effectProperties).toHaveLength(2);
		expect(new Set(effectProperties.map((property) => property.split(':')[2])).size).toBe(2);
	});

	it('restores live modifiers with fresh ids', () => {
		timelineStore._setItems([item('one')]);
		const recipe = preset({
			properties: [],
			motionModifiers: [
				{
					id: 'saved-spin',
					type: 'spin',
					enabled: true,
					amplitude: 1,
					frequency: 0.3,
					phaseFrames: 0,
					seed: 1
				}
			]
		});
		expect(
			applySavedAnimation({
				itemIds: ['one'],
				preset: recipe,
				mode: 'replace',
				retime: false
			}).ok
		).toBe(true);
		expect(timelineStore.itemById.get('one')?.motionModifiers?.[0]).toMatchObject({
			type: 'spin'
		});
		expect(timelineStore.itemById.get('one')?.motionModifiers?.[0]?.id).not.toBe('saved-spin');
	});

	it('replaces or merges saved text motion slots', () => {
		timelineStore._setItems([
			item('one', {
				type: 'text',
				textMotion: {
					out: {
						presetId: 'fade-down',
						durationFrames: 12,
						staggerFrames: 3,
						intensity: 1,
						order: 'forward',
						easing: 'ease-in',
						seed: 0
					}
				}
			})
		]);
		const recipe = preset({
			sourceItemType: 'text',
			properties: [],
			textMotion: {
				in: {
					presetId: 'rise',
					durationFrames: 14,
					staggerFrames: 4,
					intensity: 1,
					order: 'forward',
					easing: 'ease-out',
					seed: 0
				}
			}
		});
		expect(
			applySavedAnimation({ itemIds: ['one'], preset: recipe, mode: 'add', retime: false }).ok
		).toBe(true);
		expect(timelineStore.itemById.get('one')?.textMotion).toMatchObject({
			in: { presetId: 'rise' },
			out: { presetId: 'fade-down' }
		});
		expect(
			applySavedAnimation({ itemIds: ['one'], preset: recipe, mode: 'replace', retime: false }).ok
		).toBe(true);
		expect(timelineStore.itemById.get('one')?.textMotion).toMatchObject({
			in: { presetId: 'rise' }
		});
		expect(timelineStore.itemById.get('one')?.textMotion?.out).toBeUndefined();
	});

	it('aborts every target before mutation when a transition owns a required frame', () => {
		timelineStore._setItems([item('one'), item('two', { from: 100 })]);
		transitionsStore.setAll([
			{
				id: 'transition',
				type: 'crossfade',
				durationInFrames: 10,
				fromItemId: 'one',
				toItemId: 'two'
			}
		]);
		expect(
			applySavedAnimation({
				itemIds: ['one', 'two'],
				preset: preset(),
				mode: 'replace',
				retime: true
			})
		).toEqual({ ok: false, reason: 'transition-blocked' });
		expect(timelineStore.itemById.get('one')?.keyframes).toBeUndefined();
		expect(timelineStore.itemById.get('two')?.keyframes).toBeUndefined();
		expect(commandHistory.undoStack).toHaveLength(0);
	});
});
