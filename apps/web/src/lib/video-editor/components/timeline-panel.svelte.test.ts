import { TimelineFrameRenderer } from '../media/render-export';
import { dissolveCompoundClip } from '../sequences/sequence-actions';
import { expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { tick } from 'svelte';
import { render } from 'vitest-browser-svelte';
import TimelinePanel from './timeline-panel.svelte';
import { timelineStore } from '../timeline/stores/timeline-store.svelte';
import { createBlankProject, createDefaultTracks } from '../project/defaults';
import { commandHistory } from '../timeline/commands/command-store.svelte';
import { mediaPool } from '../media/pool.svelte';
import { planMixdown } from '../media/render-plan';
import { editorSession } from '../editor.svelte';
import { sequenceStore } from '../sequences/sequence-store.svelte';
import { getWorkspaceRoot, setWorkspaceRoot } from '../workspace-fs/root';
import { createProject, getProject } from '../workspace-fs/projects';
import { createMedia } from '../workspace-fs/media';
import { associateMediaWithProject } from '../workspace-fs/project-media';
import { autoKeyframeStore } from '../timeline/stores/auto-keyframe-store.svelte';
import ClipAudioCoreSection from './clip-audio-core-section.svelte';
import fixtureUrl from '../../../../../../tests/app/fixtures/product-screenshots/study-sos-demo.mp4?url';
import imageUrl from '../../../../../../tests/app/fixtures/product-screenshots/openpost-logo.png?url';
import '../../../routes/layout.css';

it.each([1280, 320])(
	'detaches and relinks audio through the keyboard menu at %ipx',
	async (width) => {
		await page.viewport(width, 720);
		timelineStore.__resetForTesting();
		commandHistory.clearHistory();
		timelineStore._setTracks(createDefaultTracks());
		mediaPool.loadAll([
			{
				id: 'speech-media',
				storageType: 'cloud',
				remoteUrl: '/speech.mp4',
				fileName: 'speech.mp4',
				fileSize: 100,
				mimeType: 'video/mp4',
				duration: 4,
				width: 640,
				height: 360,
				fps: 30,
				codec: 'avc',
				audioCodec: 'aac',
				hasAudio: true,
				bitrate: 1000,
				tags: []
			}
		]);
		timelineStore._setItems([
			{
				id: 'speech',
				type: 'video',
				label: 'Speech',
				mediaId: 'speech-media',
				trackId: 'track-video-main',
				from: 30,
				durationInFrames: 60,
				sourceStart: 30,
				sourceEnd: 90,
				sourceFps: 30,
				volume: 0.5,
				keyframes: { volume: { frames: [0, 59], values: [0.5, 0.8] } }
			}
		]);
		const screen = await render(TimelinePanel, { onedit: vi.fn() });
		screen.container.style.cssText = 'width:100%;height:650px;display:flex';
		try {
			await screen.getByRole('button', { name: /^Speech\. Drag/ }).click();
			await userEvent.keyboard('{Shift>}{F10}{/Shift}');
			await expect.element(page.getByRole('menuitem', { name: /^Copy/ })).toBeVisible();
			const detach = page.getByRole('menuitem', { name: 'Detach audio', exact: true });
			await expect
				.poll(() => detach.element().getBoundingClientRect().left)
				.toBeGreaterThanOrEqual(0);
			await expect
				.poll(() => detach.element().getBoundingClientRect().right)
				.toBeLessThanOrEqual(width);
			await detach.click();
			const audio = timelineStore.items.find((item) => item.type === 'audio')!;
			expect(audio).toMatchObject({
				from: 30,
				durationInFrames: 60,
				sourceStart: 30,
				sourceEnd: 90,
				volume: 0.5
			});
			expect(audio.linkedGroupId).toBe(timelineStore.itemById.get('speech')?.linkedGroupId);
			await screen
				.getByRole('button', { name: /^Speech\. Drag/ })
				.first()
				.click({ button: 'right' });
			await page.getByRole('menuitem', { name: 'Unlink selected clips', exact: true }).click();
			expect(timelineStore.items.every((item) => !item.linkedGroupId)).toBe(true);
			expect(
				planMixdown(timelineStore.items, timelineStore.tracks, 30).map((entry) => entry.itemId)
			).toEqual([audio.id]);
			await screen
				.getByRole('button', { name: /^Speech\. Drag/ })
				.first()
				.click({ button: 'right' });
			await page.getByRole('menuitem', { name: 'Link selected clips', exact: true }).click();
			expect(timelineStore.itemById.get(audio.id)?.linkedGroupId).toBe(
				timelineStore.itemById.get('speech')?.linkedGroupId
			);
			commandHistory.undo();
			commandHistory.undo();
			commandHistory.undo();
			expect(timelineStore.items).toHaveLength(1);
			expect(
				planMixdown(timelineStore.items, timelineStore.tracks, 30).map((entry) => entry.itemId)
			).toEqual(['speech']);
		} finally {
			await screen.unmount();
			await page.viewport(1280, 900);
			mediaPool.clear();
			timelineStore.__resetForTesting();
			commandHistory.clearHistory();
		}
	}
);

it('selects clips with the select-all shortcut without selecting locked clips', async () => {
	timelineStore.__resetForTesting();
	timelineStore._setTracks(
		createDefaultTracks().map((track) => ({
			...track,
			locked: track.id === 'track-video-overlay'
		}))
	);
	timelineStore._setItems(
		['first', 'second', 'locked'].map((id, index) => ({
			id,
			type: 'text',
			text: id,
			label: id,
			trackId: index === 2 ? 'track-video-overlay' : 'track-video-main',
			from: index * 60,
			durationInFrames: 30
		}))
	);
	try {
		const screen = await render(TimelinePanel, { onedit: vi.fn() });
		const first = screen.getByRole('button', { name: /^first\. Drag/ });
		await first.click();
		const modifier = navigator.platform.includes('Mac') ? 'Meta' : 'Control';
		await userEvent.keyboard(`{${modifier}>}a{/${modifier}}`);
		await expect
			.element(screen.getByRole('button', { name: /^second\. Drag/ }))
			.toHaveAttribute('aria-pressed', 'true');
		await expect
			.element(screen.getByRole('button', { name: /^locked\. Drag/ }))
			.toHaveAttribute('aria-pressed', 'false');
	} finally {
		timelineStore.__resetForTesting();
	}
});

it('shows fade handles only for the selected clip, including on hover', async () => {
	timelineStore.__resetForTesting();
	timelineStore._setTracks(createDefaultTracks());
	timelineStore._setItems(
		['first', 'second'].map((id, index) => ({
			id,
			type: 'video',
			label: id,
			trackId: 'track-video-main',
			from: index * 60,
			durationInFrames: 60
		}))
	);
	const screen = await render(TimelinePanel, { onedit: vi.fn() });
	screen.container.style.cssText = 'width:1000px;height:400px;display:flex';
	try {
		await screen.getByRole('button', { name: /^first\. Drag/ }).click();
		await userEvent.hover(screen.getByRole('button', { name: /^second\. Drag/ }));
		await expect
			.poll(() => screen.getByRole('slider', { name: 'Adjust video fade in' }).all().length)
			.toBe(1);
		await screen.getByRole('button', { name: /^second\. Drag/ }).click();
		await expect
			.poll(() => screen.getByRole('slider', { name: 'Adjust video fade in' }).all().length)
			.toBe(1);
	} finally {
		await screen.unmount();
		timelineStore.__resetForTesting();
	}
});

it('reorders tracks by dragging their names and restores the order with one undo', async () => {
	timelineStore.__resetForTesting();
	commandHistory.clearHistory();
	timelineStore._setTracks(createDefaultTracks());
	const onedit = vi.fn();
	const screen = await render(TimelinePanel, { onedit });
	screen.container.style.cssText = 'width:1000px;height:400px;display:flex';
	try {
		await screen
			.getByRole('button', { name: 'Visual 1', exact: true })
			.dropTo(screen.getByRole('button', { name: 'Visual 2', exact: true }));
		expect(
			timelineStore.tracks.toSorted((a, b) => a.order - b.order).map((track) => track.name)
		).toEqual(['Visual 1', 'Visual 2', 'Audio']);
		expect(onedit).toHaveBeenCalledOnce();
		commandHistory.undo();
		expect(
			timelineStore.tracks.toSorted((a, b) => a.order - b.order).map((track) => track.name)
		).toEqual(['Visual 2', 'Visual 1', 'Audio']);
	} finally {
		await screen.unmount();
		timelineStore.__resetForTesting();
		commandHistory.clearHistory();
	}
});

it('keeps a compact row drag stable over a taller row and cancels without saving', async () => {
	timelineStore.__resetForTesting();
	timelineStore._setTracks(
		createDefaultTracks()
			.reverse()
			.map((track) => ({
				...track,
				height: track.id === 'track-video-overlay' ? 48 : 96
			}))
	);
	const source = timelineStore.tracks;
	const onedit = vi.fn();
	const screen = await render(TimelinePanel, { onedit });
	screen.container.style.cssText = 'width:1000px;height:400px;display:flex';
	try {
		const handle = screen.getByRole('button', { name: 'Visual 2', exact: true }).element();
		const row = handle.closest<HTMLElement>('[data-track]')!;
		const top = row.getBoundingClientRect().top;
		const pointer = (type: string, target: EventTarget, y: number) =>
			target.dispatchEvent(
				new PointerEvent(type, {
					pointerId: 1,
					button: 0,
					bubbles: true,
					cancelable: true,
					clientY: top + y
				})
			);
		const rows = () =>
			[...screen.container.querySelectorAll<HTMLElement>('[data-track]')].map(
				(row) => row.dataset.track
			);
		pointer('pointerdown', handle, 12);
		pointer('pointermove', window, 80);
		await tick();
		expect(rows()).toEqual(['track-video-main', 'track-video-overlay', 'track-audio']);
		pointer('pointermove', window, 81);
		await tick();
		expect(rows()).toEqual(['track-video-main', 'track-video-overlay', 'track-audio']);
		expect(timelineStore.tracks).toBe(source);
		expect(onedit).not.toHaveBeenCalled();
		window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		pointer('pointerup', window, 81);
		await tick();
		expect(rows()).toEqual(['track-video-overlay', 'track-video-main', 'track-audio']);
		expect(timelineStore.tracks).toBe(source);
		expect(onedit).not.toHaveBeenCalled();
		pointer('pointerdown', handle, 12);
		pointer('pointermove', window, 80);
		await tick();
		pointer('pointermove', window, 20);
		await tick();
		pointer('pointerup', window, 20);
		expect(timelineStore.tracks).toBe(source);
		expect(onedit).not.toHaveBeenCalled();
	} finally {
		await screen.unmount();
		timelineStore.__resetForTesting();
	}
});

it('keeps focus on the track name after keyboard reordering', async () => {
	timelineStore.__resetForTesting();
	timelineStore._setTracks(createDefaultTracks());
	const screen = await render(TimelinePanel, { onedit: vi.fn() });
	try {
		const track = screen.getByRole('button', { name: 'Visual 2', exact: true });
		track.element().focus();
		await userEvent.keyboard('{Alt>}{ArrowDown}{/Alt}');
		expect(timelineStore.tracks.toSorted((a, b) => a.order - b.order)[1]!.name).toBe('Visual 2');
		await expect.element(track).toHaveFocus();
	} finally {
		await screen.unmount();
		timelineStore.__resetForTesting();
	}
});

it('adds a visible volume key by default on audio and keeps visual defaults supported', async () => {
	await page.viewport(1280, 900);
	const project = createBlankProject('Default audio key');
	project.timeline!.items = [
		{
			id: 'audio-key',
			type: 'audio',
			label: 'Audio key',
			trackId: 'track-audio',
			from: 0,
			durationInFrames: 90,
			volume: 0.25,
			mediaId: 'key-source'
		},
		{
			id: 'visual-key',
			type: 'image',
			label: 'Visual key',
			trackId: 'track-video-main',
			from: 0,
			durationInFrames: 90,
			transform: { opacity: 0.7 },
			mediaId: 'key-image'
		},
		{
			id: 'video-key',
			type: 'video',
			label: 'Video key',
			trackId: 'track-video-overlay',
			from: 0,
			durationInFrames: 90,
			transform: { opacity: 0.6 },
			mediaId: 'key-source'
		},
		{
			id: 'empty-key',
			type: 'adjustment',
			label: 'No properties',
			trackId: 'track-video-main',
			from: 120,
			durationInFrames: 90
		}
	];
	const previousRoot = getWorkspaceRoot();
	const storage = await navigator.storage.getDirectory();
	const directoryName = `default-audio-key-${crypto.randomUUID()}`;
	setWorkspaceRoot(await storage.getDirectoryHandle(directoryName, { create: true }));
	await createProject(project);
	for (const media of [
		{
			id: 'key-source',
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
		},
		{
			id: 'key-image',
			storageType: 'cloud' as const,
			remoteUrl: imageUrl,
			fileName: 'image.png',
			fileSize: 10000,
			mimeType: 'image/png',
			duration: 0,
			width: 256,
			height: 256,
			fps: 0,
			codec: '',
			bitrate: 0,
			hasAudio: false,
			tags: []
		}
	]) {
		await createMedia(media);
		await associateMediaWithProject(project.id, media.id);
	}
	await editorSession.load(project.id);
	expect(editorSession.loadError).toBe('');
	editorSession.clock.seek(15);
	const screen = await render(TimelinePanel, { onedit: () => editorSession.scheduleAutosave() });
	let originalMounted = true;
	screen.container.style.cssText = 'width:100%;height:650px;display:flex';
	try {
		await screen.getByRole('button', { name: /^Audio key\. Drag/ }).click();
		await screen.getByRole('button', { name: 'Keyframes', exact: true }).click();
		await userEvent.keyboard('{Tab}{Tab}');
		await expect
			.element(screen.getByRole('button', { name: 'Add key', exact: true }))
			.toHaveFocus();
		await userEvent.keyboard('{Enter}');
		expect(timelineStore.itemById.get('audio-key')?.keyframes).toMatchObject({
			volume: { frames: [15], values: [0.25] }
		});
		expect(timelineStore.itemById.get('audio-key')?.keyframes?.opacity).toBeUndefined();
		await expect
			.element(screen.getByRole('button', { name: 'volume keyframe at frame 15', exact: true }))
			.toBeVisible();
		commandHistory.undo();
		await expect
			.element(screen.getByRole('button', { name: 'volume keyframe at frame 15', exact: true }))
			.not.toBeInTheDocument();
		commandHistory.redo();
		await expect
			.element(screen.getByRole('button', { name: 'volume keyframe at frame 15', exact: true }))
			.toBeVisible();
		await screen.getByRole('button', { name: /^Visual key\. Drag/ }).click();
		await expect
			.element(screen.getByRole('button', { name: 'Toggle auto-key for volume', exact: true }))
			.not.toBeInTheDocument();
		screen.getByRole('button', { name: 'Add key', exact: true }).element().focus();
		await userEvent.keyboard('{Enter}');
		expect(timelineStore.itemById.get('visual-key')?.keyframes).toMatchObject({
			opacity: { frames: [15], values: [0.7] }
		});
		await screen.getByRole('button', { name: /^Video key\. Drag/ }).click();
		await screen.getByRole('button', { name: 'Add key', exact: true }).click();
		expect(timelineStore.itemById.get('video-key')?.keyframes).toMatchObject({
			opacity: { frames: [15], values: [0.6] }
		});
		editorSession.clock.seek(135);
		await screen.getByRole('button', { name: /^No properties\. Drag/ }).click();
		await expect
			.element(screen.getByRole('button', { name: 'Add key', exact: true }))
			.toBeDisabled();
		await expect
			.element(screen.getByRole('button', { name: 'Toggle auto-key for opacity', exact: true }))
			.toBeDisabled();
		editorSession.clock.seek(15);
		await screen.getByRole('button', { name: /^Audio key\. Drag/ }).click();
		await screen.getByRole('button', { name: 'Toggle auto-key for volume', exact: true }).click();
		expect(autoKeyframeStore.isEnabled('audio-key', 'volume')).toBe(true);
		expect(autoKeyframeStore.isEnabled('audio-key', 'opacity')).toBe(false);
		await editorSession.saveNow();
		const saved = await getProject(project.id);
		expect(saved?.timeline?.items.find((item) => item.id === 'audio-key')?.keyframes).toMatchObject(
			{ volume: { frames: [15], values: [0.25] } }
		);
		await screen.unmount();
		screen.container.remove();
		originalMounted = false;
		editorSession.project = null;
		sequenceStore.reset();
		timelineStore.__resetForTesting();
		mediaPool.clear();
		await editorSession.load(project.id);
		expect(editorSession.loadError).toBe('');
		editorSession.clock.seek(15);
		const reopened = await render(TimelinePanel, {
			onedit: () => editorSession.scheduleAutosave()
		});
		reopened.container.style.cssText = 'width:100%;height:650px;display:flex';
		try {
			await reopened.getByRole('button', { name: /^Audio key\. Drag/ }).click();
			await reopened.getByRole('button', { name: 'Keyframes', exact: true }).click();
			await expect
				.element(reopened.getByRole('button', { name: 'volume keyframe at frame 15', exact: true }))
				.toBeVisible();
			expect(timelineStore.itemById.get('audio-key')?.keyframes?.opacity).toBeUndefined();
			const inspector = await render(ClipAudioCoreSection, {
				audioItems: [timelineStore.itemById.get('audio-key')!],
				onedit: vi.fn()
			});
			try {
				await expect
					.element(
						inspector.getByRole('button', { name: 'Remove Gain (dB) keyframe', exact: true })
					)
					.toHaveAttribute('aria-pressed', 'true');
			} finally {
				await inspector.unmount();
			}
		} finally {
			await reopened.unmount();
			reopened.container.remove();
		}
	} finally {
		if (originalMounted) await screen.unmount();
		editorSession.stopAutosaveTimers();
		autoKeyframeStore.reset();
		editorSession.project = null;
		setWorkspaceRoot(previousRoot);
		await storage.removeEntry(directoryName, { recursive: true });
		timelineStore.__resetForTesting();
		sequenceStore.reset();
		mediaPool.clear();
		commandHistory.clearHistory();
	}
}, 30000);

it.each([390, 320])('keeps the focused Add key control visible at %ipx', async (width) => {
	await page.viewport(width, 900);
	timelineStore.__resetForTesting();
	commandHistory.clearHistory();
	timelineStore._setTracks(createDefaultTracks());
	timelineStore._setItems([
		{
			id: 'focus-audio',
			type: 'audio',
			label: 'Focus audio',
			trackId: 'track-audio',
			from: 0,
			durationInFrames: 90,
			volume: 1
		}
	]);
	const screen = await render(TimelinePanel, { onedit: vi.fn() });
	screen.container.style.cssText = 'width:100%;height:650px;display:flex';
	try {
		screen
			.getByRole('button', { name: /^Focus audio\. Drag/ })
			.element()
			.focus();
		await userEvent.keyboard('{Enter}');
		screen.getByRole('button', { name: 'Keyframes', exact: true }).element().focus();
		await userEvent.keyboard('{Enter}{Tab}{Tab}');
		const add = screen.getByRole('button', { name: 'Add key', exact: true });
		await expect.element(add).toHaveFocus();
		await expect
			.poll(() => add.element().getBoundingClientRect().left)
			.toBeGreaterThanOrEqual(-0.5);
		await expect
			.poll(() => add.element().getBoundingClientRect().right)
			.toBeLessThanOrEqual(width + 0.5);
		expect(commandHistory.canUndo).toBe(false);
	} finally {
		await screen.unmount();
		await page.viewport(1280, 900);
		timelineStore.__resetForTesting();
		commandHistory.clearHistory();
	}
});

it('dissolves the selected compound with its published text and retains it after reopen', async () => {
	const project = createBlankProject('Published compound dissolve');
	project.metadata = { ...project.metadata, width: 320, height: 180, fps: 30 };
	const tracks = createDefaultTracks();
	project.timeline = {
		...project.timeline!,
		tracks,
		compositions: [
			{
				id: 'source',
				name: 'Source title',
				fps: 30,
				width: 320,
				height: 180,
				durationInFrames: 90,
				tracks,
				transitions: [],
				items: ['Inner A', 'Later B'].map((text, index) => ({
					id: `title-${index}`,
					type: 'text' as const,
					label: text,
					text,
					trackId: tracks[0]!.id,
					from: index * 45,
					durationInFrames: 45,
					fontFamily: 'Arial',
					fontSize: 30,
					color: '#ffffff',
					transform: { x: 0, y: 0, width: 320, height: 180 }
				})),
				compositionControls: {
					version: 1,
					controls: [
						{
							id: 'headline',
							name: 'Headline',
							targetItemId: 'title-0',
							property: 'text.text',
							kind: 'text',
							defaultValue: 'Inner A'
						}
					]
				}
			}
		],
		items: ['Instance one', 'Instance two'].map((text, index) => ({
			id: `instance-${index}`,
			type: 'composition' as const,
			label: text,
			trackId: tracks[0]!.id,
			from: index * 90,
			durationInFrames: 90,
			compositionId: 'source',
			compositionWidth: 320,
			compositionHeight: 180,
			sourceStart: 0,
			sourceEnd: 90,
			sourceDuration: 90,
			sourceFps: 30,
			compositionControlOverrides: { headline: text }
		}))
	};
	sequenceStore.reset();
	timelineStore.__resetForTesting();
	sequenceStore.load(project.timeline, project.metadata);
	commandHistory.clearHistory();
	async function frame() {
		const renderer = new TimelineFrameRenderer({
			...project,
			timeline: sequenceStore.projectTimeline()
		});
		try {
			const canvas = await renderer.render(121);
			return new Uint8ClampedArray(canvas.getContext('2d')!.getImageData(0, 0, 320, 180).data);
		} finally {
			renderer.dispose();
		}
	}
	const before = await frame();
	expect(before.some((value, index) => index % 4 === 0 && value > 200)).toBe(true);
	const screen = await render(TimelinePanel, {
		onedit: vi.fn(),
		ondissolvecompound: dissolveCompoundClip
	});
	screen.container.style.cssText = 'width:100%;height:650px;display:flex';
	const prior = getWorkspaceRoot();
	const root = await navigator.storage.getDirectory();
	const dir = `compound-dissolve-${crypto.randomUUID()}`;
	try {
		await screen.getByRole('button', { name: /^Instance two\. Drag/ }).click();
		await userEvent.keyboard('{Shift>}{F10}{/Shift}');
		await page.getByRole('menuitem', { name: 'Dissolve compound clip', exact: true }).click();
		expect(
			timelineStore.items.filter((item) => item.type === 'text').map((item) => item.text)
		).toEqual(['Instance two', 'Later B']);
		expect(timelineStore.itemById.get('instance-0')?.compositionControlOverrides).toEqual({
			headline: 'Instance one'
		});
		expect(sequenceStore.compositionById.get('source')?.items[0]?.text).toBe('Inner A');
		expect((await frame()).filter((value, index) => value !== before[index]).length).toBe(0);
		commandHistory.undo();
		expect(timelineStore.items).toHaveLength(2);
		commandHistory.redo();
		expect((await frame()).filter((value, index) => value !== before[index]).length).toBe(0);
		setWorkspaceRoot(await root.getDirectoryHandle(dir, { create: true }));
		await createProject({ ...project, timeline: sequenceStore.projectTimeline() });
		await screen.unmount();
		sequenceStore.reset();
		timelineStore.__resetForTesting();
		const loaded = (await getProject(project.id))!;
		sequenceStore.load(loaded.timeline!, loaded.metadata);
		expect(
			timelineStore.items.filter((item) => item.type === 'text').map((item) => item.text)
		).toEqual(['Instance two', 'Later B']);
		expect((await frame()).filter((value, index) => value !== before[index]).length).toBe(0);
	} finally {
		setWorkspaceRoot(prior);
		await root.removeEntry(dir, { recursive: true }).catch(() => {});
		sequenceStore.reset();
		timelineStore.__resetForTesting();
		commandHistory.clearHistory();
	}
});
