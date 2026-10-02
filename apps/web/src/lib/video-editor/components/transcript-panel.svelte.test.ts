import { afterEach, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page, userEvent } from 'vitest/browser';
import { addGeneratedSubtitleItem } from '../transcript/transcribe-action';
import { timelineStore } from '../timeline/stores/timeline-store.svelte';
import { createBlankProject, createDefaultTracks } from '../project/defaults';
import { sequenceStore } from '../sequences/sequence-store.svelte';
import { getWorkspaceRoot, setWorkspaceRoot } from '../workspace-fs/root';
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
		{ ...project.timeline!, tracks: timelineStore.tracks, items: timelineStore.items },
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
		await createProject({ ...project, timeline: sequenceStore.projectTimeline() });
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
	await screen.getByRole('button', { name: 'Delete from video', exact: true }).click();
	expect(
		timelineStore.items
			.filter((item) => item.type === 'video')
			.reduce((sum, item) => sum + item.durationInFrames, 0)
	).toBe(120);
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

it('clears selection when a different transcript replaces the document', async () => {
	speech();
	const screen = await render(TranscriptPanel, { onedit: vi.fn() });
	await screen.getByRole('button', { name: 'Hello', exact: true }).click();
	timelineStore._setItems(timelineStore.items.map((item) => ({ ...item, id: `other-${item.id}` })));
	await expect
		.element(screen.getByRole('button', { name: 'Delete from video', exact: true }))
		.not.toBeInTheDocument();
});

it('starts backwards search at the last match and retains detailed caption controls', async () => {
	speech();
	const subtitle = timelineStore.items.find((item) => item.type === 'subtitle')!;
	timelineStore._updateItems([
		{
			id: subtitle.id,
			patch: {
				cues: subtitle.cues!.map((cue) => ({
					...cue,
					text: 'Hello world Hello',
					words: cue.words?.map((word) =>
						word.text === 'again' ? { ...word, text: 'Hello' } : word
					)
				}))
			}
		}
	]);
	const screen = await render(TranscriptPanel, { onedit: vi.fn() });
	const search = screen.getByRole('searchbox');
	await search.fill('Hello');
	await userEvent.keyboard('{Shift>}{Enter}{/Shift}');
	expect(timelineStore.currentFrame).toBe(420);
	await screen.getByRole('button', { name: 'world', exact: true }).click();
	await screen.getByRole('button', { name: 'Caption style', exact: true }).click();
	await screen.getByRole('button', { name: 'Bold', exact: true }).click();
	expect(timelineStore.itemById.get(subtitle.id)?.cues?.[0]?.text).toBe('<b>Hello world Hello</b>');
	await screen.getByRole('spinbutton', { name: 'Adjust caption end', exact: true }).fill('160');
	await userEvent.keyboard('{Tab}');
	expect(timelineStore.itemById.get(subtitle.id)?.cues?.[0]?.endFrame).toBe(160);
	expect(timelineStore.itemById.get('speech')?.durationInFrames).toBe(180);
});

it('extends selection while dragging below the sticky actions and scrolling', async () => {
	speech();
	addGeneratedSubtitleItem(
		'speech',
		Array.from({ length: 120 }, (_, index) => ({
			text: `word${index}`,
			startSeconds: index / 25,
			endSeconds: (index + 1) / 25
		}))
	);
	await page.viewport(900, 700);
	const host = document.createElement('div');
	host.style.cssText =
		'height:350px;width:300px;display:flex;flex-direction:column;position:relative';
	document.body.append(host);
	try {
		const screen = await render(TranscriptPanel, { target: host, props: { onedit: vi.fn() } });
		const first = screen.getByRole('button', { name: 'word0', exact: true }).element();
		first.scrollIntoView({ block: 'center' });
		const rect = first.getBoundingClientRect();
		first.dispatchEvent(
			new PointerEvent('pointerdown', {
				pointerId: 11,
				button: 0,
				bubbles: true,
				clientX: rect.left + 10,
				clientY: rect.top + 10
			})
		);
		const bottom = host.getBoundingClientRect().bottom;
		window.dispatchEvent(
			new PointerEvent('pointermove', {
				pointerId: 11,
				bubbles: true,
				clientX: rect.left + 10,
				clientY: bottom + 30
			})
		);
		await expect
			.poll(() => host.querySelectorAll('[data-selected="true"]').length)
			.toBeGreaterThan(20);
		window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 11, bubbles: true }));
	} finally {
		host.remove();
	}
});

it('keeps words clickable in a short transcript pane', async () => {
	speech();
	const host = document.createElement('div');
	host.style.cssText = 'height:64px;width:500px;display:flex;flex-direction:column';
	document.body.append(host);
	try {
		const screen = await render(TranscriptPanel, { target: host, props: { onedit: vi.fn() } });
		const word = screen.getByRole('button', { name: 'world', exact: true }).element();
		word.scrollIntoView({ block: 'center' });
		await expect
			.poll(() => {
				const bounds = word.getBoundingClientRect();
				return word.contains(
					document.elementFromPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2)
				);
			})
			.toBe(true);
		await screen.getByRole('button', { name: 'world', exact: true }).click();
		expect(timelineStore.currentFrame).toBe(339);
		await screen.getByRole('button', { name: 'Correct transcript', exact: true }).click();
		await expect.element(screen.getByRole('textbox', { name: 'Caption line' })).toBeVisible();
	} finally {
		host.remove();
	}
});
