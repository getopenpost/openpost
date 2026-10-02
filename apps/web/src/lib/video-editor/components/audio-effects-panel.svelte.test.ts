import { afterEach, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import { createBlankProject } from '../project/defaults';
import type { Project } from '../project/types';
import { createDefaultAudioEffect } from '../audio/audio-effects';
import { sequenceStore } from '../sequences/sequence-store.svelte';
import { timelineStore } from '../timeline/stores/timeline-store.svelte';
import { commandHistory } from '../timeline/commands/command-store.svelte';
import { createProject, getProject } from '../workspace-fs/projects';
import { getWorkspaceRoot, setWorkspaceRoot } from '../workspace-fs/root';
import Fixture from './audio-effects.fixture.svelte';
import '../../../routes/layout.css';
function fixture() {
	const project = createBlankProject('Audio rack');
	project.timeline!.items = [
		{
			id: 'audio',
			type: 'audio',
			label: 'Audio',
			trackId: 'track-audio-main',
			from: 0,
			durationInFrames: 240,
			volume: -3,
			audioEffects: [
				{ ...createDefaultAudioEffect('pan', 'pan'), type: 'pan', pan: -0.05, enabled: false },
				createDefaultAudioEffect('compressor', 'compressor'),
				createDefaultAudioEffect('delay', 'delay')
			]
		}
	];
	sequenceStore.load(project.timeline!, project.metadata);
	commandHistory.clearHistory();
	return project;
}
function order() {
	return timelineStore.itemById.get('audio')!.audioEffects?.map((effect) => effect.id);
}
async function reopen(project: Project) {
	const previous = getWorkspaceRoot();
	const opfs = await navigator.storage.getDirectory();
	const name = `audio-rack-${crypto.randomUUID()}`;
	setWorkspaceRoot(await opfs.getDirectoryHandle(name, { create: true }));
	try {
		await createProject({ ...project, timeline: sequenceStore.projectTimeline() });
		sequenceStore.reset();
		const loaded = (await getProject(project.id))!;
		sequenceStore.load(loaded.timeline!, loaded.metadata);
	} finally {
		setWorkspaceRoot(previous);
		await opfs.removeEntry(name, { recursive: true });
	}
}
afterEach(() => {
	sequenceStore.reset();
	timelineStore.__resetForTesting();
	commandHistory.clearHistory();
});
it('keeps keyboard move focus on the same effect through interior and boundary moves, history and cold persistence', async () => {
	const project = fixture();
	const screen = await render(Fixture);
	await screen.getByText('Pan', { exact: true }).click();
	await screen.getByRole('button', { name: 'Move Pan down', exact: true }).element().focus();
	await userEvent.keyboard('{Enter}');
	expect(order()).toEqual(['compressor', 'pan', 'delay']);
	await expect
		.element(screen.getByRole('button', { name: 'Move Pan down', exact: true }))
		.toHaveFocus();
	await userEvent.keyboard('{Enter}');
	expect(order()).toEqual(['compressor', 'delay', 'pan']);
	await expect
		.element(screen.getByRole('button', { name: 'Move Pan up', exact: true }))
		.toHaveFocus();
	expect(commandHistory.undoStack).toHaveLength(2);
	commandHistory.undo();
	expect(order()).toEqual(['compressor', 'pan', 'delay']);
	commandHistory.redo();
	expect(order()).toEqual(['compressor', 'delay', 'pan']);
	await reopen(project);
	expect(order()).toEqual(['compressor', 'delay', 'pan']);
	expect(
		timelineStore.itemById.get('audio')!.audioEffects?.find((effect) => effect.type === 'pan')
	).toMatchObject({ pan: -0.05, enabled: false });
});
it('does not reclaim focus moved elsewhere during a reorder commit', async () => {
	fixture();
	const screen = await render(Fixture);
	await screen.getByText('Pan', { exact: true }).click();
	const elsewhere = screen.getByRole('button', { name: 'Elsewhere', exact: true }).element();
	await screen.getByRole('button', { name: 'Move Pan down', exact: true }).element().focus();
	window.addEventListener('click', () => elsewhere.focus(), { once: true });
	await userEvent.keyboard('{Enter}');
	expect(order()).toEqual(['compressor', 'pan', 'delay']);
	await expect
		.element(screen.getByRole('button', { name: 'Elsewhere', exact: true }))
		.toHaveFocus();
});
