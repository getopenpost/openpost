import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import type { TimelineItem, TimelineTrack } from '$lib/video-editor/project/types';
import { commandHistory } from '$lib/video-editor/timeline/commands/command-store.svelte';
import { timelineStore } from '$lib/video-editor/timeline/stores/timeline-store.svelte';
import { mediaPool } from '$lib/video-editor/media/pool.svelte';
import { setWorkspaceRoot } from '$lib/video-editor/workspace-fs/root';
import LottiePropertiesPanel from './lottie-properties-panel.svelte';

const track: TimelineTrack = {
	id: 'visual',
	name: 'Visual',
	kind: 'video',
	height: 64,
	locked: false,
	visible: true,
	muted: false,
	solo: false,
	order: 0
};

const item: TimelineItem = {
	id: 'lottie',
	trackId: track.id,
	from: 0,
	durationInFrames: 90,
	label: 'Animation',
	type: 'lottie',
	lottieTotalFrames: 60,
	lottieFrameRate: 30,
	lottieLoop: true,
	lottieMarkers: [{ name: 'Action', start: 10, duration: 10 }],
	transform: { width: 320, height: 180 }
};

beforeEach(() => {
	commandHistory.clearHistory();
	mediaPool.clear();
	timelineStore.__resetForTesting();
	timelineStore.setAll({ tracks: [track], items: [item], currentFrame: 0, fps: 30 });
});

afterEach(() => {
	mediaPool.clear();
	setWorkspaceRoot(null);
});

describe('LottiePropertiesPanel', () => {
	it('commits playback and named-marker controls without overflowing the inspector', async () => {
		const onedit = vi.fn();
		const screen = await render(LottiePropertiesPanel, {
			item: timelineStore.itemById.get(item.id)!,
			onedit
		});

		await screen.getByRole('checkbox', { name: 'Reverse' }).click();
		await screen.getByRole('button', { name: 'Named marker' }).click();
		await screen.getByRole('option', { name: 'Action' }).click();
		expect(timelineStore.itemById.get(item.id)).toMatchObject({
			lottieReversed: true,
			lottieSegmentStart: 10,
			lottieSegmentEnd: 20
		});
		expect(commandHistory.canUndo).toBe(true);
		expect(onedit).toHaveBeenCalledTimes(2);

		screen.container.style.width = '260px';
		const panel = screen.container.querySelector('section');
		expect(panel).not.toBeNull();
		if (panel) expect(panel.scrollWidth).toBeLessThanOrEqual(260);
	});

	it('discovers and commits template text, colors, and value slots at inspector width', async () => {
		const animation = JSON.stringify({
			v: '5.12.2',
			w: 64,
			h: 64,
			fr: 30,
			ip: 0,
			op: 30,
			slots: {
				headline: { nm: 'Headline', p: { a: 1, k: [{ s: { t: 'Original' } }] } },
				opacity: { nm: 'Opacity', p: { a: 0, k: 80 } }
			},
			layers: [
				{
					ty: 5,
					t: { d: { sid: 'headline', k: [{ s: { t: 'Fallback' } }] } }
				},
				{
					ty: 4,
					shapes: [{ ty: 'fl', nm: 'Coat', c: { a: 0, k: [1, 0, 0, 1] } }]
				}
			]
		});
		const blob = new Blob([animation], { type: 'application/json' });
		// SAFETY: resolveMediaBlob only calls getFile on linked handles in this browser test.
		const fileHandle = {
			getFile: async () => new File([blob], 'template.json')
		} as FileSystemFileHandle;
		mediaPool.upsert(
			{
				id: 'template-media',
				storageType: 'handle',
				fileHandle,
				fileName: 'template.json',
				fileSize: blob.size,
				mimeType: 'application/json',
				duration: 1,
				width: 64,
				height: 64,
				fps: 30,
				codec: 'lottie',
				bitrate: 0,
				tags: ['lottie']
			},
			'ready'
		);
		// SAFETY: linked media resolves through its file handle before any directory method is used.
		setWorkspaceRoot({ name: 'test' } as FileSystemDirectoryHandle);
		const advancedItem: TimelineItem = { ...item, mediaId: 'template-media' };
		timelineStore.setAll({ tracks: [track], items: [advancedItem], currentFrame: 0, fps: 30 });
		const screen = await render(LottiePropertiesPanel, {
			item: timelineStore.itemById.get(advancedItem.id)!,
			onedit: vi.fn()
		});

		await expect.element(screen.getByText('Template text')).toBeVisible();
		await screen.getByLabelText('Headline').fill('OpenPost');
		await screen.getByLabelText('Opacity').fill('50');
		await screen.getByText('Template properties').click();
		expect(timelineStore.itemById.get(advancedItem.id)).toMatchObject({
			lottieTextOverrides: { 's:headline': 'OpenPost' },
			lottieSlotOverrides: { opacity: 50 }
		});

		screen.container.style.width = '260px';
		const panel = screen.container.querySelector('section');
		expect(panel).not.toBeNull();
		if (panel) expect(panel.scrollWidth).toBeLessThanOrEqual(260);
	});
});
