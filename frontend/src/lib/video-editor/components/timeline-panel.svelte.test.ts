import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { cleanup, render } from 'vitest-browser-svelte';
import '../../../routes/layout.css';
import type {
	TimelineItem,
	TimelineTrack,
	TimelineTransition
} from '$lib/video-editor/project/types';
import { commandHistory } from '$lib/video-editor/timeline/commands/command-store.svelte';
import { transitionsStore } from '$lib/video-editor/timeline/actions/transitions-store.svelte';
import { timelineStore } from '$lib/video-editor/timeline/stores/timeline-store.svelte';
import { createTrackGroup } from '$lib/video-editor/timeline/actions/tracks';
import { addMarker, setCurrentFrame } from '$lib/video-editor/timeline/actions/items';
import { clearEffectDragData, setEffectDragData } from '$lib/video-editor/timeline/effect-drop';
import {
	clearTransitionDragData,
	setTransitionDragData
} from '$lib/video-editor/timeline/transition-drop';
import { mediaPool } from '$lib/video-editor/media/pool.svelte';
import {
	clearActiveMediaDrag,
	mediaDragData,
	writeMediaDragData
} from '$lib/video-editor/media/media-drag';
import {
	shapeGeneratedItemDragData,
	textGeneratedItemDragData,
	writeGeneratedItemDragData
} from '$lib/video-editor/timeline/generated-item-drag';
import { mediaPlacement } from '$lib/video-editor/media/media-placement.svelte';
import { keyboardShortcuts } from '$lib/video-editor/settings/keyboard-shortcuts.svelte';
import {
	clearSceneDragData,
	setSceneDragData
} from '$lib/video-editor/media/scene-search/scene-drag';
import type { MediaMetadata } from '$lib/video-editor/media/types';
import { clearWaveformCache } from '$lib/video-editor/media/waveform-client';
import { saveWaveform } from '$lib/video-editor/media/waveform-persistence';
import { filmstripCache } from '$lib/video-editor/media/filmstrip-client';
import { animatedImageCache } from '$lib/video-editor/media/animated-image-client';
import { animatedFrameIndexAtTime } from '$lib/video-editor/media/animated-image-plan';
import animatedGifUrl from '$lib/video-editor/media/fixtures/animated-rgb.gif?url';
import { get } from 'svelte/store';
import { timelinePreviewScrub } from '$lib/video-editor/preview/timeline-preview-scrub';
import { editorSession } from '$lib/video-editor/editor.svelte';
import { sequenceStore } from '$lib/video-editor/sequences/sequence-store.svelte';
import { mediaTaskId, mediaTasks } from '$lib/video-editor/media/media-tasks.svelte';
import { colorPreviewStore } from '$lib/video-editor/effects/color-preview-store.svelte';
import { autoKeyframeStore } from '$lib/video-editor/timeline/stores/auto-keyframe-store.svelte';

const FILMSTRIP_TILE_WIDTH = 96;
import TimelinePanel from './timeline-panel.svelte';

function track(id: string, kind: TimelineTrack['kind'], order: number): TimelineTrack {
	return {
		id,
		name: id,
		kind,
		height: 64,
		locked: false,
		syncLock: true,
		visible: true,
		muted: false,
		solo: false,
		order
	};
}

function item(overrides: Partial<TimelineItem>): TimelineItem {
	return {
		id: 'video',
		trackId: 'video-track',
		from: 0,
		durationInFrames: 60,
		label: 'Video',
		type: 'video',
		sourceStart: 0,
		sourceEnd: 60,
		sourceDuration: 180,
		sourceFps: 30,
		...overrides
	};
}

const sceneMedia: MediaMetadata = {
	id: 'scene-media',
	storageType: 'workspace',
	fileName: 'scene-source.mp4',
	fileSize: 100,
	mimeType: 'video/mp4',
	duration: 8,
	width: 1920,
	height: 1080,
	fps: 24,
	codec: 'h264',
	bitrate: 1_000_000,
	tags: ['video']
};

function pendingFileHandle(name: string, file: Promise<File>, onRead: () => void) {
	const handle: FileSystemFileHandle = {
		kind: 'file',
		name,
		getFile: async () => {
			onRead();
			return file;
		},
		async createWritable() {
			throw new Error('This test handle is read-only.');
		},
		async createSyncAccessHandle() {
			throw new Error('This test handle cannot open a sync access handle.');
		},
		async isSameEntry(other) {
			return other === handle;
		}
	};
	return handle;
}

function dispatchPointer(
	target: EventTarget,
	type: 'pointerdown' | 'pointermove' | 'pointerup',
	clientX: number,
	shiftKey = false,
	clientY = 0,
	altKey = false
): void {
	target.dispatchEvent(
		new PointerEvent(type, {
			bubbles: true,
			button: 0,
			buttons: type === 'pointerup' ? 0 : 1,
			clientX,
			clientY,
			pointerId: 7,
			shiftKey,
			altKey
		})
	);
}

