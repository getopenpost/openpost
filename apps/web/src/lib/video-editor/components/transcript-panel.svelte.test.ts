import { afterEach, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { userEvent } from 'vitest/browser';
import { addGeneratedSubtitleItem } from '../transcript/transcribe-action';
import { addSubtitleItemFromSrt } from '../transcript/captions';
import { planTrimGesture } from '../timeline/edit-gesture';
import { timelineStore } from '../timeline/stores/timeline-store.svelte';
import { createBlankProject, createDefaultTracks } from '../project/defaults';
import { sequenceStore } from '../sequences/sequence-store.svelte';
import { getWorkspaceRoot, setWorkspaceRoot } from '@openpost/editor-shared/workspace';
import { createProject, getProject } from '../workspace-fs/projects';
import { commandHistory } from '../timeline/commands/command-store.svelte';
import TranscriptPanel from './transcript-panel.svelte';
import '../../../routes/layout.css';

function speech() {
	timelineStore.setAll({
		fps: 30,
		tracks: createDefaultTracks(),
		items: [
			{
				id: 'speech',
				type: 'video',
				trackId: 'track-video-main',
				mediaId: 'speech-media',
				label: 'Interview',
				from: 300,
				durationInFrames: 180,
				sourceFps: 30,
				sourceStart: 0,
				sourceEnd: 180
			}
		]
	});
	addGeneratedSubtitleItem('speech', [
		{ text: 'Hello', startSeconds: 0.2, endSeconds: 1.2 },
		{ text: 'world', startSeconds: 1.3, endSeconds: 2.2 },
		{ text: 'again', startSeconds: 4, endSeconds: 5 }
	]);
	commandHistory.clearHistory();
}
afterEach(() => {
	timelineStore.__resetForTesting();
	commandHistory.clearHistory();
	vi.restoreAllMocks();
});

it('reads and seeks words immediately, corrects text without cutting video, and adds a title at speech time', async () => {
	speech();
	const screen = await render(TranscriptPanel, { onedit: vi.fn() });
	await screen.getByRole('button', { name: 'world', exact: true }).click();
	expect(timelineStore.currentFrame).toBe(339);
	await screen.getByRole('button', { name: 'Correct transcript', exact: true }).click();
	const input = screen.getByRole('textbox', { name: 'Caption line' });
	await input.fill('Hello everyone again');
	await screen.getByRole('button', { name: 'Save correction' }).click();
	expect(timelineStore.itemById.get('speech')?.durationInFrames).toBe(180);
	await screen.getByRole('button', { name: 'everyone', exact: true }).click();
	await screen.getByRole('button', { name: 'Add text to timeline' }).click();
	expect(timelineStore.items.find((item) => item.type === 'text')).toMatchObject({
		text: 'everyone',
		from: 339
	});
});

it('preserves authored line breaks when editing one transcript word, including undo', async () => {
	speech();
	const project = createBlankProject('Caption word layout');
	sequenceStore.load(
		{
			...project.timeline!,
			tracks: timelineStore.tracks,
			items: timelineStore.items
		},
		project.metadata
	);
	const screen = await render(TranscriptPanel, { onedit: vi.fn() });
	await screen.getByRole('button', { name: 'Hello', exact: true }).click();
	await screen.getByRole('button', { name: 'Correct transcript', exact: true }).click();
	await screen.getByRole('textbox', { name: 'Caption line' }).fill('Olá! 👩🏽‍💻 café,\nمرحبا 東京!');
	await screen.getByRole('button', { name: 'Save correction' }).click();
	await screen.getByRole('button', { name: 'Olá!', exact: true }).click();
	await screen.getByRole('button', { name: 'Caption style', exact: true }).click();
	await screen.getByRole('button', { name: 'Bold', exact: true }).click();
	await screen.getByRole('button', { name: 'Timing', exact: true }).click();
	const word = screen.getByRole('textbox', { name: 'Transcript word', exact: true }).first();
	await word.fill('Olá? amigo');
	await userEvent.keyboard('{Tab}');
	const caption = () => timelineStore.items.find((item) => item.type === 'subtitle')!.cues![0]!;
	expect(caption().text).toBe('<b>Olá? amigo 👩🏽‍💻 café,\nمرحبا 東京!</b>');
	commandHistory.undo();
	expect(caption().text).toBe('<b>Olá! 👩🏽‍💻 café,\nمرحبا 東京!</b>');
	commandHistory.redo();
	await screen.getByRole('textbox', { name: 'Transcript word', exact: true }).nth(2).fill('café!');
	await userEvent.keyboard('{Tab}');
	expect(caption().text).toBe('<b>Olá? amigo 👩🏽‍💻 café!\nمرحبا 東京!</b>');
	commandHistory.undo();
	expect(caption().text).toBe('<b>Olá? amigo 👩🏽‍💻 café,\nمرحبا 東京!</b>');
	const start = screen.getByRole('spinbutton', { name: 'Word start frame', exact: true }).first();
	await start.fill(String(caption().words![0]!.startFrame + 1));
	await userEvent.keyboard('{Tab}');
	expect(caption().text).toBe('<b>Olá? amigo 👩🏽‍💻 café,\nمرحبا 東京!</b>');
	await screen.getByRole('button', { name: 'Correct transcript', exact: true }).click();
	await expect
		.element(screen.getByRole('textbox', { name: 'Caption line' }))
		.toHaveValue('Olá? amigo 👩🏽‍💻 café,\nمرحبا 東京!');
	const prior = getWorkspaceRoot();
	const root = await navigator.storage.getDirectory();
	const dir = `caption-layout-${crypto.randomUUID()}`;
	setWorkspaceRoot(await root.getDirectoryHandle(dir, { create: true }));
	try {
		await createProject({
			...project,
			timeline: sequenceStore.projectTimeline()
		});
		await screen.unmount();
		sequenceStore.reset();
		timelineStore.__resetForTesting();
		const loaded = (await getProject(project.id))!;
		sequenceStore.load(loaded.timeline!, loaded.metadata);
		const reopened = await render(TranscriptPanel, { onedit: vi.fn() });
		await reopened.getByRole('button', { name: 'Olá? amigo', exact: true }).click();
		await reopened.getByRole('button', { name: 'Correct transcript', exact: true }).click();
		await expect
			.element(reopened.getByRole('textbox', { name: 'Caption line' }))
			.toHaveValue('Olá? amigo 👩🏽‍💻 café,\nمرحبا 東京!');
	} finally {
		setWorkspaceRoot(prior);
		await root.removeEntry(dir, { recursive: true });
		sequenceStore.reset();
	}
});

it('deletes a selected spoken range immediately and restores it with undo', async () => {
	speech();
	const screen = await render(TranscriptPanel, { onedit: vi.fn() });
	await screen.getByRole('button', { name: 'Hello', exact: true }).click();
	await userEvent.keyboard('{Shift>}');
	await screen.getByRole('button', { name: 'world', exact: true }).click();
	await userEvent.keyboard('{/Shift}');
	await userEvent.keyboard('{Delete}');
	expect(
		timelineStore.items
			.filter((item) => item.type === 'video')
			.reduce((sum, item) => sum + item.durationInFrames, 0)
	).toBe(120);
	await expect.element(screen.getByRole('status')).toHaveTextContent('Words cut: 2');
	commandHistory.undo();
	expect(timelineStore.itemById.get('speech')?.durationInFrames).toBe(180);
	await expect.element(screen.getByRole('button', { name: 'world', exact: true })).toBeVisible();
});

it('cuts the displayed source instance and leaves a later duplicate intact', async () => {
	speech();
	const original = timelineStore.itemById.get('speech')!;
	timelineStore._setItems([...timelineStore.items, { ...original, id: 'duplicate', from: 600 }]);
	const screen = await render(TranscriptPanel, { onedit: vi.fn() });
	await screen.getByRole('button', { name: 'Hello', exact: true }).click();
	await screen.getByRole('button', { name: 'Delete from video', exact: true }).click();
	expect(timelineStore.itemById.get('duplicate')?.durationInFrames).toBe(180);
	expect(
		timelineStore.items
			.filter((item) => item.type === 'video' && item.id !== 'duplicate')
			.reduce((sum, item) => sum + item.durationInFrames, 0)
	).toBe(150);
});

it('uses sequence frames for imported captions after a timeline start trim', async () => {
	timelineStore.setAll({ fps: 30, tracks: createDefaultTracks(), items: [] });
	const id = addSubtitleItemFromSrt('1\n00:00:10,200 --> 00:00:15,000\nImported line');
	const item = timelineStore.itemById.get(id)!;
	const trim = planTrimGesture(item, 'start', 300 - item.from, timelineStore.items, 30, [], 0);
	timelineStore._updateItems([{ id, patch: trim.patch }]);
	expect(timelineStore.itemById.get(id)?.from).toBe(300);
	commandHistory.clearHistory();
	const screen = await render(TranscriptPanel, { onedit: vi.fn() });
	await screen.getByRole('button', { name: 'Imported line', exact: true }).click();
	await screen.getByRole('button', { name: 'Caption style', exact: true }).click();
	const start = screen.getByRole('spinbutton', {
		name: 'Adjust caption start',
		exact: true
	});
	await expect.element(start).toHaveValue(306);
	await start.fill('200');
	await userEvent.keyboard('{Tab}');
	await expect.element(start).toHaveValue(306);
	expect(commandHistory.undoStack).toHaveLength(0);
	await expect
		.element(start)
		.toHaveAccessibleDescription(
			'Keep caption timing between 300 and 450 frames, with the end after the start.'
		);
	await start.fill('330');
	await userEvent.keyboard('{Tab}');
	expect(timelineStore.itemById.get(id)!.cues![0]!.startFrame).toBe(330);
	await screen.getByRole('button', { name: 'Imported line', exact: true }).click();
	expect(timelineStore.currentFrame).toBe(330);
	commandHistory.undo();
	expect(timelineStore.itemById.get(id)!.cues![0]!.startFrame).toBe(306);
	commandHistory.redo();
	expect(timelineStore.itemById.get(id)!.cues![0]!.startFrame).toBe(330);
	expect([
		timelineStore.itemById.get(id)!.from,
		timelineStore.itemById.get(id)!.durationInFrames
	]).toEqual([300, 150]);
});

it('shows copied words only after the awaited clipboard write resolves', async () => {
	speech();
	let finish!: () => void;
	const write = vi.spyOn(navigator.clipboard, 'writeText').mockImplementation(
		() =>
			new Promise<void>((resolve) => {
				finish = resolve;
			})
	);
	const screen = await render(TranscriptPanel, { onedit: vi.fn() });
	await screen.getByRole('button', { name: 'Hello', exact: true }).click();
	await userEvent.keyboard('{Control>}c{/Control}');
	await expect.poll(() => write.mock.calls.length).toBe(1);
	await expect.element(screen.getByRole('status')).not.toHaveTextContent('Words copied');
	finish();
	await expect.element(screen.getByRole('status')).toHaveTextContent('Words copied: 1');
});
