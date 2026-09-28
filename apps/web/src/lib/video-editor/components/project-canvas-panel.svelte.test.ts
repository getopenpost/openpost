import { afterEach, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { createBlankProject } from '../project/defaults';
import { editorSession } from '../editor.svelte';
import { sequenceStore } from '../sequences/sequence-store.svelte';
import { timelineStore } from '../timeline/stores/timeline-store.svelte';
import { commandHistory } from '../timeline/commands/command-store.svelte';
import ProjectCanvasPanel from './project-canvas-panel.svelte';

afterEach(() => {
	editorSession.project = null;
	sequenceStore.reset();
	timelineStore.__resetForTesting();
	commandHistory.clearHistory();
});

it('applies a canvas format in one undo step without changing frame rate or existing layers', async () => {
	const project = createBlankProject('Format test', { width: 1920, height: 1080, fps: 24 });
	if (!project.timeline) throw new Error('Expected a blank timeline');
	project.timeline.items = [
		{
			id: 'title',
			type: 'text',
			label: 'Title',
			text: 'Launch',
			trackId: 'track-video-main',
			from: 30,
			durationInFrames: 120,
			transform: { x: 80, y: 20, width: 600, height: 200 }
		}
	];
	const originalItems = structuredClone(project.timeline.items);
	editorSession.project = project;
	sequenceStore.load(project.timeline, project.metadata);
	commandHistory.clearHistory();
	const onedit = vi.fn();
	const screen = await render(ProjectCanvasPanel, { onedit });
	await screen.getByRole('button', { name: 'Dimensions' }).click();
	await screen
		.getByRole('option', { name: 'Shorts, TikTok and Reels · 1080 × 1920', exact: true })
		.click();
	expect(sequenceStore.rootResolution).toMatchObject({ width: 1080, height: 1920, fps: 24 });
	expect(timelineStore.items).toEqual(originalItems);
	expect(onedit).toHaveBeenCalledOnce();
	commandHistory.undo();
	expect(sequenceStore.rootResolution).toMatchObject({ width: 1920, height: 1080, fps: 24 });
	expect(commandHistory.canUndo).toBe(false);
	await expect
		.element(screen.getByRole('spinbutton', { name: 'Width', exact: true }))
		.toHaveValue(1920);
});