async function nextAnimationFrame(): Promise<void> {
	await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

beforeEach(() => {
	timelinePreviewScrub.__resetForTesting();
	colorPreviewStore.__resetForTesting();
	mediaTasks.reset();
	clearSceneDragData();
	clearEffectDragData();
	clearTransitionDragData();
	clearActiveMediaDrag();
	mediaPlacement.cancel();
	sequenceStore.reset();
	mediaPool.loadAll([sceneMedia]);
	keyboardShortcuts.resetAll();
	autoKeyframeStore.reset();
	timelineStore.__resetForTesting();
	commandHistory.clearHistory();
	transitionsStore.setAll([]);
	timelineStore.setAll({
		tracks: [track('video-track', 'video', 0), track('audio-track', 'audio', 1)],
		items: [
			item({}),
			item({
				id: 'music-bed',
				trackId: 'audio-track',
				label: 'Music',
				type: 'audio',
				durationInFrames: 120,
				sourceEnd: 120
			})
		],
		fps: 30
	});
});

afterEach(() => cleanup());

describe('TimelinePanel progressive controls', () => {
	it('offers target-aware timeline actions by right click and keyboard', async () => {
		await page.viewport(720, 600);
		const ondelete = vi.fn();
		const screen = await render(TimelinePanel, {
			onedit: vi.fn(),
			selectedItemId: 'video',
			selectedItemIds: ['video'],
			ondeleteselection: ondelete
		});
		const clip = screen.container.querySelector<HTMLButtonElement>(
			'[data-timeline-item-id="video"] > button'
		);
		expect(clip).not.toBeNull();

		clip!.dispatchEvent(
			new MouseEvent('contextmenu', {
				bubbles: true,
				cancelable: true,
				clientX: 250,
				clientY: 120
			})
		);
		await expect
			.element(screen.getByRole('menuitem', { name: /^Delete and leave gap/ }))
			.toBeVisible();
		await page.screenshot({
			path: '../../../../.svelte-kit/openpost-timeline-context-menu.png'
		});
		await screen.getByRole('menuitem', { name: /^Delete and leave gap/ }).click();
		expect(ondelete).toHaveBeenCalledOnce();
		await vi.waitFor(() =>
			expect(
				document.querySelector('[data-slot="context-menu-content"][data-state="open"]')
			).toBeNull()
		);

		clip!.focus();
		await userEvent.keyboard('{Shift>}{F10}{/Shift}');
		await expect.element(screen.getByRole('menuitem', { name: /^Copy/ })).toBeVisible();
	});

	it('runs applicable clip actions from the pointer-targeted context menu', async () => {
		await page.viewport(320, 720);
		const left = item({
			id: 'left',
			originId: 'origin',
			mediaId: 'media',
			durationInFrames: 30,
			sourceEnd: 30
		});
		const right = item({
			id: 'right',
			originId: 'origin',
			mediaId: 'media',
			from: 30,
			durationInFrames: 30,
			sourceStart: 30,
			sourceEnd: 60
		});
		timelineStore._setItems([left, right]);
		timelineStore._setCurrentFrame(45);
		const onedit = vi.fn();
		const screen = await render(TimelinePanel, {
			onedit,
			selectedItemId: right.id,
			selectedItemIds: [left.id, right.id]
		});
		const clip = screen.container.querySelector<HTMLButtonElement>(
			`[data-timeline-item-id="${right.id}"] > button`
		);
		expect(clip).not.toBeNull();

		await userEvent.click(clip!, { button: 'right' });
		await expect.element(screen.getByRole('menuitem', { name: 'Freeze frame' })).toBeEnabled();
		await expect
			.element(screen.getByRole('menuitem', { name: 'Arrange selected clips' }))
			.toBeVisible();
		await screen.getByRole('menuitem', { name: /^Join selected clips/ }).click();

		expect(timelineStore.items).toHaveLength(1);
		expect(commandHistory.getLastCommandType()).toBe('JOIN_ITEMS');
		expect(onedit).toHaveBeenCalledOnce();
	});

	it('joins either continuous neighbor from one right-clicked split clip', async () => {
		const left = item({
			id: 'left',
			originId: 'origin',
			mediaId: 'media',
			durationInFrames: 30,
			sourceEnd: 30
		});
		const middle = item({
			id: 'middle',
			originId: 'origin',
			mediaId: 'media',
			from: 30,
			durationInFrames: 30,
			sourceStart: 30,
			sourceEnd: 60
		});
		const right = item({
			id: 'right',
			originId: 'origin',
			mediaId: 'media',
			from: 60,
			durationInFrames: 30,
			sourceStart: 60,
			sourceEnd: 90
		});
		timelineStore._setItems([left, middle, right]);
		const onedit = vi.fn();
		const screen = await render(TimelinePanel, {
			onedit,
			selectedItemId: middle.id,
			selectedItemIds: [middle.id]
		});
		const middleClip = screen.container.querySelector<HTMLButtonElement>(
			`[data-timeline-item-id="${middle.id}"] > button`
		);
		expect(middleClip).not.toBeNull();

		await userEvent.click(middleClip!, { button: 'right' });
		await expect
			.element(screen.getByRole('menuitem', { name: /^Join with previous clip/ }))
			.toBeVisible();
		await expect
			.element(screen.getByRole('menuitem', { name: /^Join with next clip/ }))
			.toBeVisible();
		screen
			.getByRole('menuitem', { name: /^Join with previous clip/ })
			.element()
			.click();
		expect(timelineStore.items.map((candidate) => candidate.id)).toEqual(['left', 'right']);
		expect(timelineStore.itemById.get('left')?.durationInFrames).toBe(60);
		expect(commandHistory.getLastCommandType()).toBe('JOIN_ITEMS');

		commandHistory.undo();
		const restoredMiddle = screen.container.querySelector<HTMLButtonElement>(
			`[data-timeline-item-id="${middle.id}"] > button`
		);
		expect(restoredMiddle).not.toBeNull();
		await userEvent.click(restoredMiddle!, { button: 'right' });
		screen
			.getByRole('menuitem', { name: /^Join with next clip/ })
			.element()
			.click();
		expect(timelineStore.items.map((candidate) => candidate.id)).toEqual(['left', 'middle']);
		expect(timelineStore.itemById.get('middle')?.durationInFrames).toBe(60);
		expect(onedit).toHaveBeenCalledTimes(2);
	});

	it('routes media tools to the exact clips opened by right click', async () => {
		await page.viewport(720, 720);
		mediaPool.loadAll([
			{
				...sceneMedia,
				fileName: 'scene-source.mkv',
				mimeType: 'video/x-matroska'
			}
		]);
		timelineStore._setItems(
			timelineStore.items.map((entry) =>
				entry.id === 'video' ? { ...entry, mediaId: sceneMedia.id } : entry
			)
		);
		const onreverseitems = vi.fn();
		const onsplitscenes = vi.fn();
		const ontranscribecaptions = vi.fn();
		const onaicaptions = vi.fn();
		const onextractsubtitles = vi.fn();
		const onopenspeechcleanup = vi.fn();
		const oncreatecompound = vi.fn();
		const screen = await render(TimelinePanel, {
			onedit: vi.fn(),
			onreverseitems,
			onsplitscenes,
			ontranscribecaptions,
			onaicaptions,
			onextractsubtitles,
			onopenspeechcleanup,
			oncreatecompound
		});
		const clip = screen.container.querySelector<HTMLButtonElement>(
			'[data-timeline-item-id="video"] > button'
		);
		expect(clip).not.toBeNull();

		await userEvent.click(clip!, { button: 'right' });
		await expect
			.element(screen.getByRole('menuitem', { name: 'Create compound clip' }))
			.toBeVisible();
		await userEvent.hover(screen.getByRole('menuitem', { name: 'Edit' }).element());
		await expect.element(screen.getByRole('menuitem', { name: /^Reverse clip/ })).toBeVisible();
		await expect
			.element(screen.getByRole('menuitem', { name: 'Auto-split at scene changes' }))
			.toBeVisible();
		screen.getByRole('menuitem', { name: 'Auto-split at scene changes' }).element().focus();
		await userEvent.keyboard('{ArrowRight}');
		await expect.element(screen.getByRole('menuitem', { name: /^Fast scan/ })).toBeVisible();
		await expect.element(screen.getByRole('menuitem', { name: /^Adaptive \+ LFM/ })).toBeVisible();
		await expect.element(screen.getByRole('menuitem', { name: 'Captions' })).toBeVisible();
		await expect.element(screen.getByRole('menuitem', { name: 'Fillers' })).toBeVisible();
		await expect.element(screen.getByRole('menuitem', { name: 'Silence' })).toBeVisible();
		screen
			.getByRole('menuitem', { name: /^Reverse clip/ })
			.element()
			.click();
		expect(onreverseitems).toHaveBeenCalledWith(['video'], true);

		await userEvent.click(clip!, { button: 'right' });
		await userEvent.hover(screen.getByRole('menuitem', { name: 'Edit' }).element());
		screen.getByRole('menuitem', { name: 'Auto-split at scene changes' }).element().focus();
		await userEvent.keyboard('{ArrowRight}');
		screen
			.getByRole('menuitem', { name: /^Fast scan/ })
			.element()
			.click();
		expect(onsplitscenes).toHaveBeenCalledWith('video', 'fast');

		await userEvent.click(clip!, { button: 'right' });
		await userEvent.hover(screen.getByRole('menuitem', { name: 'Edit' }).element());
		screen.getByRole('menuitem', { name: 'Auto-split at scene changes' }).element().focus();
		await userEvent.keyboard('{ArrowRight}');
		screen
			.getByRole('menuitem', { name: /^Adaptive \+ LFM/ })
			.element()
			.click();
		expect(onsplitscenes).toHaveBeenCalledWith('video', 'adaptive-lfm');

		await userEvent.click(clip!, { button: 'right' });
		await userEvent.hover(screen.getByRole('menuitem', { name: 'Edit' }).element());
		screen.getByRole('menuitem', { name: 'Captions' }).element().focus();
		await userEvent.keyboard('{ArrowRight}');
		await expect
			.element(screen.getByRole('menuitem', { name: 'Generate captions locally' }))
			.toBeVisible();
		await expect
			.element(screen.getByRole('menuitem', { name: 'Describe scenes with AI' }))
			.toBeVisible();
		await expect
			.element(screen.getByRole('menuitem', { name: 'Extract embedded subtitles' }))
			.toBeVisible();
		screen.getByRole('menuitem', { name: 'Generate captions locally' }).element().click();
		expect(ontranscribecaptions).toHaveBeenCalledWith('video');

		await userEvent.click(clip!, { button: 'right' });
		await userEvent.hover(screen.getByRole('menuitem', { name: 'Edit' }).element());
		screen.getByRole('menuitem', { name: 'Captions' }).element().focus();
		await userEvent.keyboard('{ArrowRight}');
		screen.getByRole('menuitem', { name: 'Describe scenes with AI' }).element().click();
		expect(onaicaptions).toHaveBeenCalledWith('video');

		await userEvent.click(clip!, { button: 'right' });
		await userEvent.hover(screen.getByRole('menuitem', { name: 'Edit' }).element());
		screen.getByRole('menuitem', { name: 'Captions' }).element().focus();
		await userEvent.keyboard('{ArrowRight}');
		screen.getByRole('menuitem', { name: 'Extract embedded subtitles' }).element().click();
		expect(onextractsubtitles).toHaveBeenCalledWith('video');

		await userEvent.click(clip!, { button: 'right' });
		await userEvent.hover(screen.getByRole('menuitem', { name: 'Edit' }).element());
		screen.getByRole('menuitem', { name: 'Fillers' }).element().click();
		expect(onopenspeechcleanup).toHaveBeenCalledWith('fillers', ['video']);

		await userEvent.click(clip!, { button: 'right' });
		await screen.getByRole('menuitem', { name: 'Create compound clip' }).click();
		expect(oncreatecompound).toHaveBeenCalledWith(['video']);
	});

	it('consolidates selected imported captions from their right-click menu', async () => {
		timelineStore._setTracks([track('caption-track', 'video', -1), ...timelineStore.tracks]);
		const captions = [
			item({
				id: 'caption-a',
				trackId: 'caption-track',
				from: 0,
				durationInFrames: 20,
				label: 'First caption',
				type: 'text',
				text: 'First caption',
				captionSource: {
					type: 'subtitle-import',
					clipId: 'video',
					mediaId: 'scene-media',
					fileName: 'captions.srt',
					format: 'srt'
				}
			}),
			item({
				id: 'caption-b',
				trackId: 'caption-track',
				from: 20,
				durationInFrames: 20,
				label: 'Second caption',
				type: 'text',
				text: 'Second caption',
				captionSource: {
					type: 'subtitle-import',
					clipId: 'video',
					mediaId: 'scene-media',
					fileName: 'captions.srt',
					format: 'srt'
				}
			})
		];
		timelineStore._setItems([timelineStore.itemById.get('video')!, ...captions]);
		const screen = await render(TimelinePanel, {
			onedit: vi.fn(),
			selectedItemId: captions[0]!.id,
			selectedItemIds: captions.map((caption) => caption.id)
		});
		const caption = screen.container.querySelector<HTMLButtonElement>(
			'[data-timeline-item-id="caption-a"] > button'
		)!;

		await userEvent.click(caption, { button: 'right' });
		await userEvent.hover(screen.getByRole('menuitem', { name: 'Edit' }).element());
		screen.getByRole('menuitem', { name: 'Captions' }).element().focus();
		await userEvent.keyboard('{ArrowRight}');
		await screen.getByRole('menuitem', { name: 'Consolidate captions' }).click();

		expect(commandHistory.getLastCommandType()).toBe('CONSOLIDATE_CAPTIONS');
		expect(timelineStore.items.filter((entry) => entry.type === 'subtitle')).toHaveLength(1);
		expect(timelineStore.items.filter((entry) => entry.type === 'text')).toHaveLength(0);
	});

	it('reports refresh and pending caption states for the exact source clip', async () => {
		mediaPool.loadAll([sceneMedia]);
		timelineStore._setTracks([track('caption-track', 'video', -1), ...timelineStore.tracks]);
		timelineStore._setItems([
			item({ mediaId: sceneMedia.id }),
			item({
				id: 'speech-captions',
				type: 'subtitle',
				trackId: 'caption-track',
				captionSource: {
					type: 'transcript',
					clipId: 'video',
					mediaId: sceneMedia.id
				},
				cues: []
			}),
			item({
				id: 'scene-captions',
				type: 'subtitle',
				trackId: 'caption-track',
				captionSource: {
					type: 'ai-captions',
					clipId: 'video',
					mediaId: sceneMedia.id
				},
				cues: []
			})
		]);
		const screen = await render(TimelinePanel, { onedit: vi.fn() });
		const clip = screen.container.querySelector<HTMLButtonElement>(
			'[data-timeline-item-id="video"] > button'
		)!;

		await userEvent.click(clip, { button: 'right' });
		await userEvent.hover(screen.getByRole('menuitem', { name: 'Edit' }).element());
		screen.getByRole('menuitem', { name: 'Captions' }).element().focus();
		await userEvent.keyboard('{ArrowRight}');
		await expect
			.element(screen.getByRole('menuitem', { name: 'Regenerate auto-captions' }))
			.toBeVisible();
		await expect
			.element(screen.getByRole('menuitem', { name: 'Refresh AI scene captions' }))
			.toBeVisible();
	});

	it('disables caption actions while their jobs are active', async () => {
		mediaPool.loadAll([sceneMedia]);
		timelineStore._setItems([item({ mediaId: sceneMedia.id })]);
		const screen = await render(TimelinePanel, {
			onedit: vi.fn(),
			transcriptionPendingItemIds: ['video'],
			aiCaptionPendingItemIds: ['video']
		});
		const clip = screen.container.querySelector<HTMLButtonElement>(
			'[data-timeline-item-id="video"] > button'
		)!;

		await userEvent.click(clip, { button: 'right' });
		await userEvent.hover(screen.getByRole('menuitem', { name: 'Edit' }).element());
		screen.getByRole('menuitem', { name: 'Captions' }).element().focus();
		await userEvent.keyboard('{ArrowRight}');
		await expect
			.element(screen.getByRole('menuitem', { name: 'Updating auto-captions…' }))
			.toHaveAttribute('data-disabled');
		await expect
			.element(screen.getByRole('menuitem', { name: 'Updating AI scene captions…' }))
			.toHaveAttribute('data-disabled');
	});

	it('offers text voice and compound dissolve for compatible clips', async () => {
		const oncreatevoice = vi.fn();
		const ondissolvecompound = vi.fn();
		timelineStore._setItems([
			item({
				id: 'title',
				type: 'text',
				text: '  Read this aloud.  ',
				label: 'Title'
			}),
			item({
				id: 'compound',
				type: 'composition',
				compositionId: 'sequence',
				from: 90
			})
		]);
		const screen = await render(TimelinePanel, {
			onedit: vi.fn(),
			oncreatevoice,
			ondissolvecompound
		});
		const title = screen.container.querySelector<HTMLButtonElement>(
			'[data-timeline-item-id="title"] > button'
		);
		const compound = screen.container.querySelector<HTMLButtonElement>(
			'[data-timeline-item-id="compound"] > button'
		);
		expect(title).not.toBeNull();
		expect(compound).not.toBeNull();

		await userEvent.click(title!, { button: 'right' });
		await userEvent.hover(screen.getByRole('menuitem', { name: 'Edit' }).element());
		await screen.getByRole('menuitem', { name: 'Create voice from text' }).click();
		expect(oncreatevoice).toHaveBeenCalledWith('title', 'Read this aloud.');

		await userEvent.click(compound!, { button: 'right' });
		await screen.getByRole('menuitem', { name: 'Dissolve compound clip' }).click();
		expect(ondissolvecompound).toHaveBeenCalledWith('compound');
	});

	it('copies and pastes grades for the exact visual context selection', async () => {
		const oncopygrade = vi.fn();
		const onpastegrade = vi.fn();
		timelineStore._updateItems([
			{
				id: 'video',
				patch: {
					effects: [
						{
							id: 'grade',
							type: 'gpu',
							effectId: 'gpu-color-wheels',
							params: { lift: -0.2 },
							enabled: true
						}
					]
				}
			}
		]);
		const screen = await render(TimelinePanel, {
			onedit: vi.fn(),
			selectedItemId: 'video',
			selectedItemIds: ['video', 'music-bed'],
			oncopygrade,
			onpastegrade
		});
		const clip = screen.container.querySelector<HTMLButtonElement>(
			'[data-timeline-item-id="video"] > button'
		);
		expect(clip).not.toBeNull();

		await userEvent.click(clip!, { button: 'right' });
		await userEvent.hover(screen.getByRole('menuitem', { name: 'Edit' }).element());
		screen.getByRole('menuitem', { name: 'Copy grade' }).element().click();
		expect(oncopygrade).toHaveBeenCalledWith('video');

		colorPreviewStore.copyGrade([
			{ effectId: 'gpu-color-wheels', params: { gain: 1.4 }, enabled: true }
		]);
		await userEvent.click(clip!, { button: 'right' });
		await userEvent.hover(screen.getByRole('menuitem', { name: 'Edit' }).element());
		screen.getByRole('menuitem', { name: 'Paste grade' }).element().click();
		expect(onpastegrade).toHaveBeenCalledWith(['video']);
	});

	it('targets and removes a transition instead of opening the track menu', async () => {
		await page.viewport(320, 720);
		const left = item({
			id: 'left',
			mediaId: 'media',
			durationInFrames: 60,
			sourceEnd: 60
		});
		const right = item({
			id: 'right',
			mediaId: 'media',
			from: 60,
			durationInFrames: 60,
			sourceStart: 60,
			sourceEnd: 120
		});
		timelineStore._setItems([left, right]);
		const transition: TimelineTransition = {
			id: 'dissolve',
			type: 'crossfade',
			presentation: 'fade',
			durationInFrames: 20,
			alignment: 0.5,
			fromItemId: left.id,
			toItemId: right.id
		};
		transitionsStore.setAll([transition]);
		const onedit = vi.fn();
		const screen = await render(TimelinePanel, { onedit });
		const target = screen.container.querySelector<HTMLButtonElement>(
			`[data-transition-id="${transition.id}"] > button`
		);
		expect(target).not.toBeNull();

		await userEvent.click(target!, { button: 'right' });
		await expect.element(screen.getByRole('menuitem', { name: 'Remove transition' })).toBeVisible();
		expect(
			[...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].some((item) =>
				item.textContent?.includes('Add marker')
			)
		).toBe(false);
		await screen.getByRole('menuitem', { name: 'Remove transition' }).click();

		expect(transitionsStore.list).toEqual([]);
		expect(commandHistory.getLastCommandType()).toBe('REMOVE_TRANSITION');
		expect(onedit).toHaveBeenCalledOnce();
	});

	it('offers track controls from the track header context menu', async () => {
		const screen = await render(TimelinePanel, { onedit: vi.fn() });
		const trackHeader = screen.container.querySelector<HTMLElement>(
			'[data-track-header="video-track"]'
		);
		expect(trackHeader).not.toBeNull();
		await userEvent.click(trackHeader!, {
			button: 'right',
			position: { x: 8, y: 8 }
		});
		screen.getByRole('menuitem', { name: 'Hide track' }).element().click();
		expect(timelineStore.tracks.find((candidate) => candidate.id === 'video-track')?.visible).toBe(
			false
		);
	});

	it('adds tracks and removes empty tracks from the keyboard-opened header menu', async () => {
		const onedit = vi.fn();
		const screen = await render(TimelinePanel, { onedit });
		const trackName = screen.getByRole('button', { name: 'video-track' });
		await trackName.click();
		await userEvent.keyboard('{Shift>}{F10}{/Shift}');
		await screen.getByRole('menuitem', { name: 'Add track' }).hover();
		const addVideoTrack = screen.getByRole('menuitem', {
			name: 'Add video track'
		});
		await expect.element(addVideoTrack).toBeVisible();
		addVideoTrack.element().click();
		expect(timelineStore.tracks.filter((track) => track.kind === 'video')).toHaveLength(2);
		expect(commandHistory.getLastCommandType()).toBe('ADD_TRACK');

		const trackHeader = screen.container.querySelector<HTMLElement>(
			'[data-track-header="video-track"]'
		)!;
		await userEvent.click(trackHeader, { button: 'right' });
		await screen.getByRole('menuitem', { name: 'Delete empty tracks' }).click();
		expect(timelineStore.tracks.map((track) => track.id)).toEqual(['video-track', 'audio-track']);
		expect(commandHistory.getLastCommandType()).toBe('REMOVE_EMPTY_TRACKS');
		expect(onedit).toHaveBeenCalledTimes(2);
	});

	it('disables empty-track cleanup and hides media-only actions on groups', async () => {
		const screen = await render(TimelinePanel, { onedit: vi.fn() });
		const trackHeader = screen.container.querySelector<HTMLElement>(
			'[data-track-header="video-track"]'
		)!;
		await userEvent.click(trackHeader, { button: 'right' });
		await expect
			.element(screen.getByRole('menuitem', { name: 'Delete empty tracks' }))
			.toBeDisabled();

		await userEvent.keyboard('{Escape}');
		const groupId = createTrackGroup(['video-track'], 'Production')!;
		const groupScreen = await render(TimelinePanel, { onedit: vi.fn() });
		const groupHeader = groupScreen.container.querySelector<HTMLElement>(
			`[data-track-header="${groupId}"]`
		)!;
		await userEvent.click(groupHeader, { button: 'right' });
		await expect
			.element(groupScreen.getByRole('menuitem', { name: 'Add track' }))
			.not.toBeInTheDocument();
	});

	it('adds a marker from an empty-track context menu', async () => {
		await page.viewport(720, 600);
		timelineStore._setItems(
			timelineStore.items.map((candidate) =>
				candidate.id === 'music-bed'
					? { ...candidate, durationInFrames: 5, sourceEnd: 5 }
					: candidate
			)
		);
		const screen = await render(TimelinePanel, { onedit: vi.fn() });
		const timeline = screen.getByRole('region', { name: 'Timeline' }).element();
		await userEvent.click(timeline, {
			button: 'right',
			position: { x: 500, y: 120 }
		});
		screen
			.getByRole('menuitem', { name: /^Add marker/ })
			.element()
			.click();
		expect(timelineStore.markers).toHaveLength(1);
	});

	it('closes the exact bounded gap opened from empty track space', async () => {
		timelineStore._setItems([
			item({ id: 'video-before', from: 0, durationInFrames: 20 }),
			item({ id: 'video-after', from: 60, durationInFrames: 20 }),
			item({
				id: 'audio-after',
				trackId: 'audio-track',
				type: 'audio',
				from: 60,
				durationInFrames: 20
			})
		]);
		const onedit = vi.fn();
		const screen = await render(TimelinePanel, { onedit });
		const row = screen.container.querySelector<HTMLElement>('[data-track="video-track"]')!;
		const before = screen.container.querySelector<HTMLElement>(
			'[data-timeline-item-id="video-before"]'
		)!;
		const after = screen.container.querySelector<HTMLElement>(
			'[data-timeline-item-id="video-after"]'
		)!;
		const rowRect = row.getBoundingClientRect();
		const beforeRect = before.getBoundingClientRect();
		const afterRect = after.getBoundingClientRect();
		const gapX = (beforeRect.right + afterRect.left) / 2 - rowRect.left;

		await userEvent.click(row, {
			button: 'right',
			position: { x: gapX, y: rowRect.height / 2 }
		});
		await screen.getByRole('menuitem', { name: 'Close gap' }).click();

		expect(timelineStore.itemById.get('video-after')?.from).toBe(20);
		expect(timelineStore.itemById.get('audio-after')?.from).toBe(20);
		expect(onedit).toHaveBeenCalledOnce();
	});

	it('closes every track gap from a header context menu and exposes it by keyboard', async () => {
		timelineStore._setItems([
			item({ id: 'video-a', from: 20, durationInFrames: 20 }),
			item({ id: 'video-b', from: 60, durationInFrames: 20 })
		]);
		const screen = await render(TimelinePanel, { onedit: vi.fn() });
		const trackName = screen.getByRole('button', { name: 'video-track' });
		await trackName.click();
		await userEvent.keyboard('{Shift>}{F10}{/Shift}');
		await screen.getByRole('menuitem', { name: 'Close all gaps' }).click();

		expect(timelineStore.itemById.get('video-a')?.from).toBe(0);
		expect(timelineStore.itemById.get('video-b')?.from).toBe(20);
	});

	it('disables track gap closing when the target track is locked', async () => {
		timelineStore._setTracks(
			timelineStore.tracks.map((candidate) =>
				candidate.id === 'video-track' ? { ...candidate, locked: true } : candidate
			)
		);
		timelineStore._setItems([
			item({ id: 'video-a', from: 0, durationInFrames: 20 }),
			item({ id: 'video-b', from: 60, durationInFrames: 20 })
		]);
		const screen = await render(TimelinePanel, { onedit: vi.fn() });
		const trackHeader = screen.container.querySelector<HTMLElement>(
			'[data-track-header="video-track"]'
		)!;
		await userEvent.click(trackHeader, { button: 'right' });

		await expect.element(screen.getByRole('menuitem', { name: 'Close all gaps' })).toBeDisabled();
	});

	it('recolors and deletes a marker from its context menu', async () => {
		const markerId = addMarker(12);
		const screen = await render(TimelinePanel, { onedit: vi.fn() });
		const marker = screen.container.querySelector<HTMLButtonElement>(
			`[data-timeline-marker="${markerId}"]`
		);
		expect(marker).not.toBeNull();

		await userEvent.click(marker!, { button: 'right' });
		await userEvent.hover(screen.getByRole('menuitem', { name: 'Color' }).element());
		await screen.getByRole('menuitem', { name: 'Color 3' }).click();
		expect(timelineStore.markers[0]?.color).toBe('#22c55e');

		await userEvent.click(marker!, { button: 'right' });
		screen.getByRole('menuitem', { name: 'Delete marker' }).element().click();
		expect(timelineStore.markers).toHaveLength(0);
	});

	it('keeps beat analysis and keyframe editing closed until requested', async () => {
		const screen = await render(TimelinePanel, {
			onedit: vi.fn(),
			selectedItemId: 'video',
			selectedItemIds: ['video']
		});

		expect(screen.container.querySelector('[aria-label="Keyframe dope sheet"]')).toBeNull();
		expect(screen.container.querySelector('#beat-detection-heading')).toBeNull();

		const keyframes = screen.getByRole('button', {
			name: 'Keyframes',
			exact: true
		});
		const beats = screen.getByRole('button', {
			name: 'Beat markers',
			exact: true
		});
		await expect.element(keyframes).toHaveAttribute('aria-pressed', 'false');
		await expect.element(beats).toHaveAttribute('aria-pressed', 'false');

		await keyframes.click();
		await beats.click();

		await expect.element(screen.getByRole('region', { name: 'Keyframe dope sheet' })).toBeVisible();
		await expect.element(screen.getByRole('heading', { name: 'Beat markers' })).toBeVisible();
		await expect.element(keyframes).toHaveAttribute('aria-pressed', 'true');
		await expect.element(beats).toHaveAttribute('aria-pressed', 'true');
	});

	it('splits the clicked clip with the remappable razor tool', async () => {
		const onedit = vi.fn();
		const screen = await render(TimelinePanel, { onedit });
		const region = screen.getByRole('region', { name: 'Timeline' }).element();
		vi.spyOn(region, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 900, 300));
		window.dispatchEvent(
			new KeyboardEvent('keydown', {
				key: 'c',
				code: 'KeyC',
				bubbles: true,
				cancelable: true
			})
		);
		const video = screen.container.querySelector<HTMLElement>('[data-timeline-item-id="video"]');
		expect(video).not.toBeNull();
		const button = video!.querySelector<HTMLButtonElement>('button');
		expect(button).not.toBeNull();

		dispatchPointer(button!, 'pointerdown', 180 + 30 * 4);

		const videoPieces = timelineStore.items
			.filter((candidate) => candidate.trackId === 'video-track')
			.toSorted((left, right) => left.from - right.from);
		expect(videoPieces).toHaveLength(2);
		expect(
			videoPieces.map(({ from, durationInFrames }) => ({
				from,
				durationInFrames
			}))
		).toEqual([
			{ from: 0, durationInFrames: 30 },
			{ from: 30, durationInFrames: 30 }
		]);
		expect(
			timelineStore.items.find((candidate) => candidate.id === 'music-bed')?.durationInFrames
		).toBe(120);
		expect(onedit).toHaveBeenCalledOnce();
	});

	it('splits the hovered clip at the preview cursor with Shift+C', async () => {
		const onedit = vi.fn();
		const screen = await render(TimelinePanel, { onedit });
		const region = screen.getByRole('region', { name: 'Timeline' }).element();
		vi.spyOn(region, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 900, 300));
		const video = screen.container.querySelector<HTMLElement>('[data-timeline-item-id="video"]');
		expect(video).not.toBeNull();
		video!.dispatchEvent(
			new PointerEvent('pointermove', {
				bubbles: true,
				clientX: 180 + 40 * 4,
				pointerType: 'mouse'
			})
		);
		await nextAnimationFrame();

		window.dispatchEvent(
			new KeyboardEvent('keydown', {
				key: 'C',
				code: 'KeyC',
				shiftKey: true,
				bubbles: true,
				cancelable: true
			})
		);

		const videoPieces = timelineStore.items
			.filter((candidate) => candidate.trackId === 'video-track')
			.toSorted((left, right) => left.from - right.from);
		expect(
			videoPieces.map(({ from, durationInFrames }) => ({
				from,
				durationInFrames
			}))
		).toEqual([
			{ from: 0, durationInFrames: 40 },
			{ from: 40, durationInFrames: 20 }
		]);
		expect(onedit).toHaveBeenCalledOnce();
	});

	it('scopes remappable FreeCut keyframe commands to the active editor', async () => {
		timelineStore._setItems(
			timelineStore.items.map((candidate) =>
				candidate.id === 'video'
					? {
							...candidate,
							keyframes: {
								opacity: {
									frames: [0, 30],
									values: [0, 1],
									ids: ['start', 'end'],
									easings: ['linear', 'linear']
								}
							}
						}
					: candidate
			)
		);
		const onedit = vi.fn();
		const screen = await render(TimelinePanel, {
			onedit,
			selectedItemId: 'video',
			selectedItemIds: ['video']
		});
		await screen.getByRole('button', { name: 'Keyframes', exact: true }).click();
		const editor = screen.container.querySelector<HTMLElement>('[data-keyframe-shortcuts]');
		expect(editor).not.toBeNull();
		const key = (
			value: string,
			code: string,
			options: { altKey?: boolean; target?: EventTarget } = {}
		) =>
			(options.target ?? editor!).dispatchEvent(
				new KeyboardEvent('keydown', {
					key: value,
					code,
					altKey: options.altKey,
					bubbles: true,
					cancelable: true
				})
			);

		key('1', 'Digit1');
		await expect
			.element(
				screen.getByRole('application', {
					name: 'Keyframe value graph for opacity'
				})
			)
			.toBeVisible();
		expect(screen.container.querySelector('[aria-label="Keyframe dope sheet"]')).toBeNull();
		await screen.getByRole('button', { name: 'Zoom in' }).last().click();
		const graphHost = screen.container.querySelector<HTMLElement>('[data-keyframe-value-graph]');
		expect(Number(graphHost?.dataset.graphEndFrame)).toBeLessThan(59);
		key('f', 'KeyF');
		await vi.waitFor(() => {
			expect(Number(graphHost?.dataset.graphStartFrame)).toBe(0);
			expect(Number(graphHost?.dataset.graphEndFrame)).toBe(59);
		});
		key('3', 'Digit3');
		await expect.element(screen.getByRole('region', { name: 'Keyframe dope sheet' })).toBeVisible();
		await expect
			.element(
				screen.getByRole('application', {
					name: 'Keyframe value graph for opacity'
				})
			)
			.toBeVisible();
		key('2', 'Digit2');
		await vi.waitFor(() =>
			expect(screen.container.querySelector('[data-keyframe-value-graph]')).toBeNull()
		);

		setCurrentFrame(15);
		key('k', 'KeyK');
		expect(timelineStore.itemById.get('video')?.keyframes?.opacity?.frames).toEqual([0, 15, 30]);
		expect(onedit).toHaveBeenCalledTimes(1);
		key('[', 'BracketLeft', { altKey: true });
		expect(timelineStore.currentFrame).toBe(0);
		key(']', 'BracketRight', { altKey: true });
		expect(timelineStore.currentFrame).toBe(15);
		key('a', 'KeyA');
		expect(autoKeyframeStore.isEnabled('video', 'opacity')).toBe(true);
		await expect
			.element(screen.getByRole('button', { name: 'Toggle auto-key for opacity' }))
			.toHaveAttribute('aria-pressed', 'true');

		keyboardShortcuts.setBinding('EDIT_KEYFRAME_ADD', 'alt+8');
		setCurrentFrame(20);
		key('k', 'KeyK');
		expect(timelineStore.itemById.get('video')?.keyframes?.opacity?.frames).not.toContain(20);
		key('8', 'Digit8', { altKey: true });
		expect(timelineStore.itemById.get('video')?.keyframes?.opacity?.frames).toContain(20);

		setCurrentFrame(25);
		editor!.dispatchEvent(new PointerEvent('pointerenter'));
		key('8', 'Digit8', { altKey: true, target: window });
		expect(timelineStore.itemById.get('video')?.keyframes?.opacity?.frames).toContain(25);
		editor!.dispatchEvent(new PointerEvent('pointerleave'));
		setCurrentFrame(26);
		key('8', 'Digit8', { altKey: true, target: window });
		expect(timelineStore.itemById.get('video')?.keyframes?.opacity?.frames).not.toContain(26);
		const input = document.createElement('input');
		editor!.append(input);
		input.focus();
		setCurrentFrame(27);
		key('8', 'Digit8', { altKey: true, target: input });
		expect(timelineStore.itemById.get('video')?.keyframes?.opacity?.frames).not.toContain(27);
		input.blur();
		setCurrentFrame(80);
		key('8', 'Digit8', { altKey: true });
		expect(timelineStore.itemById.get('video')?.keyframes?.opacity?.frames).not.toContain(59);
		await page.viewport(320, 720);
		expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
	});
});

