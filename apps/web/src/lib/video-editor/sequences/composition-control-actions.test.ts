import { beforeEach, describe, expect, it } from 'vitest';
import { createEmptyTimeline } from '../project/defaults';
import type { SubComposition, TimelineItem } from '../project/types';
import { commandHistory } from '../timeline/commands/command-store.svelte';
import { timelineStore } from '../timeline/stores/timeline-store.svelte';
import {
	addCompositionControl,
	removeCompositionControl,
	renameCompositionControl
} from './composition-control-actions';
import { sequenceStore } from './sequence-store.svelte';

const title: TimelineItem = {
	id: 'title',
	trackId: 'visual',
	from: 0,
	durationInFrames: 30,
	label: 'Title',
	type: 'text',
	text: 'Hello',
	color: '#ffffff'
};

const composition: SubComposition = {
	id: 'card',
	name: 'Card',
	editorKind: 'composite-2d',
	items: [title],
	tracks: [
		{
			id: 'visual',
			name: 'Visual',
			kind: 'video',
			height: 64,
			locked: false,
			visible: true,
			muted: false,
			solo: false,
			order: 0
		}
	],
	transitions: [],
	fps: 30,
	width: 1920,
	height: 1080,
	durationInFrames: 30
};

beforeEach(() => {
	commandHistory.clearHistory();
	sequenceStore.reset();
	timelineStore.__resetForTesting();
	sequenceStore.load(
		{ ...createEmptyTimeline(), compositions: [composition] },
		{ width: 1920, height: 1080, fps: 30 }
	);
	sequenceStore.switchTo(composition.id);
});

describe('composition control actions', () => {
	it('authors, renames, removes, and undoes controls atomically', () => {
		const id = addCompositionControl(composition.id, {
			name: 'Headline',
			targetItemId: title.id,
			property: 'text.text',
			kind: 'text',
			defaultValue: 'Hello'
		});
		expect(id).toBeTruthy();
		expect(
			sequenceStore.compositionById.get(composition.id)?.compositionControls?.controls[0]
		).toMatchObject({ id, name: 'Headline' });
		expect(
			addCompositionControl(composition.id, {
				name: 'Duplicate',
				targetItemId: title.id,
				property: 'text.text',
				kind: 'text',
				defaultValue: 'Hello'
			})
		).toBeNull();
		expect(renameCompositionControl(composition.id, id!, 'Title copy')).toBe(true);
		expect(removeCompositionControl(composition.id, id!)).toBe(true);
		expect(sequenceStore.compositionById.get(composition.id)?.compositionControls).toBeUndefined();

		commandHistory.undo();
		expect(
			sequenceStore.compositionById.get(composition.id)?.compositionControls?.controls[0]?.name
		).toBe('Title copy');
	});
});
