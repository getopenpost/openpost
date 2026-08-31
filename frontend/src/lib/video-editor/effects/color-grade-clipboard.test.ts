import { beforeEach, describe, expect, it } from 'vitest';
import type { TimelineItem, TimelineTrack } from '$lib/video-editor/project/types';
import { commandHistory } from '$lib/video-editor/timeline/commands/command-store.svelte';
import { timelineStore } from '$lib/video-editor/timeline/stores/timeline-store.svelte';
import { upsertGpuEffectParams } from '$lib/video-editor/timeline/actions/effects';
import { colorPreviewStore } from './color-preview-store.svelte';
import { copyColorGradeFromItem, pasteColorGradeToItems } from './color-grade-clipboard';

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

function item(overrides: Partial<TimelineItem>): TimelineItem {
	return {
		id: 'video',
		trackId: 'video-track',
		from: 0,
		durationInFrames: 30,
		label: 'Video',
		type: 'video',
		...overrides
	};
}

beforeEach(() => {
	colorPreviewStore.__resetForTesting();
	timelineStore.__resetForTesting();
	commandHistory.clearHistory();
	timelineStore.setAll({
		tracks: [track('video-track', 'video', 0), track('audio-track', 'audio', 1)],
		items: [
			item({
				effects: [
					{
						id: 'source-grade',
						type: 'gpu',
						effectId: 'gpu-color-wheels',
						params: { lift: -0.2, gain: 1.4 },
						enabled: true
					},
					{ id: 'source-blur', type: 'blur', amount: 4, enabled: true }
				]
			}),
			item({
				id: 'title',
				type: 'text',
				label: 'Title',
				effects: [
					{
						id: 'old-grade',
						type: 'gpu',
						effectId: 'gpu-curves',
						params: { masterShadowY: 0.1 },
						enabled: false
					},
					{ id: 'title-brightness', type: 'brightness', amount: 115, enabled: true }
				]
			}),
			item({ id: 'audio', trackId: 'audio-track', type: 'audio', label: 'Audio' })
		],
		fps: 30
	});
});

describe('color grade clipboard operations', () => {
	it('copies an independent grade and pastes it to visual targets as one undo step', () => {
		expect(copyColorGradeFromItem('video')).toEqual({ effectCount: 1, itemCount: 1 });
		expect(upsertGpuEffectParams('video', 'gpu-color-wheels', { lift: 0.6 })).toBe(true);
		expect(colorPreviewStore.gradeClipboard?.[0]?.params.lift).toBe(-0.2);
		commandHistory.clearHistory();

		expect(pasteColorGradeToItems(['title', 'audio', 'title'])).toEqual({
			effectCount: 1,
			itemCount: 1
		});
		const pasted = timelineStore.itemById.get('title')?.effects ?? [];
		expect(pasted).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					type: 'gpu',
					effectId: 'gpu-color-wheels',
					params: expect.objectContaining({ lift: -0.2, gain: 1.4 }),
					enabled: true
				}),
				expect.objectContaining({ id: 'title-brightness', type: 'brightness' })
			])
		);
		expect(pasted.some((effect) => effect.type === 'gpu' && effect.effectId === 'gpu-curves')).toBe(
			false
		);
		expect(timelineStore.itemById.get('audio')?.effects).toBeUndefined();
		expect(commandHistory.undoStack).toHaveLength(1);

		commandHistory.undo();
		expect(
			timelineStore.itemById
				.get('title')
				?.effects?.some((effect) => effect.type === 'gpu' && effect.effectId === 'gpu-curves')
		).toBe(true);
	});

	it('leaves the clipboard and history unchanged when no operation applies', () => {
		expect(copyColorGradeFromItem('audio')).toBeNull();
		expect(copyColorGradeFromItem('missing')).toBeNull();
		expect(pasteColorGradeToItems(['video'])).toBeNull();
		expect(colorPreviewStore.gradeClipboard).toBeNull();
		expect(commandHistory.undoStack).toHaveLength(0);
	});
});