describe('TimelinePanel Bento layout entry', () => {
	it('sizes timeline hit targets for the active pointer at phone width', async () => {
		await page.viewport(320, 720);
		timelineStore._setMarkers([{ id: 'phone-marker', frame: 10, color: '#d97746' }]);
		const screen = await render(TimelinePanel, { onedit: vi.fn() });
		const marker = screen.getByRole('button', { name: 'Marker 1, Frame 10' }).element();
		const trimStart = screen.getByRole('button', { name: 'Trim clip start' }).first().element();
		const trackResize = screen
			.getByRole('slider', { name: 'Resize video-track track height' })
			.element();
		const coarsePointer = window.matchMedia('(pointer: coarse)').matches;
		expect(marker.getBoundingClientRect().width).toBeGreaterThanOrEqual(coarsePointer ? 44 : 20);
		expect(marker.getBoundingClientRect().height).toBeGreaterThanOrEqual(coarsePointer ? 44 : 24);
		expect(trimStart.getBoundingClientRect().width).toBeGreaterThanOrEqual(coarsePointer ? 44 : 8);
		expect(trackResize.getBoundingClientRect().height).toBeGreaterThanOrEqual(
			coarsePointer ? 44 : 8
		);
		expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
	});

	it('shows exact linked A/V drift without crowding short clips', async () => {
		await page.viewport(320, 720);
		timelineStore._setItems([
			item({
				id: 'linked-video',
				label: 'Linked video',
				from: 12,
				durationInFrames: 60,
				linkedGroupId: 'wide-group'
			}),
			item({
				id: 'linked-audio',
				trackId: 'audio-track',
				label: 'Linked audio',
				type: 'audio',
				durationInFrames: 60,
				linkedGroupId: 'wide-group'
			}),
			item({
				id: 'short-video',
				label: 'Short video',
				from: 90,
				durationInFrames: 6,
				linkedGroupId: 'short-group'
			}),
			item({
				id: 'short-audio',
				trackId: 'audio-track',
				label: 'Short audio',
				from: 88,
				durationInFrames: 6,
				type: 'audio',
				linkedGroupId: 'short-group'
			})
		]);

		const screen = await render(TimelinePanel, { onedit: vi.fn() });
		await vi.waitFor(() => {
			const badges = [...document.querySelectorAll<HTMLElement>('[data-linked-sync-offset]')];
			expect(badges.map((badge) => badge.textContent?.trim()).sort()).toEqual(['+00:12', '-00:12']);
		});
		await expect
			.element(
				screen.getByRole('button', {
					name: /Linked video.*out of sync by \+00:12/
				})
			)
			.toBeVisible();
		expect(
			document.querySelector('[data-timeline-item-id="short-video"] [data-linked-sync-offset]')
		).toBeNull();
		expect(
			document.querySelector('[data-timeline-item-id="short-audio"] [data-linked-sync-offset]')
		).toBeNull();
		expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
		const timeline = document.querySelector<HTMLElement>('#video-editor-timeline-scroll');
		expect(timeline).not.toBeNull();
		if (!timeline) throw new Error('Timeline scroll container did not render.');
		timeline.scrollLeft = 170;
		timeline.dispatchEvent(new Event('scroll'));
		await nextAnimationFrame();
		await page.screenshot({
			path: '../../../../.svelte-kit/openpost-linked-sync-320.png'
		});
	});

	it('renders persisted waveforms for audio-only timeline clips', async () => {
		const mediaId = `timeline-audio-${crypto.randomUUID()}`;
		mediaPool.loadAll([
			sceneMedia,
			{
				id: mediaId,
				storageType: 'workspace',
				fileName: 'music.wav',
				fileSize: 100,
				mimeType: 'audio/wav',
				duration: 4,
				width: 0,
				height: 0,
				fps: 0,
				codec: 'pcm_s16le',
				bitrate: 128_000,
				tags: ['audio']
			}
		]);
		timelineStore._setItems([
			...timelineStore.items.filter((candidate) => candidate.id !== 'music-bed'),
			item({
				id: 'music-bed',
				trackId: 'audio-track',
				label: 'Music',
				type: 'audio',
				mediaId,
				durationInFrames: 120,
				sourceEnd: 120
			})
		]);
		await saveWaveform(mediaId, {
			peaks: Float32Array.from({ length: 2_000 }, (_, index) => (index % 100) / 100),
			durationSeconds: 4,
			samplesPerSecond: 500,
			loadedSamples: 2_000,
			isComplete: true
		});

		try {
			const screen = await render(TimelinePanel, { onedit: vi.fn() });
			const clip = screen.getByRole('button', { name: /Music/ });
			await vi.waitFor(() => expect(clip.element().querySelector('svg')).not.toBeNull());
		} finally {
			await clearWaveformCache(mediaId);
		}
	});

	it('bounds and centers the waveform for a long clip', async () => {
		await page.viewport(1_280, 720);
		const mediaId = `timeline-long-audio-${crypto.randomUUID()}`;
		mediaPool.loadAll([
			{
				id: mediaId,
				storageType: 'workspace',
				fileName: 'long-session.wav',
				fileSize: 100,
				mimeType: 'audio/wav',
				duration: 600,
				width: 0,
				height: 0,
				fps: 0,
				codec: 'pcm_s16le',
				bitrate: 128_000,
				tags: ['audio']
			}
		]);
		timelineStore.setAll({
			tracks: [track('audio-track', 'audio', 0)],
			items: [
				item({
					id: 'long-session',
					trackId: 'audio-track',
					label: 'Long session',
					type: 'audio',
					mediaId,
					durationInFrames: 18_000,
					sourceEnd: 18_000,
					sourceDuration: 18_000
				})
			],
			fps: 30,
			zoomLevel: 1
		});
		await saveWaveform(mediaId, {
			peaks: Float32Array.from({ length: 600 }, (_, index) => (index % 10) / 10),
			durationSeconds: 600,
			samplesPerSecond: 1,
			loadedSamples: 600,
			isComplete: true
		});

		try {
			const screen = await render(TimelinePanel, { onedit: vi.fn() });
			const clip = screen.getByRole('button', { name: /Long session/ });
			await vi.waitFor(() =>
				expect(clip.element().querySelector('[data-waveform-window]')).not.toBeNull()
			);
			const waveform = clip.element().querySelector<SVGElement>('[data-waveform-window]')!;
			const renderedWidth = Number(waveform.dataset.renderWidth);
			const clipWidth = Number(waveform.dataset.clipWidth);
			expect(renderedWidth).toBeLessThanOrEqual(2_480);
			expect(clipWidth).toBeGreaterThan(70_000);
			const coordinates = waveform
				.querySelector('polyline')!
				.getAttribute('points')!
				.split(/[ ,]/)
				.map(Number);
			const yCoordinates = coordinates.filter((_, index) => index % 2 === 1);
			expect(Math.min(...yCoordinates)).toBeLessThan(40);
			expect(Math.max(...yCoordinates)).toBeGreaterThan(40);
		} finally {
			await clearWaveformCache(mediaId);
		}
	});

	it('starts waveform work only for visible and approaching clips', async () => {
		await page.viewport(800, 720);
		const nearId = `waveform-near-${crypto.randomUUID()}`;
		const farId = `waveform-far-${crypto.randomUUID()}`;
		const source = new File(['not-decoded'], 'pending.wav', {
			type: 'audio/wav'
		});
		let releaseNear: ((file: File) => void) | undefined;
		let releaseFar: ((file: File) => void) | undefined;
		const nearFile = new Promise<File>((resolve) => (releaseNear = resolve));
		const farFile = new Promise<File>((resolve) => (releaseFar = resolve));
		let nearReads = 0;
		let farReads = 0;
		const audioMedia = (
			id: string,
			fileHandle: FileSystemFileHandle,
			fileName: string
		): MediaMetadata => ({
			id,
			storageType: 'handle',
			fileHandle,
			fileName,
			fileSize: source.size,
			mimeType: source.type,
			duration: 4,
			width: 0,
			height: 0,
			fps: 0,
			codec: 'pcm_s16le',
			bitrate: 128_000,
			tags: ['audio']
		});
		mediaPool.loadAll([
			audioMedia(
				nearId,
				pendingFileHandle('near.wav', nearFile, () => (nearReads += 1)),
				'near.wav'
			),
			audioMedia(
				farId,
				pendingFileHandle('far.wav', farFile, () => (farReads += 1)),
				'far.wav'
			)
		]);
		timelineStore._setItems([
			item({
				id: 'near-clip',
				trackId: 'audio-track',
				label: 'Near audio',
				type: 'audio',
				mediaId: nearId,
				durationInFrames: 120
			}),
			item({
				id: 'far-clip',
				trackId: 'audio-track',
				label: 'Far audio',
				type: 'audio',
				mediaId: farId,
				from: 10_000,
				durationInFrames: 120
			})
		]);

		await render(TimelinePanel, { onedit: vi.fn() });
		const nearTaskId = mediaTaskId('waveform', nearId);
		const farTaskId = mediaTaskId('waveform', farId);
		await vi.waitFor(() => expect(nearReads).toBe(1));
		await new Promise((resolve) => setTimeout(resolve, 180));
		expect(mediaTasks.get(nearTaskId)?.status).toBe('running');
		expect(mediaTasks.get(farTaskId)).toBeUndefined();
		expect(farReads).toBe(0);

		expect(mediaTasks.cancel(nearTaskId)).toBe(true);
		releaseNear?.(source);
		releaseFar?.(source);
		await vi.waitFor(() => expect(mediaTasks.get(nearTaskId)).toBeUndefined());
		await clearWaveformCache(nearId);
		await clearWaveformCache(farId);
	});

	it('edits clip gain from the selected waveform with cancel, one-step undo, and keys', async () => {
		const onedit = vi.fn();
		const screen = await render(TimelinePanel, { onedit });
		const clip = screen.getByRole('button', { name: /Music/ }).element();
		dispatchPointer(clip, 'pointerdown', 300, false, 100);
		dispatchPointer(window, 'pointerup', 300, false, 100);

		const volume = screen.getByRole('slider', { name: /^Volume:/ });
		await expect.element(volume).toBeVisible();
		expect(volume.element().getAttribute('aria-valuetext')).toBe('0.0 dB');

		dispatchPointer(volume.element(), 'pointerdown', 300, false, 100);
		dispatchPointer(window, 'pointermove', 300, false, 80);
		await nextAnimationFrame();
		expect(timelineStore.itemById.get('music-bed')?.volume).toBeGreaterThan(1);
		await expect.element(screen.getByText(/\+\d+\.\d dB/)).toBeVisible();
		window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		expect(timelineStore.itemById.get('music-bed')?.volume ?? 1).toBe(1);
		expect(commandHistory.undoStack).toHaveLength(0);

		dispatchPointer(volume.element(), 'pointerdown', 300, false, 100);
		dispatchPointer(window, 'pointermove', 300, false, 80);
		dispatchPointer(window, 'pointerup', 300, false, 80);
		await nextAnimationFrame();
		expect(timelineStore.itemById.get('music-bed')?.volume).toBeGreaterThan(1);
		expect(commandHistory.getLastCommandType()).toBe('ADJUST_CLIP_VOLUME');
		expect(commandHistory.undoStack).toHaveLength(1);
		expect(onedit).toHaveBeenCalledOnce();

		commandHistory.undo();
		expect(timelineStore.itemById.get('music-bed')?.volume ?? 1).toBe(1);
		volume.element().dispatchEvent(
			new KeyboardEvent('keydown', {
				key: 'ArrowDown',
				shiftKey: true,
				bubbles: true
			})
		);
		expect(timelineStore.itemById.get('music-bed')?.volume).toBeLessThan(1);
		expect(commandHistory.undoStack).toHaveLength(1);
	});

	it('drops an active gain draft on lost capture or unmount without leaking listeners', async () => {
		const onedit = vi.fn();
		const screen = await render(TimelinePanel, { onedit });
		const clip = screen.getByRole('button', { name: /Music/ }).element();
		dispatchPointer(clip, 'pointerdown', 300, false, 100);
		dispatchPointer(window, 'pointerup', 300, false, 100);
		const volumeLocator = screen.getByRole('slider', { name: /^Volume:/ });
		await expect.element(volumeLocator).toBeVisible();
		const volume = volumeLocator.element();

		dispatchPointer(volume, 'pointerdown', 300, false, 100);
		dispatchPointer(window, 'pointermove', 300, false, 80);
		await nextAnimationFrame();
		expect(timelineStore.itemById.get('music-bed')?.volume).toBeGreaterThan(1);
		volume.dispatchEvent(new PointerEvent('lostpointercapture', { bubbles: true, pointerId: 7 }));
		expect(timelineStore.itemById.get('music-bed')?.volume ?? 1).toBe(1);
		expect(commandHistory.undoStack).toHaveLength(0);

		dispatchPointer(volume, 'pointerdown', 300, false, 100);
		dispatchPointer(window, 'pointermove', 300, false, 80);
		await nextAnimationFrame();
		expect(timelineStore.itemById.get('music-bed')?.volume).toBeGreaterThan(1);
		await screen.unmount();
		expect(timelineStore.itemById.get('music-bed')?.volume ?? 1).toBe(1);
		dispatchPointer(window, 'pointermove', 300, false, 60);
		dispatchPointer(window, 'pointerup', 300, false, 60);
		expect(timelineStore.itemById.get('music-bed')?.volume ?? 1).toBe(1);
		expect(commandHistory.undoStack).toHaveLength(0);
		expect(onedit).not.toHaveBeenCalled();
	});

	it('fills a long visible clip with sparse tiles and refines only the viewport', async () => {
		const longMedia: MediaMetadata = {
			...sceneMedia,
			id: 'long-video',
			fileName: 'long-video.mp4',
			duration: 3_600
		};
		const offscreenMedia: MediaMetadata = {
			...sceneMedia,
			id: 'offscreen-video',
			fileName: 'offscreen-video.mp4',
			duration: 60
		};
		mediaPool.loadAll([longMedia, offscreenMedia]);
		const longTracks = Array.from({ length: 8 }, (_, index) =>
			track(`long-track-${index}`, 'video', index)
		);
		timelineStore.setAll({
			tracks: longTracks,
			items: [
				item({
					id: 'long-video-clip',
					label: 'Long video',
					trackId: longTracks[0]!.id,
					mediaId: longMedia.id,
					durationInFrames: 108_000,
					sourceEnd: 108_000,
					sourceDuration: 108_000
				}),
				item({
					id: 'offscreen-video-clip',
					label: 'Offscreen video',
					trackId: longTracks[7]!.id,
					mediaId: offscreenMedia.id,
					from: 0,
					durationInFrames: 1_800,
					sourceEnd: 1_800,
					sourceDuration: 1_800
				})
			],
			fps: 30
		});
		const sparseFrames = [0, 600, 1_200, 1_800, 2_400, 3_000, 3_599].map((index) => ({
			index,
			url: `data:image/gif;base64,R0lGODlhAQABAAAAACw=`
		}));
		const subscribe = vi
			.spyOn(filmstripCache, 'subscribe')
			.mockImplementation((mediaId, callback) => {
				if (mediaId === longMedia.id) {
					callback({
						frames: sparseFrames,
						isComplete: false,
						isExtracting: true,
						progress: 10
					});
				}
				return () => undefined;
			});
		const getFilmstrip = vi.spyOn(filmstripCache, 'getFilmstrip').mockResolvedValue({
			frames: sparseFrames,
			isComplete: false,
			isExtracting: true,
			progress: 10
		});

		try {
			const screen = await render(TimelinePanel, { onedit: vi.fn() });
			screen.container.style.height = '320px';
			await nextAnimationFrame();
			await nextAnimationFrame();
			getFilmstrip.mockClear();
			const region = screen.getByRole('region', { name: 'Timeline' }).element();
			region.dispatchEvent(new Event('scroll'));
			await vi.waitFor(() => expect(getFilmstrip).toHaveBeenCalled());
			expect(getFilmstrip.mock.calls.map(([media]) => media.id)).not.toContain(offscreenMedia.id);

			const clip = screen.getByRole('button', { name: /Long video/ }).element();
			await vi.waitFor(() =>
				expect(clip.querySelectorAll('[data-filmstrip-tile]').length).toBeGreaterThan(3)
			);
			const firstTargets = getFilmstrip.mock.calls[0]?.[1]?.targetFrameIndices ?? [];
			expect(firstTargets.length).toBeGreaterThan(0);
			expect(firstTargets.length).toBeLessThan(40);

			const callCountBeforeScroll = getFilmstrip.mock.calls.length;
			region.scrollLeft = 2_000;
			region.dispatchEvent(new Event('scroll'));
			await nextAnimationFrame();
			await vi.waitFor(() =>
				expect(getFilmstrip.mock.calls.length).toBeGreaterThan(callCountBeforeScroll)
			);
			const latestTargets = getFilmstrip.mock.calls.at(-1)?.[1]?.targetFrameIndices ?? [];
			expect(latestTargets).not.toEqual(firstTargets);
		} finally {
			subscribe.mockRestore();
			getFilmstrip.mockRestore();
		}
	});

	it('rerenders indexed track rows when clips are added and removed', async () => {
		const screen = await render(TimelinePanel, { onedit: vi.fn() });
		await expect.element(screen.getByText('Video', { exact: true })).toBeVisible();

		timelineStore._setItems([
			...timelineStore.items,
			item({ id: 'cutaway', from: 60, label: 'Cutaway' })
		]);
		await expect.element(screen.getByText('Cutaway', { exact: true })).toBeVisible();

		timelineStore._setItems(timelineStore.items.filter((candidate) => candidate.id !== 'cutaway'));
		await expect.element(screen.getByText('Cutaway', { exact: true })).not.toBeInTheDocument();
	});

	it('opens layout work only for a multi-visual unlocked selection', async () => {
		timelineStore._setItems([
			item({
				id: 'video',
				label: 'Video',
				sourceWidth: 1920,
				sourceHeight: 1080
			}),
			item({
				id: 'cutaway',
				label: 'Cutaway',
				sourceWidth: 1080,
				sourceHeight: 1920
			})
		]);
		const screen = await render(TimelinePanel, {
			onedit: vi.fn(),
			selectedItemId: 'video',
			selectedItemIds: ['video', 'cutaway'],
			canvasWidth: 1280,
			canvasHeight: 720
		});

		await screen.getByRole('button', { name: 'More actions' }).last().click();
		const arrange = screen.getByRole('menuitem', {
			name: 'Arrange selected clips'
		});
		await expect.element(arrange).toBeEnabled();
		arrange.element().click();
		await expect.element(screen.getByRole('dialog', { name: 'Arrange clips' })).toBeVisible();
	});
});

