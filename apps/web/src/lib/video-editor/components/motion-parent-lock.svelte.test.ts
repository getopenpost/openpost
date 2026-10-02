import { afterEach, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import { createBlankProject, createDefaultTracks } from '../project/defaults';
import type { Project } from '../project/types';
import { createProject, getProject } from '../workspace-fs/projects';
import { getWorkspaceRoot, setWorkspaceRoot } from '../workspace-fs/root';
import { sequenceStore } from '../sequences/sequence-store.svelte';
import { timelineStore } from '../timeline/stores/timeline-store.svelte';
import { commandHistory } from '../timeline/commands/command-store.svelte';
import { setTransformParent, detachTransformParent } from '../timeline/actions/transform-parenting';
import CompositionTimeline from './composition-timeline.svelte';
import '../../../routes/layout.css';
import MotionWorkspacePanel from './motion-workspace-panel.svelte';
import ClipTransformSection from './clip-transform-section.svelte';

function fixture() {
	const project = createBlankProject('Motion lock scope');
	project.timeline!.compositions = [
		{
			id: 'motion',
			name: 'Motion',
			editorKind: 'composite-2d',
			items: [
				{
					id: 'child',
					type: 'text',
					text: 'Child',
					label: 'Child',
					trackId: 'track-video-main',
					from: 0,
					durationInFrames: 60,
					transform: { x: 0, width: 120, height: 60 }
				},
				{
					id: 'controller',
					type: 'controller',
					label: 'Controller',
					trackId: 'track-video-overlay',
					from: 0,
					durationInFrames: 60,
					transform: { x: 0, width: 1920, height: 1080 }
				}
			],
			tracks: createDefaultTracks(),
			transitions: [],
			fps: 30,
			width: 1920,
			height: 1080,
			durationInFrames: 60
		}
	];
	sequenceStore.load(project.timeline!, project.metadata);
	sequenceStore.switchTo('motion');
	commandHistory.clearHistory();
	return project;
}
function lock(trackId: string, scope: string) {
	const tracks = timelineStore.tracks.map((track) =>
		track.id === trackId
			? {
					...track,
					locked: scope === 'track',
					...(scope === 'group' && { parentTrackId: 'group' })
				}
			: track
	);
	if (scope === 'group')
		tracks.push({ ...tracks[0]!, id: 'group', isGroup: true, kind: undefined, locked: true });
	timelineStore._setTracks(tracks);
}
async function reopenSaved(project: Project) {
	const previous = getWorkspaceRoot();
	const opfs = await navigator.storage.getDirectory();
	const name = `motion-lock-${crypto.randomUUID()}`;
	setWorkspaceRoot(await opfs.getDirectoryHandle(name, { create: true }));
	try {
		await createProject({ ...project, timeline: sequenceStore.projectTimeline() });
		sequenceStore.reset();
		const reopened = (await getProject(project.id))!;
		sequenceStore.load(reopened.timeline!, reopened.metadata);
		sequenceStore.switchTo('motion');
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

it.each(['track', 'group'])('protects parent assignment under a %s lock', async (scope) => {
	fixture();
	lock('track-video-main', scope);
	expect(setTransformParent('child', 'controller').ok).toBe(false);
	expect(timelineStore.itemById.get('child')!.transformParent).toBeUndefined();
	expect(commandHistory.canUndo).toBe(false);
	const screen = await render(CompositionTimeline, { onedit: vi.fn() });
	await expect.element(screen.getByTestId('parent-pick-child')).toBeDisabled();
	await screen.unmount();
});

it.each(['track', 'group'])('protects parent removal under a %s lock', async (scope) => {
	const project = fixture();
	expect(setTransformParent('child', 'controller').ok).toBe(true);
	commandHistory.clearHistory();
	lock('track-video-main', scope);
	expect(detachTransformParent('child')).toBe(false);
	expect(timelineStore.itemById.get('child')!.transformParent?.parentItemId).toBe('controller');
	const onedit = vi.fn();
	const screen = await render(CompositionTimeline, { onedit });
	await expect.element(screen.getByTestId('parent-detach-child')).toBeDisabled();
	expect(commandHistory.canUndo).toBe(false);
	expect(onedit).not.toHaveBeenCalled();
	await reopenSaved(project);
	expect(timelineStore.itemById.get('child')!.transformParent?.parentItemId).toBe('controller');
});

it('allows an unlocked child to detach from a locked controller with keyboard history and cold persistence', async () => {
	const project = fixture();
	expect(setTransformParent('child', 'controller').ok).toBe(true);
	lock('track-video-overlay', 'track');
	commandHistory.clearHistory();
	const onedit = vi.fn();
	const screen = await render(CompositionTimeline, { onedit });
	await screen.getByTestId('parent-detach-child').element().focus();
	await userEvent.keyboard('{Enter}');
	expect(timelineStore.itemById.get('child')!.transformParent?.parentItemId).toBeUndefined();
	expect(onedit).toHaveBeenCalledOnce();
	commandHistory.undo();
	expect(timelineStore.itemById.get('child')!.transformParent?.parentItemId).toBe('controller');
	commandHistory.redo();
	await reopenSaved(project);
	expect(timelineStore.itemById.get('child')!.transformParent?.parentItemId).toBeUndefined();
	expect(timelineStore.tracks.find((track) => track.id === 'track-video-overlay')!.locked).toBe(
		true
	);
});

it.each(['track', 'group'])(
	'disables controller transform authoring under a %s lock and permits unlocked keyboard edits',
	async (scope) => {
		const project = fixture();
		lock('track-video-overlay', scope);
		const onedit = vi.fn();
		const screen = await render(ClipTransformSection, { itemId: 'controller', onedit });
		for (const name of ['Horizontal position', 'Vertical position', 'Width', 'Height']) {
			await expect.element(screen.getByRole('textbox', { name, exact: true })).toBeDisabled();
		}
		await expect
			.element(screen.getByRole('button', { name: 'Reset position', exact: true }))
			.toBeDisabled();
		await screen.getByRole('button', { name: 'Anchor', exact: true }).click();
		await expect
			.element(screen.getByRole('textbox', { name: 'Anchor X', exact: true }))
			.toBeDisabled();
		expect(commandHistory.canUndo).toBe(false);
		timelineStore._setTracks(createDefaultTracks());
		await expect
			.element(screen.getByRole('textbox', { name: 'Horizontal position', exact: true }))
			.toBeEnabled();
		await screen.getByRole('textbox', { name: 'Horizontal position', exact: true }).fill('80');
		await userEvent.keyboard('{Enter}');
		expect(timelineStore.itemById.get('controller')!.transform?.x).toBe(80);
		commandHistory.undo();
		expect(timelineStore.itemById.get('controller')!.transform?.x).toBe(0);
		commandHistory.redo();
		await reopenSaved(project);
		expect(timelineStore.itemById.get('controller')!.transform?.x).toBe(80);
	}
);

it('disables the inspector parent chooser for a locked child and preserves unlocked assignment history', async () => {
	const project = fixture();
	lock('track-video-main', 'track');
	const onedit = vi.fn();
	const screen = await render(MotionWorkspacePanel, {
		itemId: 'child',
		frameWidth: 1920,
		frameHeight: 1080,
		fps: 30,
		onedit
	});
	await expect
		.element(screen.getByRole('button', { name: 'Parent layer', exact: true }))
		.toBeDisabled();
	await expect
		.element(screen.getByRole('button', { name: 'Transform parent', exact: true }))
		.toBeEnabled();
	expect(onedit).not.toHaveBeenCalled();
	timelineStore._setTracks(createDefaultTracks());
	await expect
		.element(screen.getByRole('button', { name: 'Parent layer', exact: true }))
		.toBeEnabled();
	await screen.getByRole('button', { name: 'Parent layer', exact: true }).element().focus();
	await userEvent.keyboard('{Enter}');
	await page.getByRole('option', { name: 'Controller', exact: true }).click();
	expect(timelineStore.itemById.get('child')!.transformParent?.parentItemId).toBe('controller');
	expect(onedit).toHaveBeenCalledOnce();
	commandHistory.undo();
	expect(timelineStore.itemById.get('child')!.transformParent?.parentItemId).toBeUndefined();
	commandHistory.redo();
	await reopenSaved(project);
	expect(timelineStore.itemById.get('child')!.transformParent?.parentItemId).toBe('controller');
});
