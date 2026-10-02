import { expect, it } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import { m } from '$lib/paraglide/messages';
import ClipPlaybackSection from './clip-playback-section.svelte';
import PreviewPlayer from './preview-player.svelte';
import { editorSession } from '../editor.svelte';
import { createBlankProject } from '../project/defaults';
import { sequenceStore } from '../sequences/sequence-store.svelte';
import { timelineStore } from '../timeline/stores/timeline-store.svelte';
import { commandHistory } from '../timeline/commands/command-store.svelte';
import { mediaPool } from '../media/pool.svelte';
import fixtureUrl from '../../../../../../tests/app/fixtures/product-screenshots/study-sos-demo.mp4?url';
import { getWorkspaceRoot, setWorkspaceRoot } from '../workspace-fs/root';
import { createProject, getProject } from '../workspace-fs/projects';
import { createMedia } from '../workspace-fs/media';
import { associateMediaWithProject } from '../workspace-fs/project-media';
import '../../../routes/layout.css';

it('keeps Program and playback clock inside a shortened clip after speed commit, cancel and history', async () => {
	await page.viewport(1000, 800);
	const project = createBlankProject('Speed preview');
	project.timeline!.items = [
		{
			id: 'video',
			type: 'video',
			label: 'Video',
			trackId: 'track-video-main',
			from: 0,
			durationInFrames: 120,
			mediaId: 'source',
			sourceStart: 0,
			sourceEnd: 120,
			sourceFps: 30
		}
	];
	const media = [
		{
			id: 'source',
			storageType: 'cloud' as const,
			remoteUrl: fixtureUrl,
			fileName: 'source.mp4',
			fileSize: 185000,
			mimeType: 'video/mp4',
			duration: 8,
			width: 640,
			height: 360,
			fps: 30,
			codec: 'avc',
			bitrate: 100000,
			hasAudio: true,
			tags: []
		}
	];
	const previousRoot = getWorkspaceRoot();
	const storage = await navigator.storage.getDirectory();
	const directoryName = `speed-preview-${crypto.randomUUID()}`;
	setWorkspaceRoot(await storage.getDirectoryHandle(directoryName, { create: true }));
	await createProject(project);
	await createMedia(media[0]);
	await associateMediaWithProject(project.id, media[0].id);
	await editorSession.load(project.id);
	expect(editorSession.loadError).toBe('');
	commandHistory.clearHistory();
	editorSession.clock.seek(119);
	const preview = await render(PreviewPlayer, { onedit: () => {} });
	preview.container.style.cssText = 'display:flex;width:900px;height:500px';
	let originalMounted = true;
	const controls = await render(ClipPlaybackSection, { itemId: 'video', onedit: () => {} });
	controls.container.style.width = '320px';
	const picture = (container = preview.container) => {
		const layer = container.querySelector('[data-preview-item="video"]');
		const video = layer?.querySelector('video');
		const fallback = layer?.querySelector<HTMLCanvasElement>('[data-seek-fallback]');
		const canvas = document.createElement('canvas');
		canvas.width = 64;
		canvas.height = 36;
		const context = canvas.getContext('2d')!;
		if (video && video.readyState >= 2 && video.checkVisibility({ checkOpacity: true }))
			context.drawImage(video, 0, 0, 64, 36);
		if (
			fallback &&
			!fallback.hidden &&
			fallback.checkVisibility({ checkOpacity: true }) &&
			fallback.width
		)
			context.drawImage(fallback, 0, 0, 64, 36);
		return context
			.getImageData(0, 0, 64, 36)
			.data.some((value, index) => index % 4 !== 3 && value > 32);
	};
	const seeks: number[] = [];
	const stopSeek = editorSession.clock.on('seek', (frame) => seeks.push(frame));
	try {
		await expect.poll(picture).toBe(true);
		await controls
			.getByRole('button', { name: new RegExp(`^${m.video_editor_clip_playback()}`) })
			.click();
		const speed = controls.getByRole('textbox', { name: m.video_editor_clip_speed(), exact: true });
		await speed.fill('2');
		await userEvent.keyboard('{Escape}');
		expect(timelineStore.itemById.get('video')?.durationInFrames).toBe(120);
		expect(timelineStore.currentFrame).toBe(119);
		expect(commandHistory.canUndo).toBe(false);
		await expect.poll(picture).toBe(true);
		await speed.fill('2');
		await userEvent.keyboard('{Tab}');
		expect(timelineStore.maxItemEndFrame).toBe(60);
		await expect.poll(picture).toBe(true);
		expect(timelineStore.currentFrame).toBe(59);
		expect(editorSession.clock.currentFrame).toBe(59);
		expect(seeks).toEqual([59]);
		expect(commandHistory.undoStack).toHaveLength(1);
		commandHistory.undo();
		expect(timelineStore.maxItemEndFrame).toBe(120);
		expect(timelineStore.currentFrame).toBe(59);
		editorSession.clock.seek(119);
		commandHistory.redo();
		expect(timelineStore.currentFrame).toBe(59);
		expect(editorSession.clock.currentFrame).toBe(59);
		await expect.poll(picture).toBe(true);
		await editorSession.saveNow();
		const saved = await getProject(project.id);
		expect(saved?.timeline?.items[0].speed).toBe(2);
		expect(saved?.timeline?.currentFrame).toBe(59);
		await controls.unmount();
		await preview.unmount();
		originalMounted = false;
		editorSession.project = null;
		sequenceStore.reset();
		timelineStore.__resetForTesting();
		mediaPool.clear();
		await editorSession.load(project.id);
		expect(editorSession.loadError).toBe('');
		expect(timelineStore.itemById.get('video')?.speed).toBe(2);
		expect(timelineStore.maxItemEndFrame).toBe(60);
		expect(timelineStore.currentFrame).toBe(59);
		const reopened = await render(PreviewPlayer, { onedit: () => {} });
		reopened.container.style.cssText = 'display:flex;width:900px;height:500px';
		await expect.poll(() => picture(reopened.container)).toBe(true);
		// A second project session must have one transport reconciliation subscription.
		seeks.length = 0;
		const reopenedControls = await render(ClipPlaybackSection, {
			itemId: 'video',
			onedit: () => {}
		});
		await reopenedControls
			.getByRole('button', { name: new RegExp(`^${m.video_editor_clip_playback()}`) })
			.click();
		await reopenedControls
			.getByRole('textbox', { name: m.video_editor_clip_speed(), exact: true })
			.fill('4');
		await userEvent.keyboard('{Tab}');
		expect(timelineStore.currentFrame).toBe(29);
		expect(seeks).toEqual([29]);
		commandHistory.undo();
		await reopenedControls
			.getByRole('button', {
				name: m.video_editor_motion_override_reset({ name: m.video_editor_clip_speed() })
			})
			.click();
		expect(timelineStore.maxItemEndFrame).toBe(120);
		editorSession.clock.seek(119);
		commandHistory.undo();
		expect(timelineStore.maxItemEndFrame).toBe(60);
		expect(timelineStore.currentFrame).toBe(59);
		expect(editorSession.clock.currentFrame).toBe(59);
		await expect.poll(() => picture(reopened.container)).toBe(true);
		await reopenedControls.unmount();
		await reopened.unmount();
	} finally {
		editorSession.stopPlayback();
		stopSeek();
		editorSession.stopAutosaveTimers();
		if (originalMounted) {
			await controls.unmount();
			await preview.unmount();
		}
		setWorkspaceRoot(previousRoot);
		await storage.removeEntry(directoryName, { recursive: true });
		mediaPool.clear();
		timelineStore.__resetForTesting();
		sequenceStore.reset();
		commandHistory.clearHistory();
		editorSession.project = null;
	}
}, 30000);
