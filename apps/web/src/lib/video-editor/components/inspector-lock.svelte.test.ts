import { afterEach, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { userEvent } from 'vitest/browser';
import { m } from '$lib/paraglide/messages';
import { createBlankProject } from '../project/defaults';
import type { Project, TimelineTrack } from '../project/types';
import { createProject, getProject } from '../workspace-fs/projects';
import { getWorkspaceRoot, setWorkspaceRoot } from '../workspace-fs/root';
import { timelineStore } from '../timeline/stores/timeline-store.svelte';
import { sequenceStore } from '../sequences/sequence-store.svelte';
import { commandHistory } from '../timeline/commands/command-store.svelte';
import { updateItemProperties } from '../timeline/actions/items';
import {
	setTextItemLayout,
	updateTextSpan,
	applyTextEffectPreset
} from '../timeline/actions/text-layout';
import TextPropertiesPanel from './text-properties-panel.svelte';
import SubtitlePropertiesPanel from './subtitle-properties-panel.svelte';
import CornerPinPropertiesPanel from './corner-pin-properties-panel.svelte';

afterEach(() => {
	sequenceStore.reset();
	timelineStore.__resetForTesting();
	commandHistory.clearHistory();
});

function fixture() {
	const project = createBlankProject('Locked authored content');
	project.timeline!.items = [
		{
			id: 'text',
			type: 'text',
			text: 'Original',
			label: 'Original',
			trackId: 'track-video-main',
			from: 0,
			durationInFrames: 30
		},
		{
			id: 'caption',
			type: 'subtitle',
			text: 'Olá café 東京',
			label: 'Caption',
			fontWeight: 600,
			trackId: 'track-video-main',
			from: 0,
			durationInFrames: 30
		},
		{
			id: 'video',
			type: 'video',
			label: 'Video',
			trackId: 'track-video-main',
			from: 0,
			durationInFrames: 30
		}
	];
	sequenceStore.load(project.timeline!, project.metadata);
	commandHistory.clearHistory();
	return project;
}

async function reopenSaved(project: Project) {
	const previous = getWorkspaceRoot();
	const opfs = await navigator.storage.getDirectory();
	const folderName = `inspector-lock-${crypto.randomUUID()}`;
	setWorkspaceRoot(await opfs.getDirectoryHandle(folderName, { create: true }));
	try {
		await createProject({ ...project, timeline: sequenceStore.projectTimeline() });
		sequenceStore.reset();
		const reopened = (await getProject(project.id))!;
		sequenceStore.load(reopened.timeline!, reopened.metadata);
	} finally {
		setWorkspaceRoot(previous);
		await opfs.removeEntry(folderName, { recursive: true });
	}
}

it.each(['track', 'group'])(
	'rejects static inspector edits protected by a %s lock without creating history',
	async (scope) => {
		const project = fixture();
		const tracks = timelineStore.tracks.map((track) =>
			track.id === 'track-video-main'
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
		updateItemProperties('text', { text: 'Locked edit probe' });
		updateItemProperties('caption', { fontWeight: 700 });
		updateItemProperties('video', {
			cornerPin: { topLeft: [1, 0], topRight: [0, 0], bottomRight: [0, 0], bottomLeft: [0, 0] }
		});
		expect(timelineStore.items).toEqual(project.timeline!.items);
		expect(commandHistory.undoStack).toHaveLength(0);
		await reopenSaved(project);
		expect(timelineStore.items).toEqual(project.timeline!.items);
	}
);

it('keeps text browsing and corner-pin disclosure usable while locked edit controls stay disabled', async () => {
	fixture();
	timelineStore._setTracks(timelineStore.tracks.map((track) => ({ ...track, locked: true })));
	const onedit = vi.fn();
	const text = await render(TextPropertiesPanel, {
		item: timelineStore.itemById.get('text')!,
		onedit
	});
	await expect
		.element(text.getByRole('textbox', { name: m.video_editor_tool_text() }))
		.toBeDisabled();
	await text.getByRole('button', { name: m.video_editor_text_browse_styles() }).click();
	await expect
		.element(text.getByRole('group', { name: m.video_editor_text_templates() }))
		.toBeVisible();
	const caption = await render(SubtitlePropertiesPanel, {
		item: timelineStore.itemById.get('caption')!,
		canvasWidth: 1920,
		canvasHeight: 1080,
		onedit
	});
	await expect
		.element(caption.getByRole('button', { name: m.video_editor_caption_bold(), exact: true }))
		.toBeDisabled();
	const pin = await render(CornerPinPropertiesPanel, {
		item: timelineStore.itemById.get('video')!,
		onedit
	});
	await pin.getByRole('button', { name: m.video_editor_corner_pin(), exact: true }).click();
	await expect.element(pin.getByRole('spinbutton', { name: 'TL X', exact: true })).toBeDisabled();
	expect(onedit).not.toHaveBeenCalled();
});

it('rejects span, layout and effect edits on grouped locked text', () => {
	fixture();
	setTextItemLayout('text', 'two');
	const before = JSON.parse(JSON.stringify(timelineStore.items));
	const tracks: TimelineTrack[] = timelineStore.tracks.map((track) => ({
		...track,
		parentTrackId: 'group'
	}));
	tracks.push({
		...tracks[0]!,
		id: 'group',
		parentTrackId: undefined,
		kind: undefined,
		isGroup: true,
		locked: true
	});
	timelineStore._setTracks(tracks);
	commandHistory.clearHistory();
	updateTextSpan('text', 0, { text: 'Locked span edit' });
	setTextItemLayout('text', 'single');
	applyTextEffectPreset(['text'], 'outline');
	expect(timelineStore.items).toEqual(before);
	expect(commandHistory.undoStack).toHaveLength(0);
});

it('edits unlocked caption bold through the control and preserves Undo, Redo and saved reload', async () => {
	const project = fixture();
	const screen = await render(SubtitlePropertiesPanel, {
		item: timelineStore.itemById.get('caption')!,
		canvasWidth: 1920,
		canvasHeight: 1080,
		onedit: vi.fn()
	});
	const bold = screen.getByRole('button', { name: m.video_editor_caption_bold(), exact: true });
	bold.element().focus();
	await userEvent.keyboard('{Enter}');
	expect(timelineStore.itemById.get('caption')!.fontWeight).toBe(700);
	commandHistory.undo();
	await expect.element(bold).toHaveAttribute('aria-pressed', 'false');
	commandHistory.redo();
	await expect.element(bold).toHaveAttribute('aria-pressed', 'true');
	await reopenSaved(project);
	expect(timelineStore.itemById.get('caption')!.fontWeight).toBe(700);
});

it('preserves unlocked text and corner-pin editing, history and saved values', async () => {
	const project = fixture();
	const text = await render(TextPropertiesPanel, {
		item: timelineStore.itemById.get('text')!,
		onedit: vi.fn()
	});
	await text.getByRole('textbox', { name: m.video_editor_tool_text() }).fill('Unlocked edit');
	await userEvent.tab();
	expect(timelineStore.itemById.get('text')!.text).toBe('Unlocked edit');
	commandHistory.undo();
	expect(timelineStore.itemById.get('text')!.text).toBe('Original');
	commandHistory.redo();
	const pin = await render(CornerPinPropertiesPanel, {
		item: timelineStore.itemById.get('video')!,
		onedit: vi.fn()
	});
	await pin.getByRole('button', { name: m.video_editor_corner_pin(), exact: true }).click();
	await pin.getByRole('spinbutton', { name: 'TL X', exact: true }).fill('1');
	await userEvent.tab();
	expect(timelineStore.itemById.get('video')!.cornerPin!.topLeft).toEqual([1, 0]);
	commandHistory.undo();
	expect(timelineStore.itemById.get('video')!.cornerPin).toBeUndefined();
	commandHistory.redo();
	await reopenSaved(project);
	expect(timelineStore.itemById.get('text')!.text).toBe('Unlocked edit');
	expect(timelineStore.itemById.get('video')!.cornerPin!.topLeft).toEqual([1, 0]);
});