describe('TimelinePanel sync-lock ripple trim', () => {
	it('offers freeze-frame insertion only at an eligible video frame', async () => {
		timelineStore._setCurrentFrame(20);
		const onfreezeframe = vi.fn();
		const screen = await render(TimelinePanel, {
			onedit: vi.fn(),
			onfreezeframe,
			selectedItemId: 'video',
			selectedItemIds: ['video']
		});

		await screen.getByRole('button', { name: 'More actions' }).last().click();
		const freeze = screen.getByRole('menuitem', { name: 'Freeze frame' });
		await expect.element(freeze).toBeEnabled();
		freeze.element().click();
		expect(onfreezeframe).toHaveBeenCalledWith('video');

		timelineStore._setCurrentFrame(0);
		await screen.getByRole('button', { name: 'More actions' }).last().click();
		await expect.element(screen.getByRole('menuitem', { name: 'Freeze frame' })).toBeDisabled();
	});

	it('exposes the persisted audio-skimming control', async () => {
		const screen = await render(TimelinePanel, { onedit: vi.fn() });
		await screen.getByRole('button', { name: 'More actions' }).first().click();
		const enabled = screen.getByRole('menuitemcheckbox', {
			name: 'Hear short audio samples while dragging the playhead'
		});
		await expect.element(enabled).toHaveAttribute('aria-checked', 'true');
		enabled.element().click();
		await screen.getByRole('button', { name: 'More actions' }).first().click();
		const disabled = screen.getByRole('menuitemcheckbox', {
			name: 'Hear short audio samples while dragging the playhead'
		});
		await expect.element(disabled).toHaveAttribute('aria-checked', 'false');
		disabled.element().click();
	});

	it('opens and closes the integrated audio mixer without replacing the timeline', async () => {
		const screen = await render(TimelinePanel, { onedit: vi.fn() });
		const toggle = screen.getByRole('button', { name: 'Audio mixer' });
		await toggle.click();
		await expect.element(screen.getByRole('region', { name: 'Audio mixer' })).toBeVisible();
		await expect.element(screen.getByRole('slider', { name: 'audio-track volume' })).toBeVisible();
		await expect
			.element(screen.getByRole('slider', { name: 'Master output volume' }))
			.toBeVisible();
		await expect.element(screen.getByRole('region', { name: 'Timeline' })).toBeVisible();
		await toggle.click();
		await expect
			.element(screen.getByRole('region', { name: 'Audio mixer' }))
			.not.toBeInTheDocument();
	});

	it('fits, resets, shortcuts, and coalesces pointer-anchored wheel zoom', async () => {
		const screen = await render(TimelinePanel, { onedit: vi.fn() });
		const region = document.querySelector<HTMLElement>('[role="region"][aria-label="Timeline"]');
		expect(region).not.toBeNull();
		region!.style.width = '1000px';
		region!.style.maxWidth = '1000px';
		region!.style.overflow = 'auto';
		vi.spyOn(region!, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 1_000, 300));
		await nextAnimationFrame();
		expect(region!.clientWidth).toBe(1_000);

		await screen.getByRole('button', { name: 'Fit timeline' }).click();
		expect(timelineStore.zoomLevel).toBeCloseTo(770 / (300 * 4));
		expect(region!.scrollLeft).toBe(0);

		window.dispatchEvent(
			new KeyboardEvent('keydown', {
				key: '=',
				ctrlKey: true,
				bubbles: true,
				cancelable: true
			})
		);
		expect(timelineStore.zoomLevel).toBeCloseTo((770 / (300 * 4)) * 1.15);

		timelineStore._setZoomLevel(1);
		await nextAnimationFrame();
		expect(region!.scrollWidth).toBeGreaterThan(1_000);
		region!.scrollLeft = 200;
		expect(region!.scrollLeft).toBe(200);
		const firstWheel = new WheelEvent('wheel', {
			bubbles: true,
			cancelable: true,
			clientX: 500,
			ctrlKey: true,
			deltaY: -100
		});
		const secondWheel = new WheelEvent('wheel', {
			bubbles: true,
			cancelable: true,
			clientX: 500,
			ctrlKey: true,
			deltaY: -100
		});
		region!.dispatchEvent(firstWheel);
		region!.dispatchEvent(secondWheel);
		expect(firstWheel.defaultPrevented).toBe(true);
		expect(timelineStore.zoomLevel).toBe(1);
		expect(region!.scrollLeft).toBe(200);
		await nextAnimationFrame();
		expect(timelineStore.zoomLevel).toBeCloseTo(1.15 * 1.15);
		await nextAnimationFrame();
		expect(region!.scrollLeft).toBeCloseTo(367.7, 0);

		region!.dispatchEvent(new PointerEvent('pointerleave', { bubbles: true }));
		timelineStore._setCurrentFrame(200);
		await screen.getByRole('button', { name: 'Zoom timeline to 100%' }).click();
		expect(timelineStore.zoomLevel).toBe(1);
		expect(region!.scrollLeft).toBe(390);

		window.dispatchEvent(
			new KeyboardEvent('keydown', {
				key: '\\',
				code: 'Backslash',
				bubbles: true,
				cancelable: true
			})
		);
		expect(timelineStore.zoomLevel).toBeCloseTo(770 / (300 * 4));
		expect(region!.scrollLeft).toBe(0);
	});

	it('uses a saved custom binding for timeline commands', async () => {
		await render(TimelinePanel, { onedit: vi.fn() });
		timelineStore._setZoomLevel(1);
		keyboardShortcuts.setBinding('ZOOM_IN', 'alt+8');

		window.dispatchEvent(
			new KeyboardEvent('keydown', {
				key: '8',
				code: 'Digit8',
				altKey: true,
				bubbles: true,
				cancelable: true
			})
		);

		expect(timelineStore.zoomLevel).toBeCloseTo(1.15);
	});

	it('switches edit tools and seeks visible edit points through saved bindings', async () => {
		const hiddenTrack = track('hidden-track', 'video', 2);
		hiddenTrack.visible = false;
		timelineStore._setTracks([...timelineStore.tracks, hiddenTrack]);
		timelineStore._setItems([
			...timelineStore.items,
			item({
				id: 'hidden-cut',
				trackId: hiddenTrack.id,
				from: 65,
				durationInFrames: 5
			})
		]);
		addMarker(75);
		const screen = await render(TimelinePanel, { onedit: vi.fn() });
		const key = (value: string, code: string, altKey = false, target: EventTarget = window) =>
			target.dispatchEvent(
				new KeyboardEvent('keydown', {
					key: value,
					code,
					altKey,
					bubbles: true,
					cancelable: true
				})
			);

		key('y', 'KeyY');
		await screen.getByRole('button', { name: 'More actions' }).first().click();
		await expect
			.element(screen.getByRole('menuitemcheckbox', { name: 'Slip clip source' }))
			.toHaveAttribute('aria-checked', 'true');
		await userEvent.keyboard('{Escape}');
		key('u', 'KeyU');
		await screen.getByRole('button', { name: 'More actions' }).first().click();
		await expect
			.element(
				screen.getByRole('menuitemcheckbox', {
					name: 'Slide clip between adjacent edits'
				})
			)
			.toHaveAttribute('aria-checked', 'true');
		await userEvent.keyboard('{Escape}');
		key('v', 'KeyV');
		await screen.getByRole('button', { name: 'More actions' }).first().click();
		await expect
			.element(
				screen.getByRole('menuitemcheckbox', {
					name: 'Slide clip between adjacent edits'
				})
			)
			.toHaveAttribute('aria-checked', 'false');
		await userEvent.keyboard('{Escape}');

		setCurrentFrame(61);
		key('ArrowDown', 'ArrowDown');
		expect(timelineStore.currentFrame).toBe(75);
		key('ArrowUp', 'ArrowUp');
		expect(timelineStore.currentFrame).toBe(60);

		keyboardShortcuts.setBinding('NEXT_SNAP_POINT', 'alt+8');
		key('ArrowDown', 'ArrowDown');
		expect(timelineStore.currentFrame).toBe(60);
		key('8', 'Digit8', true);
		expect(timelineStore.currentFrame).toBe(75);

		const input = document.createElement('input');
		screen.container.append(input);
		input.focus();
		key('y', 'KeyY', false, input);
		key('ArrowUp', 'ArrowUp', false, input);
		await screen.getByRole('button', { name: 'More actions' }).first().click();
		await expect
			.element(screen.getByRole('menuitemcheckbox', { name: 'Slip clip source' }))
			.toHaveAttribute('aria-checked', 'false');
		expect(timelineStore.currentFrame).toBe(75);
	});

	it('scrubs the ruler with pointer drag and precise keyboard steps', async () => {
		const screen = await render(TimelinePanel, { onedit: vi.fn() });
		const region = document.querySelector<HTMLElement>('[role="region"][aria-label="Timeline"]');
		expect(region).not.toBeNull();
		vi.spyOn(region!, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 900, 300));
		const ruler = screen.getByRole('slider', { name: 'Timeline playhead' });

		dispatchPointer(ruler.element(), 'pointerdown', 220);
		dispatchPointer(window, 'pointermove', 260);
		await nextAnimationFrame();
		dispatchPointer(window, 'pointerup', 260);
		expect(timelineStore.currentFrame).toBe(20);
		await expect.element(ruler).toHaveAttribute('aria-valuenow', '20');

		ruler
			.element()
			.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
		expect(timelineStore.currentFrame).toBe(21);
		ruler.element().dispatchEvent(
			new KeyboardEvent('keydown', {
				key: 'ArrowLeft',
				shiftKey: true,
				bubbles: true
			})
		);
		expect(timelineStore.currentFrame).toBe(11);
		ruler.element().dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
		expect(timelineStore.currentFrame).toBe(120);
	});

	it('previews the latest hovered frame without moving the committed playhead', async () => {
		await page.viewport(1200, 700);
		const screen = await render(TimelinePanel, { onedit: vi.fn() });
		screen.container.style.width = '900px';
		const region = screen.getByRole('region', { name: 'Timeline' }).element();
		region.style.width = '900px';
		vi.spyOn(region, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 900, 300));
		await page.screenshot({
			element: region,
			path: '../../../../.svelte-kit/openpost-timeline-hover-preview-before.png'
		});

		region.dispatchEvent(
			new PointerEvent('pointermove', {
				bubbles: true,
				buttons: 0,
				clientX: 220,
				clientY: 40,
				pointerType: 'mouse'
			})
		);
		region.dispatchEvent(
			new PointerEvent('pointermove', {
				bubbles: true,
				buttons: 0,
				clientX: 260,
				clientY: 40,
				pointerType: 'mouse'
			})
		);
		await nextAnimationFrame();

		expect(get(timelinePreviewScrub).frame).toBe(20);
		expect(timelineStore.currentFrame).toBe(0);
		await expect.element(screen.getByText('00:00:00:20')).toBeVisible();
		await page.screenshot({
			element: region,
			path: '../../../../.svelte-kit/openpost-timeline-hover-preview.png'
		});
		await page.viewport(320, 720);
		screen.container.style.width = '100vw';
		region.style.width = '100vw';
		await nextAnimationFrame();
		const timecode = screen.container.querySelector<HTMLElement>(
			'[data-timeline-preview-timecode]'
		);
		expect(timecode).not.toBeNull();
		const timecodeRect = timecode!.getBoundingClientRect();
		expect(timecodeRect.left).toBeGreaterThanOrEqual(0);
		expect(timecodeRect.right).toBeLessThanOrEqual(320);
		expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(
			document.documentElement.clientWidth
		);
		await page.screenshot({
			path: '../../../../.svelte-kit/openpost-timeline-hover-preview-320.png'
		});

		region.dispatchEvent(new PointerEvent('pointerleave', { bubbles: true }));
		expect(get(timelinePreviewScrub).frame).toBeNull();
		await vi.waitFor(() => {
			expect(screen.container.querySelector('[data-timeline-preview-scrubber]')).toBeNull();
		});

		region.dispatchEvent(
			new PointerEvent('pointermove', {
				bubbles: true,
				buttons: 0,
				clientX: 260,
				clientY: 40,
				pointerType: 'mouse'
			})
		);
		await nextAnimationFrame();
		expect(get(timelinePreviewScrub).frame).toBe(20);
		setCurrentFrame(5);
		expect(get(timelinePreviewScrub).frame).toBeNull();
		expect(timelineStore.currentFrame).toBe(5);
		setCurrentFrame(0);

		region.dispatchEvent(
			new PointerEvent('pointermove', {
				bubbles: true,
				buttons: 0,
				clientX: 260,
				clientY: 40,
				pointerType: 'mouse'
			})
		);
		await nextAnimationFrame();
		expect(get(timelinePreviewScrub).frame).toBe(20);
		try {
			editorSession.startPlayback();
			expect(get(timelinePreviewScrub).frame).toBeNull();
		} finally {
			editorSession.pausePlayback();
		}

		region.dispatchEvent(
			new PointerEvent('pointermove', {
				bubbles: true,
				buttons: 0,
				clientX: 260,
				clientY: 40,
				pointerType: 'touch'
			})
		);
		await nextAnimationFrame();
		expect(get(timelinePreviewScrub).frame).toBeNull();
	});

	it('resizes one track as one undoable pointer gesture', async () => {
		const onedit = vi.fn();
		const screen = await render(TimelinePanel, { onedit });
		const resize = screen.getByRole('slider', {
			name: 'Resize video-track track height'
		});

		dispatchPointer(resize.element(), 'pointerdown', 0, false, 100);
		dispatchPointer(window, 'pointermove', 0, false, 130);
		expect(timelineStore.tracks.find((candidate) => candidate.id === 'video-track')?.height).toBe(
			94
		);
		expect(onedit).not.toHaveBeenCalled();
		dispatchPointer(window, 'pointerup', 0, false, 130);
		expect(onedit).toHaveBeenCalledOnce();
		expect(commandHistory.getLastCommandType()).toBe('RESIZE_TRACK_HEIGHT');
		await expect.element(resize).toHaveAttribute('aria-valuenow', '94');

		commandHistory.undo();
		expect(timelineStore.tracks.find((candidate) => candidate.id === 'video-track')?.height).toBe(
			64
		);
	});

	it('supports resize-all, cancellation, keyboard bounds, and reset', async () => {
		const onedit = vi.fn();
		const screen = await render(TimelinePanel, { onedit });
		const audioResize = screen.getByRole('slider', {
			name: 'Resize audio-track track height'
		});

		dispatchPointer(audioResize.element(), 'pointerdown', 0, false, 100, true);
		dispatchPointer(window, 'pointermove', 0, false, 110);
		expect(timelineStore.tracks.map((candidate) => candidate.height)).toEqual([74, 74]);
		window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		expect(timelineStore.tracks.map((candidate) => candidate.height)).toEqual([64, 64]);
		expect(onedit).not.toHaveBeenCalled();

		audioResize.element().dispatchEvent(
			new KeyboardEvent('keydown', {
				key: 'End',
				altKey: true,
				bubbles: true
			})
		);
		expect(timelineStore.tracks.map((candidate) => candidate.height)).toEqual([140, 140]);
		const videoResize = screen.getByRole('slider', {
			name: 'Resize video-track track height'
		});
		videoResize
			.element()
			.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, altKey: true }));
		expect(timelineStore.tracks.map((candidate) => candidate.height)).toEqual([96, 72]);
		expect(onedit).toHaveBeenCalledTimes(2);
	});

	it('renders, selects, edits, and deletes project markers', async () => {
		timelineStore.setAll({
			markers: [{ id: 'marker-1', frame: 10, color: '#d97746' }]
		});
		const onedit = vi.fn();
		const screen = await render(TimelinePanel, { onedit });
		const marker = screen.getByRole('button', { name: 'Marker 1, Frame 10' });
		await marker.click();
		expect(timelineStore.selectedMarkerId).toBe('marker-1');
		expect(timelineStore.currentFrame).toBe(10);

		const label = screen.getByLabelText('Label');
		await label.fill('Beat drop');
		label.element().dispatchEvent(new FocusEvent('blur'));
		expect(timelineStore.markers[0]?.label).toBe('Beat drop');

		const frame = screen.getByRole('spinbutton', {
			name: 'Frame',
			exact: true
		});
		await frame.fill('33');
		frame.element().dispatchEvent(new Event('change', { bubbles: true }));
		expect(timelineStore.markers[0]?.frame).toBe(33);
		expect(timelineStore.currentFrame).toBe(33);

		await screen.getByRole('button', { name: 'Color', exact: true }).click();
		const color = document.querySelector<HTMLInputElement>('input[type="color"]');
		if (!(color instanceof HTMLInputElement)) throw new Error('Expected marker color input.');
		color.value = '#22c55e';
		color.dispatchEvent(new Event('change', { bubbles: true }));
		expect(timelineStore.markers[0]?.color).toBe('#22c55e');

		await screen.getByRole('button', { name: 'Color 2' }).click();
		expect(timelineStore.markers[0]?.color).toBe('#ef4444');
		await screen.getByRole('button', { name: 'Reset color' }).click();
		expect(timelineStore.markers[0]?.color).toBe('#d97746');

		await screen.getByRole('button', { name: 'Delete marker' }).click();
		expect(timelineStore.markers).toEqual([]);
		expect(timelineStore.selectedMarkerId).toBeNull();
		expect(onedit).toHaveBeenCalledTimes(6);
	});

	it('drags markers atomically and navigates to adjacent markers', async () => {
		timelineStore.setAll({
			markers: [
				{ id: 'first', frame: 10, color: '#d97746' },
				{ id: 'middle', frame: 40, color: '#3b82f6', label: 'Middle' },
				{ id: 'last', frame: 90, color: '#22c55e' }
			]
		});
		const onedit = vi.fn();
		const screen = await render(TimelinePanel, { onedit });
		const region = document.querySelector<HTMLElement>('[role="region"][aria-label="Timeline"]');
		expect(region).not.toBeNull();
		vi.spyOn(region!, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 900, 300));
		const first = screen.getByRole('button', { name: 'Marker 1, Frame 10' });

		dispatchPointer(first.element(), 'pointerdown', 220);
		dispatchPointer(window, 'pointermove', 260);
		dispatchPointer(window, 'pointerup', 260);
		expect(timelineStore.markers.find((marker) => marker.id === 'first')?.frame).toBe(20);
		expect(commandHistory.getLastCommandType()).toBe('MOVE_MARKER');
		expect(onedit).toHaveBeenCalledOnce();

		timelineStore._setCurrentFrame(50);
		await screen.getByRole('button', { name: 'More actions' }).first().click();
		screen.getByRole('menuitem', { name: 'Previous marker' }).element().click();
		expect(timelineStore.currentFrame).toBe(40);
		expect(timelineStore.selectedMarkerId).toBe('middle');
		await screen.getByRole('button', { name: 'More actions' }).first().click();
		screen.getByRole('menuitem', { name: 'Next marker' }).element().click();
		expect(timelineStore.currentFrame).toBe(90);

		const last = screen.getByRole('button', { name: 'Marker 3, Frame 90' });
		last.element().dispatchEvent(
			new KeyboardEvent('keydown', {
				key: 'ArrowLeft',
				shiftKey: true,
				bubbles: true
			})
		);
		expect(timelineStore.markers.find((marker) => marker.id === 'last')?.frame).toBe(80);
		await nextAnimationFrame();

		const movedLast = screen.getByRole('button', {
			name: 'Marker 3, Frame 80'
		});
		dispatchPointer(movedLast.element(), 'pointerdown', 500);
		dispatchPointer(window, 'pointermove', 300);
		expect(timelineStore.markers.find((marker) => marker.id === 'last')?.frame).toBe(30);
		window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		expect(timelineStore.markers.find((marker) => marker.id === 'last')?.frame).toBe(80);
		expect(onedit).toHaveBeenCalledTimes(2);
	});

	it('joins selected split siblings from the toolbar and Shift+J', async () => {
		const left = item({
			id: 'left',
			originId: 'origin',
			mediaId: 'media',
			durationInFrames: 30,
			sourceEnd: 30
		});
		const right = item({
			id: 'right',
			originId: 'origin',
			mediaId: 'media',
			from: 30,
			durationInFrames: 30,
			sourceStart: 30,
			sourceEnd: 60
		});
		timelineStore._setItems([left, right]);
		const onedit = vi.fn();
		const screen = await render(TimelinePanel, {
			onedit,
			selectedItemId: 'right',
			selectedItemIds: ['left', 'right']
		});
		await screen.getByRole('button', { name: 'More actions' }).last().click();
		const join = screen.getByRole('menuitem', { name: 'Join selected clips' });
		await expect.element(join).toBeEnabled();
		join.element().click();
		expect(timelineStore.items).toHaveLength(1);
		expect(timelineStore.items[0]).toMatchObject({
			id: 'left',
			durationInFrames: 60,
			sourceStart: 0,
			sourceEnd: 60
		});
		expect(onedit).toHaveBeenCalledOnce();
		expect(commandHistory.getLastCommandType()).toBe('JOIN_ITEMS');

		commandHistory.undo();
		expect(timelineStore.items).toHaveLength(2);
	});

	it('joins selected split siblings with Shift+J', async () => {
		timelineStore._setItems([
			item({
				id: 'left',
				originId: 'origin',
				mediaId: 'media',
				durationInFrames: 30,
				sourceEnd: 30
			}),
			item({
				id: 'right',
				originId: 'origin',
				mediaId: 'media',
				from: 30,
				durationInFrames: 30,
				sourceStart: 30,
				sourceEnd: 60
			})
		]);
		const onedit = vi.fn();
		await render(TimelinePanel, {
			onedit,
			selectedItemId: 'right',
			selectedItemIds: ['left', 'right']
		});
		window.dispatchEvent(new KeyboardEvent('keydown', { key: 'J', shiftKey: true, bubbles: true }));
		expect(timelineStore.items).toHaveLength(1);
		expect(onedit).toHaveBeenCalledOnce();
	});

	it('previews and inserts a dragged scene at the exact pointer frame', async () => {
		const onedit = vi.fn();
		await render(TimelinePanel, { onedit });
		const videoTrack = document.querySelector<HTMLElement>('[data-track="video-track"]');
		expect(videoTrack).not.toBeNull();
		const scene = {
			id: 'scene-media:0',
			mediaId: sceneMedia.id,
			index: 0,
			startSec: 1,
			endSec: 3.5,
			timeSec: 1.2,
			text: 'A cook plates pasta'
		};
		const payload = { type: 'timeline-scene' as const, scene };
		setSceneDragData(payload);
		const dataTransfer = new DataTransfer();
		dataTransfer.setData('application/json', JSON.stringify(payload));
		const trackRect = videoTrack!.getBoundingClientRect();
		const clientX = trackRect.left + 180 + 100 * 4;

		videoTrack!.dispatchEvent(new DragEvent('dragover', { bubbles: true, clientX, dataTransfer }));
		await nextAnimationFrame();
		expect(document.querySelector('[data-scene-drop-preview]')).not.toBeNull();

		videoTrack!.dispatchEvent(new DragEvent('drop', { bubbles: true, clientX, dataTransfer }));
		await nextAnimationFrame();
		const inserted = timelineStore.items.find((candidate) => candidate.mediaId === sceneMedia.id);
		expect(inserted).toMatchObject({
			trackId: 'video-track',
			from: 100,
			durationInFrames: 75,
			sourceStart: 24,
			sourceEnd: 84,
			sourceFps: 24
		});
		expect(document.querySelector('[data-scene-drop-preview]')).toBeNull();
		expect(onedit).toHaveBeenCalledOnce();
	});

	it('previews and applies a dropped effect to compatible selected clips', async () => {
		timelineStore._setTracks([
			track('video-track', 'video', 0),
			track('audio-track', 'audio', 1),
			{ ...track('locked-track', 'video', 2), locked: true }
		]);
		timelineStore._setItems([
			item({}),
			item({
				id: 'title',
				label: 'Title',
				type: 'text',
				from: 70,
				sourceStart: undefined,
				sourceEnd: undefined
			}),
			item({
				id: 'locked-video',
				trackId: 'locked-track',
				label: 'Locked video',
				from: 140
			}),
			item({
				id: 'music-bed',
				trackId: 'audio-track',
				label: 'Music',
				type: 'audio',
				durationInFrames: 120,
				sourceEnd: 120
			})
		]);
		const onedit = vi.fn();
		const screen = await render(TimelinePanel, {
			onedit,
			selectedItemId: 'video',
			selectedItemIds: ['video', 'title', 'music-bed', 'locked-video']
		});
		const videoClip = screen.getByRole('button', { name: /^Video\./ }).element().parentElement!;
		const titleClip = screen.getByRole('button', { name: /^Title\./ }).element().parentElement!;
		const musicClip = screen.getByRole('button', { name: /^Music\./ }).element().parentElement!;
		const lockedClip = screen
			.getByRole('button', { name: /^Locked video\./ })
			.element().parentElement!;
		const payload = {
			type: 'timeline-effect' as const,
			label: 'Brightness',
			effects: [{ kind: 'css' as const, effectType: 'brightness' as const }]
		};
		setEffectDragData(payload);
		const dataTransfer = new DataTransfer();
		dataTransfer.setData('application/json', JSON.stringify(payload));

		videoClip.dispatchEvent(
			new DragEvent('dragover', {
				bubbles: true,
				clientX: 100,
				clientY: 100,
				dataTransfer
			})
		);
		await nextAnimationFrame();
		const videoPreview = videoClip.querySelector<HTMLElement>('[data-effect-drop-preview]');
		expect(videoPreview).not.toBeNull();
		expect(titleClip.querySelector('[data-effect-drop-preview]')).not.toBeNull();
		expect(musicClip.querySelector('[data-effect-drop-preview]')).toBeNull();
		expect(lockedClip.querySelector('[data-effect-drop-preview]')).toBeNull();
		expect(videoClip.textContent).toContain('2 clips');

		videoClip.dispatchEvent(
			new DragEvent('drop', {
				bubbles: true,
				clientX: 100,
				clientY: 100,
				dataTransfer
			})
		);
		await nextAnimationFrame();
		expect(timelineStore.itemById.get('video')?.effects).toEqual([
			expect.objectContaining({
				type: 'brightness',
				amount: 1.2,
				enabled: true
			})
		]);
		expect(timelineStore.itemById.get('title')?.effects).toEqual([
			expect.objectContaining({
				type: 'brightness',
				amount: 1.2,
				enabled: true
			})
		]);
		expect(timelineStore.itemById.get('music-bed')?.effects).toBeUndefined();
		expect(timelineStore.itemById.get('locked-video')?.effects).toBeUndefined();
		expect(document.querySelector('[data-effect-drop-preview]')).toBeNull();
		expect(commandHistory.getLastCommandType()).toBe('ADD_EFFECTS');
		expect(onedit).toHaveBeenCalledOnce();
	});

	it('creates a timed adjustment layer when an effect is dropped on empty timeline space', async () => {
		const onedit = vi.fn();
		await render(TimelinePanel, { onedit });
		const videoTrack = document.querySelector<HTMLElement>('[data-track="video-track"]');
		expect(videoTrack).not.toBeNull();
		const payload = {
			type: 'timeline-effect' as const,
			label: 'Brightness',
			effects: [{ kind: 'css' as const, effectType: 'brightness' as const }]
		};
		setEffectDragData(payload);
		const dataTransfer = new DataTransfer();
		const trackRect = videoTrack!.getBoundingClientRect();
		const clientX = trackRect.left + 180 + 100 * 4;

		videoTrack!.dispatchEvent(new DragEvent('dragover', { bubbles: true, clientX, dataTransfer }));
		await nextAnimationFrame();
		expect(document.querySelector('[data-effect-adjustment-drop-preview]')).not.toBeNull();

		videoTrack!.dispatchEvent(new DragEvent('drop', { bubbles: true, clientX, dataTransfer }));
		await nextAnimationFrame();
		const adjustment = timelineStore.items.find((candidate) => candidate.type === 'adjustment');
		expect(adjustment).toMatchObject({
			trackId: 'video-track',
			from: 100,
			durationInFrames: 90,
			label: 'Brightness',
			effects: [expect.objectContaining({ type: 'brightness', enabled: true })]
		});
		expect(commandHistory.getLastCommandType()).toBe('ADD_ADJUSTMENT_LAYER_WITH_EFFECTS');
		expect(commandHistory.undoStack).toHaveLength(1);
		expect(onedit).toHaveBeenCalledOnce();
	});

	it('marquee-selects every clip intersecting a background drag', async () => {
		const screen = await render(TimelinePanel, { onedit: vi.fn() });
		const videoClip = screen.getByRole('button', { name: /^Video\./ }).element().parentElement!;
		const musicClip = screen.getByRole('button', { name: /^Music\./ }).element().parentElement!;
		const videoTrack = document.querySelector<HTMLElement>('[data-track="video-track"]');
		expect(videoTrack).not.toBeNull();
		const videoRect = videoClip.getBoundingClientRect();
		const musicRect = musicClip.getBoundingClientRect();

		dispatchPointer(
			videoTrack!,
			'pointerdown',
			Math.max(videoRect.right, musicRect.right) + 20,
			false,
			videoRect.top + videoRect.height / 2
		);
		window.dispatchEvent(
			new PointerEvent('pointermove', {
				bubbles: true,
				buttons: 1,
				clientX: Math.min(videoRect.left, musicRect.left) - 5,
				clientY: musicRect.top + musicRect.height / 2,
				pointerId: 7
			})
		);
		await nextAnimationFrame();
		expect(document.querySelector('[data-timeline-marquee]')).not.toBeNull();
		dispatchPointer(window, 'pointerup', Math.min(videoRect.left, musicRect.left) - 5);
		await nextAnimationFrame();

		await expect.element(screen.getByText('2 clips selected')).toBeVisible();
		expect(document.querySelector('[data-timeline-marquee]')).toBeNull();
	});

	it('previews every touched track and commits the split as one undo entry', async () => {
		const onedit = vi.fn();
		const screen = await render(TimelinePanel, { onedit });
		const videoButton = screen.getByRole('button', { name: /^Video\./ }).element();
		const videoClip = videoButton.parentElement;
		const trimEnd = videoClip?.querySelector<HTMLButtonElement>(
			'button[aria-label="Trim clip end"]'
		);
		expect(trimEnd).not.toBeNull();

		dispatchPointer(trimEnd!, 'pointerdown', 400, true);
		dispatchPointer(window, 'pointermove', 360);
		await nextAnimationFrame();

		const musicClip = screen.getByRole('button', { name: /^Music\./ }).element().parentElement;
		expect(musicClip?.style.width).toBe('440px');
		expect(timelineStore.itemById.get('music-bed')?.durationInFrames).toBe(120);

		dispatchPointer(window, 'pointerup', 360);
		await nextAnimationFrame();

		expect(timelineStore.itemById.get('video')).toMatchObject({
			durationInFrames: 50
		});
		expect(
			timelineStore.items
				.filter((candidate) => candidate.trackId === 'audio-track')
				.sort((left, right) => left.from - right.from)
				.map(({ from, durationInFrames, sourceStart, sourceEnd }) => ({
					from,
					durationInFrames,
					sourceStart,
					sourceEnd
				}))
		).toEqual([
			{ from: 0, durationInFrames: 50, sourceStart: 0, sourceEnd: 50 },
			{ from: 50, durationInFrames: 60, sourceStart: 60, sourceEnd: 120 }
		]);
		expect(commandHistory.undoStack).toHaveLength(1);
		expect(commandHistory.getLastCommandType()).toBe('RIPPLE_EDIT');
		expect(onedit).toHaveBeenCalledOnce();

		commandHistory.undo();
		expect(timelineStore.itemById.get('video')).toMatchObject({
			durationInFrames: 60
		});
		expect(timelineStore.items.filter((candidate) => candidate.trackId === 'audio-track')).toEqual([
			expect.objectContaining({
				id: 'music-bed',
				from: 0,
				durationInFrames: 120
			})
		]);
	});

	it('returns to a normal trim when Shift is released during the drag', async () => {
		const screen = await render(TimelinePanel, { onedit: vi.fn() });
		const videoClip = screen.getByRole('button', { name: /^Video\./ }).element().parentElement;
		const trimEnd = videoClip?.querySelector<HTMLButtonElement>(
			'button[aria-label="Trim clip end"]'
		);
		expect(trimEnd).not.toBeNull();

		dispatchPointer(trimEnd!, 'pointerdown', 400, true);
		dispatchPointer(window, 'pointermove', 360);
		await nextAnimationFrame();
		window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Shift', bubbles: true }));
		await nextAnimationFrame();

		const musicClip = screen.getByRole('button', { name: /^Music\./ }).element().parentElement;
		expect(musicClip?.style.width).toBe('480px');
		dispatchPointer(window, 'pointerup', 360);
		await nextAnimationFrame();

		expect(timelineStore.itemById.get('video')).toMatchObject({
			durationInFrames: 50
		});
		expect(timelineStore.itemById.get('music-bed')).toMatchObject({
			from: 0,
			durationInFrames: 120
		});
		expect(commandHistory.undoStack).toHaveLength(1);
		expect(commandHistory.getLastCommandType()).toBe('TRIM_ITEM_END');
	});

	it('restores the whole ripple preview on Escape without adding history', async () => {
		const screen = await render(TimelinePanel, { onedit: vi.fn() });
		const videoClip = screen.getByRole('button', { name: /^Video\./ }).element().parentElement;
		const trimEnd = videoClip?.querySelector<HTMLButtonElement>(
			'button[aria-label="Trim clip end"]'
		);
		expect(trimEnd).not.toBeNull();

		dispatchPointer(trimEnd!, 'pointerdown', 400, true);
		dispatchPointer(window, 'pointermove', 360);
		await nextAnimationFrame();
		window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		await nextAnimationFrame();

		expect(timelineStore.itemById.get('video')).toMatchObject({
			durationInFrames: 60
		});
		expect(timelineStore.items.filter((candidate) => candidate.trackId === 'audio-track')).toEqual([
			expect.objectContaining({
				id: 'music-bed',
				from: 0,
				durationInFrames: 120
			})
		]);
		expect(commandHistory.undoStack).toHaveLength(0);
	});

	it('hides and removes a transition when its clip edge is trimmed directly', async () => {
		timelineStore._setItems([
			item({}),
			item({
				id: 'next-video',
				from: 60,
				label: 'Next video',
				sourceStart: 10,
				sourceEnd: 70
			}),
			item({
				id: 'music-bed',
				trackId: 'audio-track',
				label: 'Music',
				type: 'audio',
				durationInFrames: 120,
				sourceEnd: 120
			})
		]);
		transitionsStore.setAll([
			{
				id: 'transition',
				type: 'crossfade',
				durationInFrames: 10,
				fromItemId: 'video',
				toItemId: 'next-video'
			}
		]);
		const ontransitionbreak = vi.fn();
		const screen = await render(TimelinePanel, {
			onedit: vi.fn(),
			ontransitionbreak
		});
		const videoClip = screen.getByRole('button', { name: /^Video\./ }).element().parentElement;
		const trimEnd = videoClip?.querySelector<HTMLButtonElement>(
			'button[aria-label="Trim clip end"]'
		);
		expect(trimEnd).not.toBeNull();
		expect(document.querySelector('[data-transition-id="transition"]')).not.toBeNull();
		dispatchPointer(trimEnd!, 'pointerdown', 400);
		dispatchPointer(window, 'pointerup', 400);
		await nextAnimationFrame();
		expect(transitionsStore.list).toHaveLength(1);
		expect(ontransitionbreak).not.toHaveBeenCalled();
		expect(commandHistory.undoStack).toHaveLength(0);

		dispatchPointer(trimEnd!, 'pointerdown', 400);
		dispatchPointer(window, 'pointermove', 360);
		await nextAnimationFrame();
		expect(document.querySelector('[data-transition-id="transition"]')).toBeNull();

		dispatchPointer(window, 'pointerup', 360);
		await nextAnimationFrame();
		expect(timelineStore.itemById.get('video')).toMatchObject({
			durationInFrames: 50
		});
		expect(transitionsStore.list).toEqual([]);
		expect(ontransitionbreak).toHaveBeenCalledOnce();
		expect(ontransitionbreak).toHaveBeenCalledWith(1);
		expect(commandHistory.getLastCommandType()).toBe('TRIM_ITEM_END');

		commandHistory.undo();
		expect(timelineStore.itemById.get('video')).toMatchObject({
			durationInFrames: 60
		});
		expect(transitionsStore.list).toEqual([
			expect.objectContaining({
				id: 'transition',
				fromItemId: 'video',
				toItemId: 'next-video'
			})
		]);
	});

	it('selects and resizes a transition as one undoable pointer edit', async () => {
		timelineStore._setItems([
			item({}),
			item({
				id: 'next-video',
				from: 60,
				label: 'Next video',
				sourceStart: 10,
				sourceEnd: 70
			})
		]);
		transitionsStore.setAll([
			{
				id: 'transition',
				type: 'crossfade',
				durationInFrames: 10,
				fromItemId: 'video',
				toItemId: 'next-video'
			}
		]);
		const onedit = vi.fn();
		const screen = await render(TimelinePanel, {
			onedit,
			selectedItemId: 'video',
			selectedItemIds: ['video']
		});
		const transition = document.querySelector<HTMLElement>('[data-transition-id="transition"]');
		expect(transition).not.toBeNull();
		transition
			?.querySelector<HTMLButtonElement>('button[aria-label="Transition"]')
			?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
		await nextAnimationFrame();

		const resizeEnd = screen.getByRole('button', { name: 'Resize transition end' }).element();
		dispatchPointer(resizeEnd, 'pointerdown', 300);
		dispatchPointer(window, 'pointermove', 320);
		await nextAnimationFrame();
		expect(transitionsStore.list[0]?.durationInFrames).toBe(10);
		expect(transition?.style.width).toBe('60px');

		dispatchPointer(window, 'pointerup', 320);
		await nextAnimationFrame();
		expect(transitionsStore.list[0]?.durationInFrames).toBe(15);
		expect(commandHistory.getLastCommandType()).toBe('UPDATE_TRANSITION');
		expect(commandHistory.undoStack).toHaveLength(1);
		expect(onedit).toHaveBeenCalledOnce();

		commandHistory.undo();
		expect(transitionsStore.list[0]?.durationInFrames).toBe(10);
	});

	it('replaces an existing transition when a catalog card is dropped on its bridge', async () => {
		timelineStore._setItems([
			item({}),
			item({
				id: 'next-video',
				from: 60,
				label: 'Next video',
				sourceStart: 20,
				sourceEnd: 80
			})
		]);
		transitionsStore.setAll([
			{
				id: 'transition',
				type: 'crossfade',
				durationInFrames: 10,
				fromItemId: 'video',
				toItemId: 'next-video'
			}
		]);
		const onedit = vi.fn();
		await render(TimelinePanel, { onedit });
		const bridge = document.querySelector<HTMLElement>('[data-transition-id="transition"]');
		expect(bridge).not.toBeNull();
		setTransitionDragData({ presentation: 'wipe', direction: 'from-left', label: 'Slide' });
		const dataTransfer = new DataTransfer();

		bridge!.dispatchEvent(new DragEvent('dragover', { bubbles: true, dataTransfer }));
		await nextAnimationFrame();
		expect(document.querySelector('[data-transition-bridge-drop-preview]')).not.toBeNull();

		bridge!.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer }));
		await nextAnimationFrame();
		expect(transitionsStore.list[0]).toMatchObject({
			id: 'transition',
			presentation: 'wipe',
			direction: 'from-left'
		});
		expect(document.querySelector('[data-transition-bridge-drop-preview]')).toBeNull();
		expect(commandHistory.getLastCommandType()).toBe('UPDATE_TRANSITION');
		expect(onedit).toHaveBeenCalledOnce();
	});

	it('cancels a transition resize on Escape without saving or history', async () => {
		timelineStore._setItems([
			item({}),
			item({
				id: 'next-video',
				from: 60,
				label: 'Next video',
				sourceStart: 10,
				sourceEnd: 70
			})
		]);
		transitionsStore.setAll([
			{
				id: 'transition',
				type: 'crossfade',
				durationInFrames: 10,
				fromItemId: 'video',
				toItemId: 'next-video'
			}
		]);
		const onedit = vi.fn();
		const screen = await render(TimelinePanel, { onedit });
		const resizeStart = screen.getByRole('button', { name: 'Resize transition start' }).element();
		dispatchPointer(resizeStart, 'pointerdown', 300);
		dispatchPointer(window, 'pointermove', 280);
		await nextAnimationFrame();
		expect(
			document.querySelector<HTMLElement>('[data-transition-id="transition"]')?.style.width
		).toBe('60px');
		window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		await nextAnimationFrame();

		expect(transitionsStore.list[0]?.durationInFrames).toBe(10);
		expect(commandHistory.undoStack).toHaveLength(0);
		expect(onedit).not.toHaveBeenCalled();
	});

	it('resizes a selected transition by frame from the keyboard', async () => {
		timelineStore._setItems([
			item({}),
			item({
				id: 'next-video',
				from: 60,
				label: 'Next video',
				sourceStart: 20,
				sourceEnd: 80
			})
		]);
		transitionsStore.setAll([
			{
				id: 'transition',
				type: 'crossfade',
				durationInFrames: 10,
				fromItemId: 'video',
				toItemId: 'next-video'
			}
		]);
		const onedit = vi.fn();
		const screen = await render(TimelinePanel, { onedit });
		const resizeEnd = screen.getByRole('button', { name: 'Resize transition end' }).element();
		resizeEnd.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
		expect(transitionsStore.list[0]?.durationInFrames).toBe(11);
		resizeEnd.dispatchEvent(
			new KeyboardEvent('keydown', {
				key: 'ArrowRight',
				shiftKey: true,
				bubbles: true
			})
		);
		expect(transitionsStore.list[0]?.durationInFrames).toBe(21);
		expect(onedit).toHaveBeenCalledTimes(2);
	});
});

