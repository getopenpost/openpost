import { TimelineFrameRenderer } from '../media/render-export';
import { createBlankProject } from '../project/defaults';
import { sequenceStore } from '../sequences/sequence-store.svelte';
import { commandHistory } from '../timeline/commands/command-store.svelte';
import { getWorkspaceRoot, setWorkspaceRoot } from '../workspace-fs/root';
import { createProject, getProject } from '../workspace-fs/projects';
import { afterEach, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { userEvent } from 'vitest/browser';
import { m } from '$lib/paraglide/messages';
import type { TimelineItem } from '$lib/video-editor/project/types';
import { createDefaultTracks } from '$lib/video-editor/project/defaults';
import { timelineStore } from '$lib/video-editor/timeline/stores/timeline-store.svelte';
import ClipPropertiesPanel from './clip-properties-panel.svelte';
import TextTemplateBrowser from './text-template-browser.svelte';

function textItem(): TimelineItem {
	return {
		id: 'text-1',
		trackId: 'track-video-main',
		from: 0,
		durationInFrames: 90,
		label: 'Launch title',
		type: 'text',
		text: 'Ship the work',
		fontFamily: 'Inter',
		fontSize: 64,
		fontWeight: 700,
		color: '#ffffff',
		transform: { x: 0, y: 0, width: 960, height: 240 }
	};
}

afterEach(() => {
	timelineStore.__resetForTesting();
});

it.each([false, true])(
	'edits only selected recording audio, include camera: %s',
	async (includeCamera) => {
		timelineStore._setTracks(createDefaultTracks());
		timelineStore._setItems([
			{
				id: 'screen',
				type: 'video',
				label: 'Screen',
				mediaId: 'screen-media',
				trackId: 'track-video-main',
				from: 0,
				durationInFrames: 90,
				volume: 1,
				linkedGroupId: 'recording'
			},
			{
				id: 'camera-audio',
				type: 'audio',
				label: 'Camera audio',
				mediaId: 'camera-media',
				trackId: 'track-audio',
				from: 0,
				durationInFrames: 90,
				volume: 0.5,
				linkedGroupId: 'recording'
			}
		]);
		const screen = await render(ClipPropertiesPanel, {
			itemId: 'screen',
			itemIds: includeCamera ? ['screen', 'camera-audio'] : ['screen'],
			onedit: vi.fn()
		});
		const gain = screen.getByRole('textbox', { name: 'Gain', exact: false });
		await gain.fill('-12');
		await userEvent.keyboard('{Enter}');
		expect(timelineStore.itemById.get('screen')?.volume).toBeCloseTo(0.2511886);
		expect(timelineStore.itemById.get('camera-audio')?.volume).toBeCloseTo(
			includeCamera ? 0.2511886 : 0.5
		);
	}
);

it('puts selected text editing before geometry and keeps advanced geometry disclosed', async () => {
	const item = textItem();
	timelineStore._setItems([item]);
	const onbrowsetextstyles = vi.fn();
	const screen = await render(ClipPropertiesPanel, {
		itemId: item.id,
		onedit: () => {},
		onbrowsetextstyles
	});

	const text = screen.getByRole('textbox', { name: 'Text' }).element();
	const transform = screen.getByRole('heading', { name: 'Transform' }).element();
	expect(text.compareDocumentPosition(transform) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
	await expect.element(screen.getByRole('heading', { name: 'Text' })).not.toBeInTheDocument();

	const cornerPin = screen.container.querySelector<HTMLButtonElement>(
		'[data-collapsible-trigger][aria-label="Corner pin"]'
	)!;
	expect(cornerPin.getAttribute('aria-expanded')).toBe('false');
	expect(cornerPin.parentElement?.className).toContain('[@media(pointer:coarse)]:min-h-11');
	cornerPin.click();
	await expect.element(screen.getByRole('spinbutton', { name: 'TL X' })).toBeVisible();

	await screen.getByRole('button', { name: 'Browse styles' }).click();
	expect(onbrowsetextstyles).toHaveBeenCalledOnce();
});

it('opens active corner pin controls by default', async () => {
	const item: TimelineItem = {
		...textItem(),
		cornerPin: {
			topLeft: [0, 0],
			topRight: [0, 0],
			bottomRight: [0, 0],
			bottomLeft: [0, 0]
		}
	};
	timelineStore._setItems([item]);
	const screen = await render(ClipPropertiesPanel, {
		itemId: item.id,
		onedit: () => {}
	});

	await vi.waitFor(() => {
		expect(
			screen.container
				.querySelector('[data-collapsible-trigger][aria-label="Corner pin: Active"]')
				?.getAttribute('aria-expanded')
		).toBe('true');
	});
	await expect.element(screen.getByRole('spinbutton', { name: 'TL X' })).toBeVisible();
});

it('applies a rail style to selected text without inserting another item', async () => {
	const item = textItem();
	timelineStore._setItems([item]);
	timelineStore._setTracks(createDefaultTracks());
	const oninserted = vi.fn();
	const onapplied = vi.fn();
	const screen = await render(TextTemplateBrowser, {
		oninserted,
		selectedTextItemId: item.id,
		onapplied
	});

	await screen.getByRole('button', { name: 'Apply Clean' }).click();

	expect(timelineStore.items).toHaveLength(1);
	expect(timelineStore.itemById.get(item.id)?.textStylePresetId).toBe('clean-title');
	expect(oninserted).not.toHaveBeenCalled();
	expect(onapplied).toHaveBeenCalledOnce();
});

it('does not apply a rail style when the selected text track is locked', async () => {
	const item = textItem();
	timelineStore._setItems([item]);
	timelineStore._setTracks(
		createDefaultTracks().map((track) =>
			track.id === item.trackId ? { ...track, locked: true } : track
		)
	);
	const oninserted = vi.fn();
	const onapplied = vi.fn();
	const screen = await render(TextTemplateBrowser, {
		oninserted,
		selectedTextItemId: item.id,
		onapplied
	});

	const preset = screen.getByRole('button', { name: 'Apply Clean' });
	await expect.element(preset).toBeDisabled();
	expect(timelineStore.itemById.get(item.id)?.textStylePresetId).toBeUndefined();
	expect(oninserted).not.toHaveBeenCalled();
	expect(onapplied).not.toHaveBeenCalled();
});

it('exposes clip properties as a named group', async () => {
	// SAFETY: the literal supplies the TimelineItem fields the panel reads for a video clip.
	const item: TimelineItem = {
		id: 'clip-1',
		trackId: 'track-video-main',
		from: 0,
		durationInFrames: 90,
		label: 'Clip',
		type: 'video'
	} as TimelineItem;
	timelineStore._setItems([item]);

	const screen = await render(ClipPropertiesPanel, {
		itemId: item.id,
		itemIds: [item.id],
		onedit: vi.fn()
	});

	const group = screen.getByRole('group', { name: m.video_editor_clip_properties() });
	await expect.element(group).toBeVisible();
	await expect.element(group.getByTestId('clip-crop-section')).toBeVisible();
});

it('keeps everyday video controls visible and discloses detailed playback and crop settings', async () => {
	const item: TimelineItem = {
		id: 'footage',
		trackId: 'track-video-main',
		from: 0,
		durationInFrames: 90,
		label: 'Footage',
		type: 'video'
	};
	timelineStore._setItems([item]);
	const screen = await render(ClipPropertiesPanel, {
		itemId: item.id,
		onedit: vi.fn()
	});
	await expect.element(screen.getByRole('textbox', { name: 'Width', exact: true })).toBeVisible();
	await expect.element(screen.getByRole('textbox', { name: 'Gain', exact: false })).toBeVisible();
	await expect
		.element(screen.getByRole('textbox', { name: 'Anchor X', exact: true }))
		.not.toBeInTheDocument();
	await expect
		.element(screen.getByRole('button', { name: 'Reverse clip', exact: true }))
		.not.toBeInTheDocument();
	await screen.getByRole('button', { name: 'Playback', exact: true }).click();
	await expect
		.element(screen.getByRole('button', { name: 'Reverse clip', exact: true }))
		.toBeVisible();
	await screen.getByRole('button', { name: 'Crop media', exact: true }).click();
	await expect.element(screen.getByRole('textbox', { name: 'Left', exact: true })).toBeVisible();
});

it('marks collapsed appearance and crop groups when only keyframes change those properties', async () => {
	const item: TimelineItem = {
		id: 'animated-footage',
		trackId: 'track-video-main',
		from: 0,
		durationInFrames: 90,
		label: 'Footage',
		type: 'video',
		keyframes: {
			opacity: { frames: [0, 30], values: [1, 0.5] },
			cropLeft: { frames: [0, 30], values: [0, 100] }
		}
	};
	timelineStore._setItems([item]);
	const screen = await render(ClipPropertiesPanel, { itemId: item.id, onedit: vi.fn() });
	await expect
		.element(screen.getByRole('button', { name: 'Appearance: Active', exact: true }))
		.toHaveAttribute('aria-expanded', 'false');
	await expect
		.element(screen.getByRole('button', { name: 'Crop media: Active', exact: true }))
		.toHaveAttribute('aria-expanded', 'false');
});

it('retains the surviving source phase when trimming a compound start through Properties', async () => {
	const project = createBlankProject('Compound trim source phase');
	project.metadata = { ...project.metadata, width: 64, height: 64, fps: 30 };
	const tracks = createDefaultTracks();
	project.timeline = {
		...project.timeline!,
		tracks,
		compositions: [
			{
				id: 'phases',
				name: 'Red then blue',
				fps: 30,
				width: 64,
				height: 64,
				durationInFrames: 90,
				tracks,
				transitions: [],
				items: ['#ff0000', '#0000ff'].map((fillColor, index) => ({
					id: `phase-${index}`,
					type: 'shape' as const,
					label: fillColor,
					shapeType: 'rectangle' as const,
					fillColor,
					trackId: tracks[0]!.id,
					from: index * 45,
					durationInFrames: 45,
					transform: { x: 0, y: 0, width: 64, height: 64 }
				}))
			}
		],
		items: [
			{
				id: 'wrapper',
				type: 'composition',
				label: 'Red then blue',
				trackId: tracks[0]!.id,
				from: 0,
				durationInFrames: 90,
				compositionId: 'phases',
				compositionWidth: 64,
				compositionHeight: 64,
				sourceStart: 0,
				sourceEnd: 90,
				sourceDuration: 90,
				sourceFps: 30
			}
		]
	};
	sequenceStore.reset();
	timelineStore.__resetForTesting();
	sequenceStore.load(project.timeline, project.metadata);
	commandHistory.clearHistory();
	async function survivingPixel() {
		const renderer = new TimelineFrameRenderer({
			...project,
			timeline: sequenceStore.projectTimeline()
		});
		try {
			const canvas = await renderer.render(48);
			return Array.from(canvas.getContext('2d')!.getImageData(32, 32, 1, 1).data);
		} finally {
			renderer.dispose();
		}
	}
	async function expectSurvivingBlue() {
		const pixel = await survivingPixel();
		expect(pixel[0]).toBeLessThanOrEqual(1);
		expect(pixel[1]).toBeLessThanOrEqual(1);
		expect(pixel[2]).toBeGreaterThanOrEqual(254);
		expect(pixel[3]).toBe(255);
	}
	await expectSurvivingBlue();
	timelineStore._setCurrentFrame(30);
	const screen = await render(ClipPropertiesPanel, { itemId: 'wrapper', onedit: vi.fn() });
	const prior = getWorkspaceRoot();
	const root = await navigator.storage.getDirectory();
	const dir = `compound-trim-${crypto.randomUUID()}`;
	try {
		const trim = screen.getByRole('button', { name: 'Trim start to playhead', exact: true });
		await trim.element().focus();
		await userEvent.keyboard('{Enter}');
		await expectSurvivingBlue();
		expect(timelineStore.itemById.get('wrapper')).toMatchObject({
			from: 30,
			durationInFrames: 60,
			sourceStart: 30,
			sourceEnd: 90
		});
		commandHistory.undo();
		expect(timelineStore.itemById.get('wrapper')).toMatchObject({
			from: 0,
			durationInFrames: 90,
			sourceStart: 0
		});
		await expectSurvivingBlue();
		commandHistory.redo();
		await expectSurvivingBlue();
		setWorkspaceRoot(await root.getDirectoryHandle(dir, { create: true }));
		await createProject({ ...project, timeline: sequenceStore.projectTimeline() });
		await screen.unmount();
		sequenceStore.reset();
		timelineStore.__resetForTesting();
		const loaded = (await getProject(project.id))!;
		sequenceStore.load(loaded.timeline!, loaded.metadata);
		expect(timelineStore.itemById.get('wrapper')?.sourceStart).toBe(30);
		await expectSurvivingBlue();
	} finally {
		setWorkspaceRoot(prior);
		await root.removeEntry(dir, { recursive: true }).catch(() => {});
		sequenceStore.reset();
		commandHistory.clearHistory();
	}
});
