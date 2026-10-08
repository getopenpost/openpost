import { afterEach, expect, it } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { WebThemeRuntime } from '$lib/themes/runtime';
import { resolveBuiltInTheme } from '@openpost/ui/themes/builtins';
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
			volume: 1,
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
it('makes the collapsed effect handle reorder with a real pointer drop and one history entry', async () => {
	const project = fixture();
	const screen = await render(Fixture);
	await screen
		.getByRole('button', { name: 'Reorder Pan', exact: true })
		.dropTo(screen.getByRole('button', { name: 'Reorder Delay', exact: true }));
	expect(order()).toEqual(['compressor', 'delay', 'pan']);
	expect(commandHistory.undoStack).toHaveLength(1);
	commandHistory.undo();
	expect(order()).toEqual(['pan', 'compressor', 'delay']);
	commandHistory.redo();
	await reopen(project);
	expect(order()).toEqual(['compressor', 'delay', 'pan']);
});
it('previews handle ordering locally, cancels with Escape and commits on keyboard drop', async () => {
	fixture();
	const screen = await render(Fixture);
	await screen.getByRole('button', { name: 'Reorder Pan', exact: true }).click();
	await userEvent.keyboard(' {ArrowDown}');
	await expect
		.element(screen.getByRole('list', { name: 'Audio effect rack', exact: true }))
		.toHaveTextContent(/Compressor.*Pan.*Delay/s);
	expect(order()).toEqual(['pan', 'compressor', 'delay']);
	expect(commandHistory.canUndo).toBe(false);
	await userEvent.keyboard('{Escape}');
	await expect
		.element(screen.getByRole('list', { name: 'Audio effect rack', exact: true }))
		.toHaveTextContent(/Pan.*Compressor.*Delay/s);
	await userEvent.keyboard(' {ArrowDown} ');
	expect(order()).toEqual(['compressor', 'pan', 'delay']);
	expect(commandHistory.undoStack).toHaveLength(1);
	await expect
		.element(screen.getByRole('button', { name: 'Reorder Pan', exact: true }))
		.toHaveFocus();
});
it('does not steal later focus when a handle drop commits', async () => {
	fixture();
	const screen = await render(Fixture, { focusAfterOrder: true });
	const handle = screen.getByRole('button', { name: 'Reorder Pan', exact: true });
	await handle.click();
	await userEvent.keyboard(' {ArrowDown} ');
	expect(order()).toEqual(['compressor', 'pan', 'delay']);
	await expect
		.element(screen.getByRole('button', { name: 'Elsewhere', exact: true }))
		.toHaveFocus();
});
it('distinguishes default reset from clearing the rack and persists clear history', async () => {
	const project = fixture();
	const screen = await render(Fixture);
	const original = JSON.parse(JSON.stringify(timelineStore.itemById.get('audio')!.audioEffects));
	await screen.getByRole('button', { name: 'Reset Pan', exact: true }).click();
	expect(timelineStore.itemById.get('audio')!.audioEffects?.[0]).toMatchObject({
		id: 'pan',
		pan: 0,
		enabled: false
	});
	expect(order()).toEqual(['pan', 'compressor', 'delay']);
	commandHistory.undo();
	await screen.getByRole('button', { name: 'Clear effects', exact: true }).click();
	expect(order()).toBeUndefined();
	expect(timelineStore.itemById.get('audio')!.volume).toBe(1);
	expect(commandHistory.undoStack).toHaveLength(1);
	commandHistory.undo();
	expect(timelineStore.itemById.get('audio')!.audioEffects).toEqual(original);
	commandHistory.redo();
	await reopen(project);
	expect(order()).toBeUndefined();
});
it('adds the same effect after removal and undo without a placeholder round trip, then cold reopens its independent instance', async () => {
	const project = fixture();
	const screen = await render(Fixture);
	const add = screen.getByLabelText('Add audio effect', { exact: true });
	async function addDistortion() {
		add.element().focus();
		await userEvent.keyboard('{Enter}');
		await userEvent.keyboard('{End}{Enter}');
	}
	await addDistortion();
	const first = timelineStore.itemById
		.get('audio')!
		.audioEffects!.find((effect) => effect.type === 'distortion')!;
	expect(first).toMatchObject({ type: 'distortion', amount: 0.45 });
	await screen.getByRole('button', { name: 'Remove Distortion', exact: true }).click();
	expect(order()).toEqual(['pan', 'compressor', 'delay']);
	await addDistortion();
	const second = timelineStore.itemById
		.get('audio')!
		.audioEffects?.find((effect) => effect.type === 'distortion');
	expect(second).toMatchObject({ type: 'distortion', amount: 0.45 });
	expect(second!.id).not.toBe(first.id);
	await expect.element(add).toHaveTextContent('Add effect…');
	commandHistory.undo();
	expect(order()).toEqual(['pan', 'compressor', 'delay']);
	commandHistory.undo();
	expect(timelineStore.itemById.get('audio')!.audioEffects?.at(-1)).toEqual(first);
	commandHistory.undo();
	expect(order()).toEqual(['pan', 'compressor', 'delay']);
	await addDistortion();
	const third = timelineStore.itemById.get('audio')!.audioEffects?.at(-1);
	expect(third).toMatchObject({ type: 'distortion', amount: 0.45 });
	expect(third!.id).not.toBe(first.id);
	await reopen(project);
	expect(timelineStore.itemById.get('audio')!.audioEffects?.at(-1)).toEqual(third);
	expect(timelineStore.itemById.get('audio')!.audioEffects?.[0]).toMatchObject({
		pan: -0.05,
		enabled: false
	});
});