describe('TimelinePanel exact media placement', () => {
	it('places from the keyboard on the shown track and frame as one undo step', async () => {
		timelineStore._setItems([]);
		setCurrentFrame(45);
		const onedit = vi.fn();
		const screen = await render(TimelinePanel, { onedit });

		mediaPlacement.begin(mediaDragData('media', sceneMedia.id, sceneMedia.fileName));
		await expect.element(screen.getByText(/Enter to place\. Arrow keys move/)).toBeVisible();
		const ghost = document.querySelector<HTMLElement>('[data-media-drop-preview]');
		expect(ghost?.closest('[data-track]')?.getAttribute('data-track')).toBe('video-track');
		expect(ghost?.style.left).toBe('360px');

		window.dispatchEvent(
			new KeyboardEvent('keydown', {
				key: 'ArrowRight',
				shiftKey: true,
				bubbles: true
			})
		);
		window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

		expect(timelineStore.items).toHaveLength(1);
		expect(timelineStore.items[0]).toMatchObject({
			trackId: 'video-track',
			from: 55,
			durationInFrames: 240,
			mediaId: sceneMedia.id
		});
		expect(commandHistory.undoStack).toHaveLength(1);
		expect(onedit).toHaveBeenCalledOnce();
		expect(mediaPlacement.request).toBeNull();

		mediaPlacement.begin(mediaDragData('media', sceneMedia.id, sceneMedia.fileName));
		await vi.waitFor(() => {
			expect(document.querySelector('[data-media-drop-preview]')).not.toBeNull();
		});
		window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		expect(mediaPlacement.request).toBeNull();
	});

	it('keeps an occupied exact position rejected without mutating the timeline', async () => {
		setCurrentFrame(15);
		const onedit = vi.fn();
		const screen = await render(TimelinePanel, { onedit });
		commandHistory.clearHistory();

		mediaPlacement.begin(mediaDragData('media', sceneMedia.id, sceneMedia.fileName));
		await expect.element(screen.getByText(/This position is unavailable/)).toBeVisible();
		const ghost = document.querySelector<HTMLElement>('[data-media-drop-preview]');
		expect(ghost?.dataset.valid).toBe('false');
		expect(ghost?.dataset.reason).toBe('collision');
		window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

		expect(timelineStore.items.map((candidate) => candidate.id)).toEqual(['video', 'music-bed']);
		expect(commandHistory.canUndo).toBe(false);
		expect(onedit).not.toHaveBeenCalled();
		expect(mediaPlacement.request).not.toBeNull();
	});

	it('uses only the custom drag payload and drops at the ghosted row and frame', async () => {
		timelineStore._setItems([]);
		timelineStore._setSnapEnabled(false);
		const onedit = vi.fn();
		await render(TimelinePanel, { onedit });
		const row = document.querySelector<HTMLElement>('[data-track="video-track"]');
		expect(row).not.toBeNull();
		const foreignTransfer = new DataTransfer();
		foreignTransfer.setData(
			'application/json',
			JSON.stringify(mediaDragData('media', sceneMedia.id, sceneMedia.fileName))
		);
		row!.dispatchEvent(
			new DragEvent('dragover', {
				bubbles: true,
				cancelable: true,
				clientX: row!.getBoundingClientRect().left + 220,
				dataTransfer: foreignTransfer
			})
		);
		await nextAnimationFrame();
		expect(document.querySelector('[data-media-drop-preview]')).toBeNull();

		const dataTransfer = new DataTransfer();
		writeMediaDragData(dataTransfer, mediaDragData('media', sceneMedia.id, sceneMedia.fileName));
		const clientX = row!.getBoundingClientRect().left + 220;
		row!.dispatchEvent(
			new DragEvent('dragover', {
				bubbles: true,
				cancelable: true,
				clientX,
				dataTransfer
			})
		);
		await nextAnimationFrame();
		const ghost = document.querySelector<HTMLElement>('[data-media-drop-preview]');
		expect(ghost?.dataset.valid).toBe('true');
		expect(ghost?.style.left).toBe('220px');

		row!.dispatchEvent(
			new DragEvent('drop', {
				bubbles: true,
				cancelable: true,
				clientX,
				dataTransfer
			})
		);
		expect(timelineStore.items[0]).toMatchObject({
			trackId: 'video-track',
			from: 10,
			mediaId: sceneMedia.id
		});
		expect(onedit).toHaveBeenCalledOnce();
		expect(commandHistory.undoStack).toHaveLength(1);
	});

	it('drops a text recipe on the pointed open track and frame as one edit', async () => {
		timelineStore._setItems([]);
		timelineStore._setSnapEnabled(false);
		const onedit = vi.fn();
		await render(TimelinePanel, { onedit });
		const row = document.querySelector<HTMLElement>('[data-track="video-track"]');
		expect(row).not.toBeNull();
		const dataTransfer = new DataTransfer();
		writeGeneratedItemDragData(
			dataTransfer,
			textGeneratedItemDragData('Breaking', 'breaking-update')
		);
		const clientX = row!.getBoundingClientRect().left + 220;
		row!.dispatchEvent(
			new DragEvent('dragover', {
				bubbles: true,
				cancelable: true,
				clientX,
				dataTransfer
			})
		);
		await vi.waitFor(() => {
			expect(document.querySelector('[data-generated-item-drop-preview]')).not.toBeNull();
		});
		const ghost = document.querySelector<HTMLElement>('[data-generated-item-drop-preview]');
		expect(ghost?.closest('[data-track]')?.getAttribute('data-track')).toBe('video-track');
		expect(ghost?.style.left).toBe('220px');

		row!.dispatchEvent(
			new DragEvent('drop', {
				bubbles: true,
				cancelable: true,
				clientX,
				dataTransfer
			})
		);
		expect(timelineStore.items).toHaveLength(1);
		expect(timelineStore.items[0]).toMatchObject({
			trackId: 'video-track',
			from: 10,
			type: 'text',
			textStylePresetId: 'breaking-update'
		});
		expect(commandHistory.undoStack).toHaveLength(1);
		expect(onedit).toHaveBeenCalledOnce();
	});

	it('drops a shape recipe on the pointed open track and frame as one edit', async () => {
		timelineStore._setItems([]);
		timelineStore._setSnapEnabled(false);
		const onedit = vi.fn();
		await render(TimelinePanel, { onedit });
		const row = document.querySelector<HTMLElement>('[data-track="video-track"]');
		expect(row).not.toBeNull();
		const dataTransfer = new DataTransfer();
		writeGeneratedItemDragData(
			dataTransfer,
			shapeGeneratedItemDragData('Gradient', 'rectangle', {
				fillType: 'linear',
				gradientStartColor: '#f97316',
				gradientEndColor: '#6366f1',
				sizeMode: 'canvas'
			})
		);
		const clientX = row!.getBoundingClientRect().left + 260;
		row!.dispatchEvent(
			new DragEvent('dragover', { bubbles: true, cancelable: true, clientX, dataTransfer })
		);
		await vi.waitFor(() => {
			expect(document.querySelector('[data-generated-item-drop-preview]')).not.toBeNull();
		});

		row!.dispatchEvent(
			new DragEvent('drop', { bubbles: true, cancelable: true, clientX, dataTransfer })
		);
		expect(timelineStore.items).toHaveLength(1);
		expect(timelineStore.items[0]).toMatchObject({
			trackId: 'video-track',
			from: 20,
			type: 'shape',
			shapeType: 'rectangle',
			fillType: 'linear',
			transform: expect.objectContaining({ width: 1920, height: 1080 })
		});
		expect(commandHistory.undoStack).toHaveLength(1);
		expect(onedit).toHaveBeenCalledOnce();
	});

	it('auto-scrolls the timeline while a media drag stays at an edge', async () => {
		await page.viewport(320, 720);
		timelineStore._setItems([]);
		timelineStore._setSnapEnabled(false);
		await render(TimelinePanel, { onedit: vi.fn() });
		const row = document.querySelector<HTMLElement>('[data-track="video-track"]');
		const surface = document.querySelector<HTMLElement>('[data-media-placement-surface]');
		expect(row).not.toBeNull();
		expect(surface).not.toBeNull();
		const dataTransfer = new DataTransfer();
		writeMediaDragData(dataTransfer, mediaDragData('media', sceneMedia.id, sceneMedia.fileName));
		row!.dispatchEvent(
			new DragEvent('dragover', {
				bubbles: true,
				cancelable: true,
				clientX: surface!.getBoundingClientRect().right - 1,
				dataTransfer
			})
		);
		await nextAnimationFrame();
		await nextAnimationFrame();
		await nextAnimationFrame();
		expect(surface!.scrollLeft).toBeGreaterThan(0);
		window.dispatchEvent(new DragEvent('dragend', { bubbles: true }));
		await nextAnimationFrame();
		expect(document.querySelector('[data-media-drop-preview]')).toBeNull();
	});

	it('places by touch without causing page overflow at 320 px', async () => {
		await page.viewport(320, 720);
		timelineStore._setItems([]);
		timelineStore._setSnapEnabled(false);
		const onedit = vi.fn();
		await render(TimelinePanel, { onedit });
		mediaPlacement.begin(mediaDragData('media', sceneMedia.id, sceneMedia.fileName));
		await vi.waitFor(() => {
			expect(document.querySelector('[data-media-drop-preview]')).not.toBeNull();
		});
		expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(
			document.documentElement.clientWidth
		);
		await page.screenshot({
			path: '../../../../.svelte-kit/openpost-media-placement-320.png'
		});

		const row = document.querySelector<HTMLElement>('[data-track="video-track"]');
		expect(row).not.toBeNull();
		row!.dispatchEvent(
			new PointerEvent('pointerdown', {
				bubbles: true,
				cancelable: true,
				button: 0,
				buttons: 1,
				clientX: row!.getBoundingClientRect().left + 220,
				pointerId: 12,
				pointerType: 'touch'
			})
		);

		expect(timelineStore.items[0]).toMatchObject({
			trackId: 'video-track',
			from: 10,
			mediaId: sceneMedia.id
		});
		expect(onedit).toHaveBeenCalledOnce();
	});

	it('previews and commits both exact rows for a sequence with video audio', async () => {
		timelineStore._setItems([]);
		sequenceStore.addComposition(
			{
				id: 'nested-sequence',
				name: 'Nested sequence',
				items: [
					{
						id: 'inside-video',
						trackId: 'inside-video-track',
						from: 0,
						durationInFrames: 60,
						label: 'Inside video',
						type: 'video'
					}
				],
				tracks: [track('inside-video-track', 'video', 0)],
				transitions: [],
				fps: 30,
				width: 1920,
				height: 1080,
				durationInFrames: 60
			},
			true
		);
		setCurrentFrame(30);
		const onedit = vi.fn();
		await render(TimelinePanel, { onedit });

		mediaPlacement.begin(mediaDragData('composition', 'nested-sequence', 'Nested sequence'));
		await vi.waitFor(() => {
			expect(document.querySelectorAll('[data-media-drop-preview]')).toHaveLength(2);
		});
		const ghosts = [...document.querySelectorAll<HTMLElement>('[data-media-drop-preview]')];
		expect(ghosts.every((ghost) => ghost.dataset.valid === 'true')).toBe(true);
		expect(ghosts.filter((ghost) => ghost.dataset.secondary === 'true')).toHaveLength(1);

		window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
		expect(timelineStore.items).toHaveLength(2);
		expect(timelineStore.items.map((candidate) => candidate.trackId).sort()).toEqual([
			'audio-track',
			'video-track'
		]);
		expect(new Set(timelineStore.items.map((candidate) => candidate.linkedGroupId)).size).toBe(1);
		expect(commandHistory.undoStack).toHaveLength(1);
		expect(onedit).toHaveBeenCalledOnce();
	});
});

