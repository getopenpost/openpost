import { beforeEach, describe, expect, it } from 'vitest';
import type { TimelineItem, TimelineTrack } from '$lib/video-editor/project/types';
import { timelineStore } from '../stores/timeline-store.svelte';
import { commandHistory } from '../commands/command-store.svelte';
import { setGpuEffectDataOnItems, setGpuEffectParam } from './effects';

function track(id: string, order: number, locked: boolean, parentTrackId?: string): TimelineTrack {
	return {
		id,
		name: id,
		kind: 'video',
		height: 64,
		locked,
		visible: true,
		muted: false,
		solo: false,
		order,
		parentTrackId
	};
}

function item(
	id: string,
	trackId: string,
	options: { sequenceColorGrade?: boolean; type?: TimelineItem['type'] } = {}
): TimelineItem {
	return {
		id,
		trackId,
		from: 0,
		durationInFrames: 30,
		label: id,
		type: options.type ?? 'image',
		sequenceColorGrade: options.sequenceColorGrade,
		effects: [
			{
				id: `${id}-effect`,
				type: 'gpu',
				effectId: 'gpu-color-wheels',
				enabled: true,
				params: { contrast: 1 }
			}
		]
	};
}

function contrast(itemId: string): number | undefined {
	const effect = timelineStore.itemById.get(itemId)?.effects?.[0];
	return effect?.type === 'gpu' ? Number(effect.params.contrast) : undefined;
}

describe('effect actions on locked Color targets', () => {
	beforeEach(() => {
		timelineStore.__resetForTesting();
		commandHistory.clearHistory();
		timelineStore._setTracks([
			track('locked', 0, true),
			{
				...track('group', 1, true),
				kind: undefined,
				isGroup: true
			},
			track('group-child', 2, false, 'group'),
			track('unlocked', 3, false),
			track('sequence', 4, true)
		]);
		timelineStore._setItems([
			item('locked', 'locked'),
			item('grouped', 'group-child'),
			item('unlocked', 'unlocked'),
			item('flagged-video', 'locked', { sequenceColorGrade: true, type: 'video' }),
			item('sequence', 'sequence', { sequenceColorGrade: true, type: 'adjustment' })
		]);
	});

	it('edits unlocked selection members and the dedicated sequence grade only', () => {
		expect(
			setGpuEffectDataOnItems(
				'locked',
				['locked', 'grouped', 'unlocked', 'flagged-video', 'sequence'],
				'locked-effect',
				{ contrast: 1.2 }
			)
		).toBe(true);

		expect(contrast('locked')).toBe(1);
		expect(contrast('grouped')).toBe(1);
		expect(contrast('flagged-video')).toBe(1);
		expect(contrast('unlocked')).toBe(1.2);
		expect(contrast('sequence')).toBe(1.2);
		expect(commandHistory.undoStack).toHaveLength(1);
	});

	it('rejects a direct parameter write to a locked clip', () => {
		expect(setGpuEffectParam('locked', 'locked-effect', 'contrast', 1.4)).toBe(false);
		expect(contrast('locked')).toBe(1);
		expect(commandHistory.undoStack).toHaveLength(0);
	});
});