it('keeps the accepted Chorus rate when a blank numeric draft is abandoned, with explicit reset and cold persistence', async () => {
	const project = fixture();
	project.timeline!.items[0]!.audioEffects = [createDefaultAudioEffect('chorus', 'chorus')];
	sequenceStore.load(project.timeline!, project.metadata);
	commandHistory.clearHistory();
	let screen = await render(Fixture);
	const theme = new WebThemeRuntime();
	try {
		await screen.getByText('Chorus', { exact: true }).click();
		const rate = screen.getByRole('spinbutton', { name: 'Rate (Hz)', exact: true });
		const depth = screen.getByRole('spinbutton', { name: 'Depth (ms)', exact: true });
		await rate.fill('1.2');
		await userEvent.keyboard('{Tab}');
		await expect.element(rate).toHaveValue(1.2);
		const acceptedHistory = commandHistory.undoStack.length;
		await rate.fill('');
		await expect.element(rate).toHaveValue(null);
		expect(timelineStore.itemById.get('audio')?.audioEffects).toMatchObject([{ rateHz: 1.2 }]);
		await userEvent.keyboard('{Tab}');
		await expect.element(rate).toHaveValue(1.2);
		expect(commandHistory.undoStack).toHaveLength(acceptedHistory);
		expect(timelineStore.itemById.get('audio')?.audioEffects).toMatchObject([
			{ id: 'chorus', rateHz: 1.2, depthMs: 4.5 }
		]);
		await rate.fill('');
		await userEvent.keyboard('1.5{Tab}');
		await depth.fill('5');
		await userEvent.keyboard('{Tab}');
		await expect.element(rate).toHaveValue(1.5);
		commandHistory.undo();
		await expect.element(depth).toHaveValue(4.5);
		commandHistory.undo();
		await expect.element(rate).toHaveValue(1.2);
		commandHistory.redo();
		commandHistory.redo();
		await expect.element(rate).toHaveValue(1.5);
		await expect.element(depth).toHaveValue(5);
		await screen.getByRole('button', { name: 'Reset Chorus', exact: true }).click();
		await expect.element(rate).toHaveValue(0.9);
		await expect.element(depth).toHaveValue(4.5);
		commandHistory.undo();
		await expect.element(rate).toHaveValue(1.5);
		await screen.unmount();
		await reopen(project);
		screen = await render(Fixture);
		await screen.getByText('Chorus', { exact: true }).click();
		const reopenedRate = screen.getByRole('spinbutton', { name: 'Rate (Hz)', exact: true });
		await expect.element(reopenedRate).toHaveValue(1.5);
		await expect
			.element(screen.getByRole('spinbutton', { name: 'Depth (ms)', exact: true }))
			.toHaveValue(5);
		for (const scheme of ['light', 'dark'] as const) {
			await theme.apply(resolveBuiltInTheme('dither', scheme), document.documentElement);
			for (const width of [1280, 390, 320]) {
				await page.viewport(width, 844);
				screen.container.style.maxWidth = '500px';
				reopenedRate.element().focus();
				await expect.element(reopenedRate).toHaveFocus();
				await expect.element(reopenedRate).toHaveValue(1.5);
				await page.screenshot({ path: `acf001-${scheme}-${width}.png` });
			}
		}
	} finally {
		await screen.unmount();
		theme.clear(document.documentElement);
	}
}, 30_000);