describe('TimelinePanel track groups', () => {
	it('groups selected track names and collapses only their timeline rows', async () => {
		const onedit = vi.fn();
		const screen = await render(TimelinePanel, { onedit });
		const videoName = screen.getByRole('button', { name: 'video-track' }).element();
		const audioName = screen.getByRole('button', { name: 'audio-track' }).element();
		videoName.dispatchEvent(new MouseEvent('click', { bubbles: true }));
		audioName.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }));

		await screen.getByRole('button', { name: 'More actions' }).first().click();
		screen.getByRole('menuitem', { name: 'Group selected tracks' }).element().click();
		expect(timelineStore.tracks.filter((track) => track.isGroup)).toHaveLength(1);
		expect(timelineStore.tracks.filter((track) => track.parentTrackId)).toHaveLength(2);
		await expect.element(screen.getByText('Track group 1')).toBeVisible();
		const groupRow = document.querySelector<HTMLElement>(
			'[data-track][aria-label="Track group 1"]'
		)!;
		const groupHeader = groupRow.querySelector<HTMLElement>('[data-track-header]')!;
		const groupBottom = groupRow.getBoundingClientRect().bottom;
		expect(
			Math.max(
				...[...groupHeader.querySelectorAll<HTMLElement>('[data-track-primary-control]')].map(
					(button) => button.getBoundingClientRect().bottom
				)
			)
		).toBeLessThanOrEqual(groupBottom);

		await screen.getByRole('button', { name: 'Collapse track group' }).click();
		expect(document.querySelector('[data-track="video-track"]')).toBeNull();
		expect(document.querySelector('[data-track="audio-track"]')).toBeNull();
		expect(timelineStore.items).toHaveLength(2);
		await screen.getByRole('button', { name: 'Expand track group' }).click();
		expect(document.querySelector('[data-track="video-track"]')).not.toBeNull();
		expect(onedit).toHaveBeenCalledTimes(3);
	});

	it('keeps clips on ungroup and confirms before deleting group contents', async () => {
		const groupId = createTrackGroup(['video-track'], 'Production')!;
		commandHistory.clearHistory();
		const screen = await render(TimelinePanel, { onedit: vi.fn() });
		await screen.getByRole('button', { name: 'More track actions' }).nth(0).click();
		await screen.getByRole('menuitem', { name: 'Ungroup and keep tracks' }).click();
		expect(timelineStore.items).toHaveLength(2);
		expect(timelineStore.tracks.some((track) => track.id === groupId)).toBe(false);

		commandHistory.undo();
		await screen.getByRole('button', { name: 'More track actions' }).nth(0).click();
		await screen.getByRole('menuitem', { name: 'Delete group and tracks' }).click();
		await expect.element(screen.getByText('Delete group and its tracks?')).toBeVisible();
		await expect
			.element(screen.getByText(/Ungroup instead if you want to keep the tracks/))
			.toBeVisible();
		screen.getByRole('button', { name: 'Delete group and tracks' }).element().click();
		await vi.waitFor(() =>
			expect(timelineStore.tracks.some((track) => track.id === groupId)).toBe(false)
		);
		expect(timelineStore.items.map((item) => item.id)).toEqual(['music-bed']);
	});
});

