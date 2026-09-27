import { beforeEach, expect, it } from 'vitest';
import { captureLibrarySelection, insertLibrarySelection } from './selection';
import { editorSession } from '../editor.svelte';
import { sequenceStore } from '../sequences/sequence-store.svelte';
import { timelineStore } from '../timeline/stores/timeline-store.svelte';
import { commandHistory } from '../timeline/commands/command-store.svelte';
import { createEmptyTimeline } from '../project/defaults';
import type { Project } from '../project/types';
const project: Project = {
	id: 'test',
	name: 'Source',
	description: '',
	createdAt: 0,
	updatedAt: 0,
	duration: 10,
	metadata: { width: 1920, height: 1080, fps: 25 },
	timeline: createEmptyTimeline()
};
beforeEach(() => {
	commandHistory.clearHistory();
	timelineStore.__resetForTesting();
	sequenceStore.reset();
	editorSession.project = structuredClone(project);
	sequenceStore.load(project.timeline!, project.metadata);
});
it('captures an independent reusable block, exposes text, and preserves its seconds in a new project', async () => {
	const trackId = timelineStore.tracks[0]!.id;
	timelineStore._setItems([
		{
			id: 'title',
			type: 'text',
			label: 'Title',
			text: 'Original',
			trackId,
			from: 50,
			durationInFrames: 250
		},
		{
			id: 'timer',
			type: 'text',
			label: 'Timer',
			trackId,
			from: 50,
			durationInFrames: 250,
			timer: { style: 'ring', direction: 'down', format: 'clock' }
		}
	]);
	const recipe = await captureLibrarySelection(['title', 'timer']);
	timelineStore._setItems([]);
	sequenceStore.reset();
	sequenceStore.load(createEmptyTimeline(), {
		width: 1920,
		height: 1080,
		fps: 30
	});
	const ids = await insertLibrarySelection(recipe, 'My block');
	expect(timelineStore.itemById.get(ids[0]!)?.durationInFrames).toBe(300);
	const block = sequenceStore.compositions[0]!;
	expect(block.items.map((item) => item.from)).toEqual([0, 0]);
	expect(
		block.compositionControls?.controls
			.filter((control) => control.property === 'text.text')
			.map((control) => control.defaultValue)
	).toEqual(['Original']);
	expect(block.items[0]!.id).not.toBe('title');
	recipe.project.timeline!.items[0]!.text = 'Updated library copy';
	expect(block.items[0]!.text).toBe('Original');
	commandHistory.undo();
	expect(timelineStore.items).toEqual([]);
	expect(sequenceStore.compositions).toEqual([]);
});
it('applies a saved text style without replacing the target wording or timing', async () => {
	const { applyLibraryTextStyle } = await import('./selection');
	const trackId = timelineStore.tracks[0]!.id;
	timelineStore._setItems([
		{
			id: 'source',
			type: 'text',
			label: 'Styled',
			text: 'Original words',
			trackId,
			from: 0,
			durationInFrames: 50,
			color: '#ff2200',
			fontSize: 96
		}
	]);
	const recipe = await captureLibrarySelection(['source']);
	timelineStore._setItems([
		{
			id: 'target',
			type: 'text',
			label: 'Episode',
			text: 'New words',
			trackId,
			from: 75,
			durationInFrames: 100,
			color: '#ffffff',
			fontSize: 40
		}
	]);
	await applyLibraryTextStyle(recipe, 'My style', ['target']);
	expect(timelineStore.itemById.get('target')).toMatchObject({
		text: 'New words',
		from: 75,
		durationInFrames: 100,
		color: '#ff2200',
		fontSize: 96
	});
	commandHistory.undo();
	expect(timelineStore.itemById.get('target')?.fontSize).toBe(40);
});
