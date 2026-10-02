import { afterEach, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import '../../../routes/layout.css';
import { m } from '$lib/paraglide/messages';
import { createBlankProject } from '../project/defaults';
import { sequenceStore } from '../sequences/sequence-store.svelte';
import { timelineStore } from '../timeline/stores/timeline-store.svelte';
import { commandHistory } from '../timeline/commands/command-store.svelte';
import { createProject, getProject } from '../workspace-fs/projects';
import { getWorkspaceRoot, setWorkspaceRoot } from '../workspace-fs/root';
import AudioDuckingPanel from './audio-ducking-panel.svelte';

afterEach(() => {
	sequenceStore.reset();
	timelineStore.__resetForTesting();
	commandHistory.clearHistory();
});

it('turns ducking off at zero, preserves its undo settings and keeps it off after reopening', async () => {
	const project = createBlankProject('Zero ducking');
	project.timeline!.items = [
		{
			id: 'voice',
			label: 'Voice',
			type: 'audio',
			trackId: 'track-audio-main',
			from: 0,
			durationInFrames: 240,
			audioDucking: {
				duckOthersDb: -12,
				attackSec: 0.2,
				releaseSec: 0.4,
				targetTrackIds: ['music']
			}
		}
	];
	sequenceStore.load(project.timeline!, project.metadata);
	commandHistory.clearHistory();
	const screen = await render(AudioDuckingPanel, { item: timelineStore.itemById.get('voice')! });
	const toggle = screen.getByRole('button', { name: m.video_editor_duck_enable() });
	await expect.element(toggle).toHaveAttribute('aria-pressed', 'true');
	await screen.getByRole('spinbutton', { name: m.video_editor_duck_amount() }).fill('0');
	await userEvent.keyboard('{Tab}');
	await screen.rerender({ item: timelineStore.itemById.get('voice')! });
	await expect
		.element(screen.container.querySelector('summary')!)
		.toHaveTextContent(m.video_editor_duck_off());
	await screen.getByText(m.video_editor_duck_title(), { exact: true }).click();
	await expect.element(toggle).toHaveAttribute('aria-pressed', 'false');
	expect(timelineStore.itemById.get('voice')?.audioDucking).toBeUndefined();
	commandHistory.undo();
	await screen.rerender({ item: timelineStore.itemById.get('voice')! });
	await expect.element(toggle).toHaveAttribute('aria-pressed', 'true');
	await expect
		.element(screen.getByRole('spinbutton', { name: m.video_editor_duck_amount() }))
		.toHaveValue(-12);
	expect(timelineStore.itemById.get('voice')?.audioDucking).toEqual({
		duckOthersDb: -12,
		attackSec: 0.2,
		releaseSec: 0.4,
		targetTrackIds: ['music']
	});
	commandHistory.redo();
	const priorRoot = getWorkspaceRoot();
	const opfs = await navigator.storage.getDirectory();
	const directory = `ducking-${crypto.randomUUID()}`;
	setWorkspaceRoot(await opfs.getDirectoryHandle(directory, { create: true }));
	try {
		await createProject({ ...project, timeline: sequenceStore.projectTimeline() });
		sequenceStore.reset();
		const loaded = (await getProject(project.id))!;
		sequenceStore.load(loaded.timeline!, loaded.metadata);
		await screen.rerender({ item: timelineStore.itemById.get('voice')! });
		await expect
			.element(screen.container.querySelector('summary')!)
			.toHaveTextContent(m.video_editor_duck_off());
		await screen.getByText(m.video_editor_duck_title(), { exact: true }).click();
		await expect.element(toggle).toHaveAttribute('aria-pressed', 'false');
		expect(timelineStore.itemById.get('voice')?.audioDucking).toBeUndefined();
	} finally {
		setWorkspaceRoot(priorRoot);
		await opfs.removeEntry(directory, { recursive: true });
	}
});