describe('TimelinePanel track push', () => {
	function configureTrackPushTimeline(audioLocked = false): void {
		const videoTrack = track('video-track', 'video', 0);
		const audioTrack = track('audio-track', 'audio', 1);
		audioTrack.locked = audioLocked;
		timelineStore.setAll({
			tracks: [videoTrack, audioTrack],
			items: [
				item({
					id: 'video-before',
					label: 'Before',
					from: 0,
					durationInFrames: 80
				}),
				item({
					id: 'anchor',
					label: 'Anchor',
					from: 100,
					durationInFrames: 20
				}),
				item({
					id: 'video-later',
					label: 'Video later',
					from: 140,
					durationInFrames: 20
				}),
				item({
					id: 'audio-before',
					trackId: 'audio-track',
					label: 'Audio before',
					type: 'audio',
					from: 0,
					durationInFrames: 110
				}),
				item({
					id: 'audio-later',
					trackId: 'audio-track',
					label: 'Audio later',
					type: 'audio',
					from: 110,
					durationInFrames: 30
				})
			],
			fps: 30
		});
		transitionsStore.setAll([
			{
				id: 'straddled-transition',
				type: 'crossfade',
				durationInFrames: 10,
				fromItemId: 'audio-before',
				toItemId: 'audio-later'
			}
		]);
	}

	it('previews all later tracks, cancels cleanly, then commits and undoes once', async () => {
		configureTrackPushTimeline();
		const onedit = vi.fn();
		const ontransitionbreak = vi.fn();
		const screen = await render(TimelinePanel, { onedit, ontransitionbreak });
		await screen.getByRole('button', { name: 'More actions' }).first().click();
		await userEvent.click(
			screen.getByRole('menuitemcheckbox', { name: 'Push or pull tracks' }).element()
		);
		const anchor = document.querySelector<HTMLButtonElement>(
			'[data-timeline-item-id="anchor"] > button'
		);
		expect(anchor).not.toBeNull();
		expect(anchor?.getAttribute('aria-label')).toContain('Move this cut and every later clip');

		dispatchPointer(anchor!, 'pointerdown', 400);
		dispatchPointer(window, 'pointermove', 440);
		await nextAnimationFrame();
		expect(timelineStore.itemById.get('anchor')?.from).toBe(110);
		expect(timelineStore.itemById.get('video-later')?.from).toBe(150);
		expect(timelineStore.itemById.get('audio-later')?.from).toBe(120);
		expect(document.querySelector('[data-transition-id="straddled-transition"]')).toBeNull();

		window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		await nextAnimationFrame();
		expect(timelineStore.itemById.get('anchor')?.from).toBe(100);
		expect(timelineStore.itemById.get('audio-later')?.from).toBe(110);
		expect(transitionsStore.list.map((candidate) => candidate.id)).toEqual([
			'straddled-transition'
		]);
		expect(commandHistory.undoStack).toHaveLength(0);

		dispatchPointer(anchor!, 'pointerdown', 400);
		dispatchPointer(window, 'pointermove', 440);
		dispatchPointer(window, 'pointerup', 440);
		await nextAnimationFrame();
		expect(timelineStore.itemById.get('anchor')?.from).toBe(110);
		expect(timelineStore.itemById.get('audio-later')?.from).toBe(120);
		expect(transitionsStore.list).toEqual([]);
		expect(ontransitionbreak).toHaveBeenCalledWith(1);
		expect(commandHistory.getLastCommandType()).toBe('TRACK_PUSH');
		expect(commandHistory.undoStack).toHaveLength(1);
		expect(onedit).toHaveBeenCalledOnce();

		commandHistory.undo();
		expect(timelineStore.itemById.get('anchor')?.from).toBe(100);
		expect(timelineStore.itemById.get('audio-later')?.from).toBe(110);
		expect(transitionsStore.list.map((candidate) => candidate.id)).toEqual([
			'straddled-transition'
		]);
	});

	it('uses exact keyboard steps and explains a downstream lock at phone width', async () => {
		await page.viewport(320, 720);
		configureTrackPushTimeline();
		const onedit = vi.fn();
		const screen = await render(TimelinePanel, { onedit });
		await screen.getByRole('button', { name: 'More actions' }).first().click();
		await userEvent.click(
			screen.getByRole('menuitemcheckbox', { name: 'Push or pull tracks' }).element()
		);
		const anchor = document.querySelector<HTMLButtonElement>(
			'[data-timeline-item-id="anchor"] > button'
		)!;
		await page.screenshot({
			path: '../../../../.svelte-kit/openpost-track-push-320.png'
		});
		anchor.dispatchEvent(
			new KeyboardEvent('keydown', {
				key: 'ArrowRight',
				shiftKey: true,
				bubbles: true
			})
		);
		expect(timelineStore.itemById.get('anchor')?.from).toBe(110);
		expect(timelineStore.itemById.get('audio-later')?.from).toBe(120);
		expect(commandHistory.getLastCommandType()).toBe('TRACK_PUSH');
		expect(onedit).toHaveBeenCalledOnce();
		expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(
			document.documentElement.clientWidth
		);

		commandHistory.undo();
		configureTrackPushTimeline(true);
		await vi.waitFor(() => {
			expect(anchor.getAttribute('aria-disabled')).toBe('true');
		});
		expect(anchor.title).toBe('Unlock affected later tracks to move this cut.');
		dispatchPointer(anchor, 'pointerdown', 400);
		dispatchPointer(window, 'pointermove', 440);
		dispatchPointer(window, 'pointerup', 440);
		await nextAnimationFrame();
		expect(timelineStore.itemById.get('anchor')?.from).toBe(100);
		expect(commandHistory.undoStack).toHaveLength(0);
	});
});

