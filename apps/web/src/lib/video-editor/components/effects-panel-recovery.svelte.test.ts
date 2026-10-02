import { afterEach, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import type { GpuEffect, ItemEffect } from '../effects/types';
import { createBlankProject, createDefaultTracks } from '../project/defaults';
import { timelineStore } from '../timeline/stores/timeline-store.svelte';
import { commandHistory } from '../timeline/commands/command-store.svelte';
import { getGpuEffectKeyframeProperty } from '../effects/effect-keyframes';
import { setKeyframe } from '../timeline/actions/keyframes';
import { editorSession } from '../editor.svelte';
import { addGpuEffect } from '../timeline/actions/effects';
import { createProject, getProject } from '../workspace-fs/projects';
import { getWorkspaceRoot, setWorkspaceRoot } from '../workspace-fs/root';
import { sequenceStore } from '../sequences/sequence-store.svelte';
import EffectsPanel from './effects-panel.svelte';
import '../../../routes/layout.css';

const rangeMessage = 'No pixels match this range. Set Threshold Low at or below Threshold High.';
const asciiMessage =
	'This custom set has no visible characters. Add a character or choose another character set.';

function gpuEffect(effect: ItemEffect | undefined): GpuEffect {
	if (effect?.type !== 'gpu') throw new Error('Expected the GPU effect created by this fixture.');
	return effect;
}

function setup(effectId: string): GpuEffect {
	timelineStore._setTracks(createDefaultTracks());
	timelineStore._setItems([
		{
			id: 'clip',
			trackId: 'track-video-main',
			type: 'image',
			label: 'Source',
			from: 0,
			durationInFrames: 60
		}
	]);
	expect(addGpuEffect('clip', effectId)).toBe(true);
	return gpuEffect(timelineStore.itemById.get('clip')!.effects![0]);
}

afterEach(() => {
	timelineStore.__resetForTesting();
	commandHistory.clearHistory();
});

it('explains a manually reversed Pixel Sort range and follows undo and recovery without rewriting it', async () => {
	const effect = setup('gpu-pixel-sort-hq');
	const screen = await render(EffectsPanel, { itemId: 'clip', onedit: vi.fn() });
	const low = screen.getByRole('slider', { name: 'Pixel Sort: Threshold Low', exact: true });
	low.element().focus();
	await userEvent.keyboard('{End}');
	expect(gpuEffect(timelineStore.itemById.get('clip')!.effects![0]).params.low).toBe(1);
	expect(gpuEffect(timelineStore.itemById.get('clip')!.effects![0]).params.high).toBe(0.9);
	await expect.element(screen.getByText(rangeMessage)).toBeVisible();
	const description = screen.getByText(rangeMessage).element().id;
	expect(low.element().getAttribute('aria-describedby')).toBe(description);
	expect(
		screen
			.getByRole('textbox', { name: 'Pixel Sort: Threshold High', exact: true })
			.element()
			.getAttribute('aria-describedby')
	).toBe(description);
	commandHistory.undo();
	await expect.element(screen.getByText(rangeMessage)).not.toBeInTheDocument();
	commandHistory.redo();
	await expect.element(screen.getByText(rangeMessage)).toBeVisible();
	low.element().focus();
	await userEvent.keyboard('{Home}');
	await expect.element(screen.getByText(rangeMessage)).not.toBeInTheDocument();
	expect(gpuEffect(timelineStore.itemById.get('clip')!.effects![0]).id).toBe(effect.id);
	await screen.rerender({ itemId: null });
	await expect.element(screen.getByText(rangeMessage)).not.toBeInTheDocument();
});

it('explains an empty custom ASCII set and preserves deliberate emptiness through undo and redo', async () => {
	setup('gpu-ascii');
	const screen = await render(EffectsPanel, { itemId: 'clip', onedit: vi.fn() });
	await screen.getByRole('button', { name: 'ASCII: Character Set', exact: true }).click();
	await screen.getByRole('option', { name: 'Custom', exact: true }).click();
	const chars = screen.getByRole('textbox', { name: 'ASCII: Custom Characters', exact: true });
	await chars.fill('');
	await userEvent.keyboard('{Tab}');
	expect(gpuEffect(timelineStore.itemById.get('clip')!.effects![0]).params.customChars).toBe('');
	await expect.element(screen.getByText(asciiMessage)).toBeVisible();
	expect(chars.element().getAttribute('aria-describedby')).toBe(
		screen.getByText(asciiMessage).element().id
	);
	commandHistory.undo();
	await expect.element(screen.getByText(asciiMessage)).not.toBeInTheDocument();
	commandHistory.redo();
	await expect.element(screen.getByText(asciiMessage)).toBeVisible();
	await chars.fill('01');
	await userEvent.keyboard('{Tab}');
	await expect.element(screen.getByText(asciiMessage)).not.toBeInTheDocument();
	expect(gpuEffect(timelineStore.itemById.get('clip')!.effects![0]).params.customChars).toBe('01');
});

it('explains the resolved keyed range at the playhead without changing its authored thresholds', async () => {
	const effect = setup('gpu-pixel-sort-hq');
	const property = getGpuEffectKeyframeProperty(effect, 'low')!;
	expect(setKeyframe('clip', property, 0, 0.1)).toBe(true);
	expect(setKeyframe('clip', property, 30, 1)).toBe(true);
	const screen = await render(EffectsPanel, { itemId: 'clip', onedit: vi.fn() });
	editorSession.clock.seek(0);
	await expect.element(screen.getByText(rangeMessage)).not.toBeInTheDocument();
	editorSession.clock.seek(30);
	await expect.element(screen.getByText(rangeMessage)).toBeVisible();
	expect(gpuEffect(timelineStore.itemById.get('clip')!.effects![0]).params.low).toBe(0.25);
	expect(timelineStore.itemById.get('clip')!.keyframes![property]!.values).toEqual([0.1, 1]);
	editorSession.clock.seek(15);
	await expect.element(screen.getByText(rangeMessage)).not.toBeInTheDocument();
	await expect
		.element(screen.getByRole('slider', { name: 'Pixel Sort: Threshold Low', exact: true }))
		.toHaveAttribute('aria-valuenow', '0.55');
});

it('retains intentional empty outcomes and their keyed recovery guidance after local save and reopen', async () => {
	const previous = getWorkspaceRoot();
	const root = await navigator.storage.getDirectory();
	const directory = `gpu-recovery-${crypto.randomUUID()}`;
	setWorkspaceRoot(await root.getDirectoryHandle(directory, { create: true }));
	const project = createBlankProject('GPU recovery');
	project.timeline!.items = [
		{
			id: 'source',
			trackId: 'track-video-main',
			type: 'shape',
			shapeType: 'rectangle',
			fillColor: '#ff0000',
			label: 'Source',
			from: 0,
			durationInFrames: 60,
			transform: { width: 160, height: 90 },
			sourceWidth: 160,
			sourceHeight: 90
		}
	];
	let screen: Awaited<ReturnType<typeof render>> | undefined;
	try {
		await createProject(project);
		await editorSession.load(project.id);
		expect(editorSession.loadError).toBe('');
		expect(addGpuEffect('source', 'gpu-pixel-sort-hq')).toBe(true);
		expect(addGpuEffect('source', 'gpu-ascii')).toBe(true);
		screen = await render(EffectsPanel, {
			itemId: 'source',
			onedit: () => editorSession.scheduleAutosave()
		});
		screen
			.getByRole('slider', { name: 'Pixel Sort: Threshold Low', exact: true })
			.element()
			.focus();
		await userEvent.keyboard('{End}');
		await screen.getByRole('button', { name: 'ASCII: Character Set', exact: true }).click();
		await screen.getByRole('option', { name: 'Custom', exact: true }).click();
		await screen.getByRole('textbox', { name: 'ASCII: Custom Characters', exact: true }).fill('');
		await userEvent.keyboard('{Tab}');
		const effect = gpuEffect(timelineStore.itemById.get('source')!.effects![0]);
		const property = getGpuEffectKeyframeProperty(effect, 'low')!;
		expect(setKeyframe('source', property, 0, 0.1)).toBe(true);
		expect(setKeyframe('source', property, 30, 1)).toBe(true);
		await editorSession.saveNow();
		const saved = await getProject(project.id);
		expect(gpuEffect(saved!.timeline!.items[0]!.effects![0]).params).toMatchObject({
			low: 1,
			high: 0.9
		});
		expect(gpuEffect(saved!.timeline!.items[0]!.effects![1]).params).toMatchObject({
			charSet: 'custom',
			customChars: ''
		});
		expect(saved!.timeline!.items[0]!.keyframes![property]!.values).toEqual([0.1, 1]);
		await screen.unmount();
		screen.container.remove();
		screen = undefined;
		editorSession.stopAutosaveTimers();
		editorSession.project = null;
		sequenceStore.reset();
		timelineStore.__resetForTesting();
		commandHistory.clearHistory();
		await editorSession.load(project.id);
		expect(editorSession.loadError).toBe('');
		screen = await render(EffectsPanel, {
			itemId: 'source',
			onedit: () => editorSession.scheduleAutosave()
		});
		editorSession.clock.seek(30);
		await expect.element(screen.getByText(rangeMessage)).toBeVisible();
		await expect.element(screen.getByText(asciiMessage)).toBeVisible();
		editorSession.clock.seek(0);
		await expect.element(screen.getByText(rangeMessage)).not.toBeInTheDocument();
		await expect.element(screen.getByText(asciiMessage)).toBeVisible();
	} finally {
		await screen?.unmount();
		screen?.container.remove();
		editorSession.stopAutosaveTimers();
		editorSession.project = null;
		sequenceStore.reset();
		setWorkspaceRoot(previous);
		await root.removeEntry(directory, { recursive: true });
	}
});