describe('TimelinePanel viewport performance', () => {
	it('mounts only sparse clips near the viewport and swaps the window after scrolling', async () => {
		const sparseItems = Array.from({ length: 79 }, (_, index) =>
			item({
				id: `sparse-${index}`,
				label: `Sparse ${index}`,
				from: index * 5_000,
				durationInFrames: 60
			})
		);
		timelineStore.setAll({
			tracks: [track('video-track', 'video', 0)],
			items: sparseItems,
			fps: 30
		});
		const screen = await render(TimelinePanel, { onedit: vi.fn() });
		const region = screen.getByRole('region', { name: 'Timeline' }).element();
		await nextAnimationFrame();
		expect(document.querySelectorAll('[data-timeline-item-id]').length).toBeLessThanOrEqual(2);
		expect(document.querySelector('[data-timeline-item-id="sparse-0"]')).not.toBeNull();
		expect(document.querySelector('[data-timeline-item-id="sparse-1"]')).toBeNull();

		region.scrollLeft = 5_000 * 4;
		region.dispatchEvent(new Event('scroll'));
		await nextAnimationFrame();
		await vi.waitFor(() => {
			expect(document.querySelector('[data-timeline-item-id="sparse-1"]')).not.toBeNull();
		});
		expect(document.querySelector('[data-timeline-item-id="sparse-0"]')).toBeNull();
		expect(document.querySelectorAll('[data-timeline-item-id]').length).toBeLessThanOrEqual(2);
	});

	it('bounds a 30,000 clip track while preserving direct picks and geometry marquee', async () => {
		await page.viewport(320, 720);
		const denseItems = Array.from({ length: 30_000 }, (_, index) =>
			item({
				id: `dense-${index}`,
				label: `Dense ${index}`,
				from: index * 3,
				durationInFrames: 2
			})
		);
		timelineStore.setAll({
			tracks: [track('video-track', 'video', 0)],
			items: denseItems,
			fps: 30
		});
		await render(TimelinePanel, { onedit: vi.fn() });
		await nextAnimationFrame();
		const overview = document.querySelector<HTMLElement>('[data-timeline-density-overview]');
		expect(overview).not.toBeNull();
		expect(Number(overview?.dataset.densityBucketCount)).toBeLessThanOrEqual(1_024);
		expect(document.querySelectorAll('[data-timeline-item-id]')).toHaveLength(0);
		expect(document.querySelectorAll('[data-timeline-density-bucket]').length).toBeLessThanOrEqual(
			1_024
		);
		await page.screenshot({
			path: '../../../../.svelte-kit/openpost-timeline-density-320.png'
		});
		expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(
			document.documentElement.clientWidth
		);

		const firstBucket = document.querySelector<HTMLElement>('[data-timeline-density-bucket="0"]')!;
		dispatchPointer(firstBucket, 'pointerdown', firstBucket.getBoundingClientRect().left + 1);
		dispatchPointer(window, 'pointerup', firstBucket.getBoundingClientRect().left + 1);
		await vi.waitFor(() => {
			expect(document.querySelectorAll('[data-timeline-item-id]')).toHaveLength(1);
		});
		expect(commandHistory.undoStack).toHaveLength(0);

		const row = document.querySelector<HTMLElement>('[data-track="video-track"]')!;
		const rowRect = row.getBoundingClientRect();
		const startX = rowRect.left + 181;
		const y = rowRect.top + rowRect.height / 2;
		dispatchPointer(row, 'pointerdown', startX, false, y);
		window.dispatchEvent(
			new PointerEvent('pointermove', {
				bubbles: true,
				buttons: 1,
				clientX: startX + 200,
				clientY: y,
				pointerId: 7
			})
		);
		await nextAnimationFrame();
		const promotedCount = document.querySelectorAll('[data-timeline-item-id]').length;
		expect(promotedCount).toBeGreaterThan(10);
		expect(promotedCount).toBeLessThanOrEqual(128);
		dispatchPointer(window, 'pointerup', startX + 200, false, y);
		expect(document.querySelectorAll('[data-timeline-density-bucket]').length).toBeLessThanOrEqual(
			1_024
		);
	});

	it('pans, resizes, cancels, and uses the keyboard through the timeline navigator', async () => {
		await page.viewport(1280, 720);
		timelineStore.setAll({
			items: [
				item({
					id: 'long',
					label: 'Long',
					durationInFrames: 10_000,
					sourceEnd: 10_000
				})
			],
			zoomLevel: 0.25
		});
		const screen = await render(TimelinePanel, { onedit: vi.fn() });
		const region = screen.getByRole('region', { name: 'Timeline' }).element();
		const thumb = screen.getByRole('scrollbar', { name: 'Visible timeline range' }).element();
		await vi.waitFor(() => expect(thumb.getBoundingClientRect().width).toBeGreaterThan(0));
		await page.screenshot({
			path: '../../../../.svelte-kit/openpost-timeline-navigator-1280.png'
		});

		thumb.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
		await nextAnimationFrame();
		expect(region.scrollLeft).toBeGreaterThan(0);

		const beforePan = region.scrollLeft;
		const thumbRect = thumb.getBoundingClientRect();
		dispatchPointer(thumb, 'pointerdown', thumbRect.left + thumbRect.width / 2);
		dispatchPointer(window, 'pointermove', thumbRect.left + thumbRect.width / 2 + 40);
		await nextAnimationFrame();
		dispatchPointer(window, 'pointerup', thumbRect.left + thumbRect.width / 2 + 40);
		expect(region.scrollLeft).toBeGreaterThan(beforePan);

		const resizeHandle = screen.getByRole('button', { name: 'Resize view from the end' }).element();
		const startZoom = timelineStore.zoomLevel;
		const handleRect = resizeHandle.getBoundingClientRect();
		dispatchPointer(resizeHandle, 'pointerdown', handleRect.left + handleRect.width / 2);
		dispatchPointer(window, 'pointermove', handleRect.left + handleRect.width / 2 - 30);
		await nextAnimationFrame();
		expect(timelineStore.zoomLevel).toBeGreaterThan(startZoom);
		window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		await nextAnimationFrame();
		expect(timelineStore.zoomLevel).toBe(startZoom);

		dispatchPointer(resizeHandle, 'pointerdown', handleRect.left + handleRect.width / 2);
		dispatchPointer(window, 'pointermove', handleRect.left + handleRect.width / 2 - 30);
		dispatchPointer(window, 'pointerup', handleRect.left + handleRect.width / 2 - 30);
		await nextAnimationFrame();
		expect(timelineStore.zoomLevel).toBeGreaterThan(startZoom);
	});
});

const FRAME_COLORS = [
	[220, 38, 38],
	[22, 163, 74],
	[37, 99, 235]
] as const;

function colorName(r: number, g: number, b: number): string {
	if (r > 150 && g < 120) return 'red';
	if (g > 100 && r < 120) return 'green';
	if (b > 150) return 'blue';
	return `unknown(${r},${g},${b})`;
}

describe('TimelinePanel animated image filmstrips', () => {
	it('tiles animated GIF clips with the exact frame playing under each slot', async () => {
		const blob = await (await fetch(animatedGifUrl)).blob();
		const mediaId = `animated-image-${crypto.randomUUID()}`;
		mediaPool.loadAll([
			{
				id: mediaId,
				// SAFETY: extraction only reads getFile from this stub handle.
				fileHandle: { getFile: async () => new File([blob], 'animated.gif') },
				storageType: 'handle',
				fileName: 'animated.gif',
				fileSize: blob.size,
				mimeType: 'image/gif',
				duration: 0.3,
				width: 16,
				height: 12,
				fps: 10,
				codec: '',
				bitrate: 0,
				animationFrameCount: 3,
				tags: ['image']
			}
		]);
		timelineStore._setItems([
			...timelineStore.items,
			item({
				id: 'animated-clip',
				label: 'Animated GIF',
				type: 'image',
				mediaId,
				durationInFrames: 300,
				sourceWidth: 16,
				sourceHeight: 12
			})
		]);

		try {
			const screen = await render(TimelinePanel, { onedit: vi.fn() });
			const clip = screen.getByRole('button', { name: /Animated GIF/ }).element();
			await vi.waitFor(() => {
				expect(clip.querySelectorAll('[data-filmstrip-tile]').length).toBeGreaterThan(2);
			});

			// Real extracted frames, real delays: verify each tile paints the same
			// frame the timing math predicts for its center position.
			const frames = await animatedImageCache.getAnimatedImage(mediaPool.get(mediaId)!);
			expect(frames.durationsMs).toEqual([100, 100, 100]);
			const tiles = [...clip.querySelectorAll<HTMLCanvasElement>('[data-filmstrip-tile]')];
			const clipWidth = 300 * 4; // default zoom renders 4 px per frame
			const tileWidth = FILMSTRIP_TILE_WIDTH;
			tiles.forEach((canvas) => {
				const context = canvas.getContext('2d');
				expect(context).not.toBeNull();
				const data = context!.getImageData(8, 6, 1, 1).data;
				const painted = colorName(data![0]!, data![1]!, data![2]!);
				const tileLeft = Number.parseFloat(canvas.style.left);
				const renderedTileWidth = Number.parseFloat(canvas.style.width);
				const ratio = (tileLeft + renderedTileWidth / 2) / clipWidth;
				const expectedIndex = animatedFrameIndexAtTime(
					frames.cumulativeDelaysMs,
					frames.totalDurationMs,
					ratio * (300 / 30) * 1000
				);
				expect(painted).toBe(colorName(...FRAME_COLORS[expectedIndex]!));
			});
		} finally {
			await animatedImageCache.clearMedia(mediaId);
		}
	});
});
