import { beforeEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import type { TimelineItem, TimelineTrack } from '../project/types';
import { commandHistory } from '../timeline/commands/command-store.svelte';
import { timelineStore } from '../timeline/stores/timeline-store.svelte';
import { transcriptIgnoreStore } from '../transcript/transcript-ignore-store.svelte';
import { itemClipboardStore } from '../timeline/stores/item-clipboard-store.svelte';
import TranscriptPanel from './transcript-panel.svelte';
import '../../../routes/layout.css';

const track: TimelineTrack = {
	id: 'captions',
	name: 'Captions',
	kind: 'video',
	height: 64,
	locked: false,
	visible: true,
	muted: false,
	solo: false,
	order: 0
};

const item: TimelineItem = {
	id: 'subtitle',
	trackId: track.id,
	from: 0,
	durationInFrames: 90,
	label: 'Captions',
	type: 'subtitle',
	cues: [
		{
			id: 'cue',
			startFrame: 0,
			endFrame: 90,
			text: '{\\an8}<b>Ready</b>',
			words: [{ id: 'word', startFrame: 0, endFrame: 30, text: 'Ready' }]
		}
	]
};

beforeEach(() => {
	commandHistory.clearHistory();
	transcriptIgnoreStore.__resetForTesting();
	itemClipboardStore.__resetForTesting();
	timelineStore.__resetForTesting();
	timelineStore.setAll({
		tracks: [track],
		items: [item],
		currentFrame: 0,
		fps: 30
	});
});

describe('TranscriptPanel cue formatting', () => {
	it('finds exact phrases first, falls back to fuzzy words, and seeks between results', async () => {
		await page.viewport(320, 720);
		timelineStore.setAll({
			tracks: [track],
			items: [
				{
					...item,
					cues: [
						{
							id: 'cue',
							startFrame: 0,
							endFrame: 90,
							text: 'video vido launch today',
							words: [
								{ id: 'video', startFrame: 0, endFrame: 20, text: 'video' },
								{ id: 'vido', startFrame: 30, endFrame: 45, text: 'vido' },
								{ id: 'launch', startFrame: 50, endFrame: 70, text: 'launch' },
								{ id: 'today', startFrame: 71, endFrame: 90, text: 'today' }
							]
						}
					]
				}
			],
			currentFrame: 0,
			fps: 30
		});
		const screen = await render(TranscriptPanel, { onedit: vi.fn() });
		const search = screen.getByRole('searchbox', { name: 'Search transcript' });

		await search.fill('launch tod');
		await expect.element(screen.getByText('1/1', { exact: true })).toBeVisible();

		await search.fill('vidoe');
		await expect.element(screen.getByText('~1/2', { exact: true })).toBeVisible();
		await screen.getByRole('button', { name: 'Next match' }).click();
		expect(timelineStore.currentFrame).toBe(30);
		await expect.element(screen.getByText('~2/2', { exact: true })).toBeVisible();
		expect(screen.container.scrollWidth).toBeLessThanOrEqual(320);
	});

	it('hides markup and preserves cue-wide formatting through copy and word edits', async () => {
		const onedit = vi.fn();
		const screen = await render(TranscriptPanel, { onedit });
		const cueInput = screen.getByLabelText('Caption line');
		await expect.element(cueInput).toHaveValue('Ready');

		await screen.getByRole('button', { name: 'Italic', exact: true }).click();
		expect(timelineStore.itemById.get('subtitle')?.cues?.[0]?.text).toBe(
			'{\\an8}<b><i>Ready</i></b>'
		);

		await cueInput.fill('Shipped');
		cueInput.element().dispatchEvent(new FocusEvent('blur', { bubbles: true }));
		expect(timelineStore.itemById.get('subtitle')?.cues?.[0]?.text).toBe(
			'{\\an8}<b><i>Shipped</i></b>'
		);

		const wordInput = screen.getByRole('textbox', {
			name: 'Transcript word',
			exact: true
		});
		await wordInput.fill('Delivered');
		wordInput.element().dispatchEvent(new FocusEvent('blur', { bubbles: true }));
		expect(timelineStore.itemById.get('subtitle')?.cues?.[0]?.text).toBe(
			'{\\an8}<b><i>Delivered</i></b>'
		);

		const wordStart = screen.getByRole('spinbutton', { name: 'Word start frame' });
		await wordStart.fill('5');
		wordStart.element().dispatchEvent(new FocusEvent('blur', { bubbles: true }));
		expect(timelineStore.itemById.get('subtitle')?.cues?.[0]).toMatchObject({
			startFrame: 5,
			words: [{ id: 'word', startFrame: 5, endFrame: 30, text: 'Delivered' }]
		});

		const wordEnd = screen.getByRole('spinbutton', { name: 'Word end frame' });
		await wordEnd.fill('28');
		wordEnd.element().dispatchEvent(new FocusEvent('blur', { bubbles: true }));
		expect(timelineStore.itemById.get('subtitle')?.cues?.[0]).toMatchObject({
			startFrame: 5,
			endFrame: 28,
			words: [{ id: 'word', startFrame: 5, endFrame: 28, text: 'Delivered' }]
		});

		await wordStart.fill('');
		wordStart.element().dispatchEvent(new FocusEvent('blur', { bubbles: true }));
		expect(timelineStore.itemById.get('subtitle')?.cues?.[0]?.words?.[0]?.startFrame).toBe(5);
		expect(commandHistory.undoStack).toHaveLength(5);
		expect(onedit).toHaveBeenCalledTimes(5);
		commandHistory.undo();
		expect(timelineStore.itemById.get('subtitle')?.cues?.[0]?.endFrame).toBe(30);
		commandHistory.undo();
		expect(timelineStore.itemById.get('subtitle')?.cues?.[0]?.startFrame).toBe(0);

		screen.container.style.width = '320px';
		expect(screen.container.scrollWidth).toBeLessThanOrEqual(320);
	});

	it('keeps corrected caption lines in sync with transcript editing words', async () => {
		const videoTrack: TimelineTrack = { ...track, id: 'video', name: 'Video', order: 1 };
		const video: TimelineItem = {
			id: 'video',
			trackId: videoTrack.id,
			from: 0,
			durationInFrames: 90,
			label: 'Interview',
			type: 'video',
			mediaId: 'media',
			sourceStart: 0,
			sourceEnd: 90,
			sourceFps: 30,
			speed: 1
		};
		timelineStore.setAll({
			tracks: [track, videoTrack],
			items: [
				video,
				{
					...item,
					captionSource: {
						type: 'transcript',
						clipId: video.id,
						mediaId: 'media',
						sourceStartSeconds: 0,
						playbackSpeed: 1
					}
				}
			],
			currentFrame: 0,
			fps: 30
		});
		const screen = await render(TranscriptPanel, { onedit: vi.fn() });
		const cueInput = screen.getByLabelText('Caption line');

		await cueInput.fill('Corrected');
		cueInput.element().dispatchEvent(new FocusEvent('blur', { bubbles: true }));

		expect(timelineStore.itemById.get('subtitle')?.cues?.[0]?.words).toMatchObject([
			{ id: 'word', startFrame: 0, endFrame: 30, text: 'Corrected' }
		]);
		await screen.getByRole('button', { name: 'Edit video by transcript' }).click();
		await expect.element(screen.getByRole('button', { name: 'Select "Corrected"' })).toBeVisible();
		await expect
			.element(screen.getByRole('button', { name: 'Select "Ready"' }))
			.not.toBeInTheDocument();
	});

	it('keeps timed words inside cue edits and treats an empty word as delete', async () => {
		const onedit = vi.fn();
		const screen = await render(TranscriptPanel, { onedit });
		const cueStart = screen.getByLabelText('Start', { exact: true });

		await cueStart.fill('40');
		cueStart.element().dispatchEvent(new FocusEvent('blur', { bubbles: true }));
		expect(timelineStore.itemById.get('subtitle')?.cues?.[0]).toMatchObject({
			startFrame: 40,
			endFrame: 90,
			words: [{ id: 'word', startFrame: 40, endFrame: 57, text: 'Ready' }]
		});

		const wordInput = screen.getByRole('textbox', { name: 'Transcript word', exact: true });
		await wordInput.fill('');
		wordInput.element().dispatchEvent(new FocusEvent('blur', { bubbles: true }));
		expect(timelineStore.itemById.get('subtitle')?.cues).toBeUndefined();
		expect(commandHistory.undoStack).toHaveLength(2);
		expect(onedit).toHaveBeenCalledTimes(2);
	});

	it('stages transcript words for review, then ripple deletes them in one undo step', async () => {
		await page.viewport(320, 720);
		const videoTrack: TimelineTrack = { ...track, id: 'video', name: 'Video', order: 1 };
		const video: TimelineItem = {
			id: 'video',
			trackId: videoTrack.id,
			from: 0,
			durationInFrames: 90,
			label: 'Interview',
			type: 'video',
			mediaId: 'media',
			sourceStart: 0,
			sourceEnd: 90,
			sourceFps: 30,
			speed: 1
		};
		const repeatedUse: TimelineItem = { ...video, id: 'repeat', from: 120 };
		const timedCaptions: TimelineItem = {
			...item,
			captionSource: {
				type: 'transcript',
				clipId: video.id,
				mediaId: 'media',
				sourceStartSeconds: 0,
				playbackSpeed: 1
			},
			cues: [
				{
					id: 'cue',
					startFrame: 0,
					endFrame: 90,
					text: '<b>Please um continue</b>',
					words: [
						{ id: 'please', startFrame: 0, endFrame: 25, text: 'Please' },
						{ id: 'um', startFrame: 30, endFrame: 45, text: 'um' },
						{ id: 'continue', startFrame: 50, endFrame: 90, text: 'continue' }
					]
				}
			]
		};
		timelineStore.setAll({
			tracks: [track, videoTrack],
			items: [video, repeatedUse, timedCaptions],
			currentFrame: 0,
			fps: 30
		});
		commandHistory.clearHistory();
		const onedit = vi.fn();
		const screen = await render(TranscriptPanel, { onedit, itemIds: [video.id] });

		await screen.getByRole('button', { name: 'Edit video by transcript' }).click();
		await screen.getByRole('button', { name: 'Project', exact: true }).click();
		expect(screen.container.querySelectorAll('[data-source-item-id="video"]')).toHaveLength(3);
		expect(screen.container.querySelectorAll('[data-source-item-id="repeat"]')).toHaveLength(3);
		await screen.getByRole('button', { name: 'Selection', exact: true }).click();
		expect(screen.container.querySelectorAll('[data-source-item-id="repeat"]')).toHaveLength(0);
		await expect
			.element(screen.getByRole('button', { name: 'Select "Please"' }))
			.toHaveAttribute('data-active', 'true');
		await screen.getByRole('button', { name: 'Select "um"' }).click();
		await expect.element(screen.getByText('Words selected: 1')).toBeVisible();
		await screen.getByRole('button', { name: 'Copy', exact: true }).click();
		await expect.element(screen.getByText('Words copied: 1')).toBeVisible();
		expect(itemClipboardStore.items).toMatchObject([
			{ from: 0, durationInFrames: 15, sourceStart: 30, sourceEnd: 45 }
		]);
		const contextWord = screen.getByRole('button', { name: 'Select "um"' }).element();
		contextWord.dispatchEvent(
			new MouseEvent('contextmenu', {
				bubbles: true,
				cancelable: true,
				clientX: 80,
				clientY: 80
			})
		);
		await screen.getByRole('menuitem', { name: 'Stage words' }).click();
		await expect.element(screen.getByText('1 staged · 0.5s')).toBeVisible();
		expect(screen.container.querySelector('[data-ignored="true"]')).not.toBeNull();
		expect(screen.container.scrollWidth).toBeLessThanOrEqual(320);
		expect(timelineStore.items.filter((candidate) => candidate.type === 'video')).toHaveLength(2);
		expect(commandHistory.undoStack).toHaveLength(0);

		await screen.getByRole('button', { name: 'Cut staged words' }).click();

		expect(timelineStore.items.filter((candidate) => candidate.type === 'video')).toHaveLength(3);
		expect(timelineStore.itemById.get('repeat')).toMatchObject({
			from: 105,
			durationInFrames: 90,
			sourceStart: 0,
			sourceEnd: 90
		});
		expect(timelineStore.itemById.get('subtitle')?.cues?.[0]?.text).toBe('<b>Please continue</b>');
		expect(timelineStore.itemById.get('subtitle')?.cues?.[0]?.words).toMatchObject([
			{ id: 'please', startFrame: 0, endFrame: 25 },
			{ id: 'continue', startFrame: 35, endFrame: 75 }
		]);
		expect(timelineStore.itemById.get('subtitle')?.durationInFrames).toBe(75);
		expect(commandHistory.undoStack).toHaveLength(1);
		expect(onedit).toHaveBeenCalledOnce();
		expect(transcriptIgnoreStore.spanCount).toBe(0);
		commandHistory.undo();
		expect(timelineStore.items.filter((candidate) => candidate.type === 'video')).toHaveLength(2);
		expect(timelineStore.itemById.get('subtitle')?.cues?.[0]?.text).toBe(
			'<b>Please um continue</b>'
		);

		await screen.getByRole('button', { name: 'Project', exact: true }).click();
		const repeatedUm = [
			...screen.container.querySelectorAll<HTMLButtonElement>('[data-source-item-id="repeat"]')
		].find((button) => button.textContent?.trim() === 'um');
		expect(repeatedUm).toBeDefined();
		repeatedUm?.click();
		await screen.getByRole('button', { name: 'Stage words' }).click();
		await screen.getByRole('button', { name: 'Cut staged words' }).click();

		expect(timelineStore.itemById.get('video')).toMatchObject({
			from: 0,
			durationInFrames: 90,
			sourceStart: 0,
			sourceEnd: 90
		});
		expect(timelineStore.items.filter((candidate) => candidate.type === 'video')).toHaveLength(3);
		expect(timelineStore.itemById.get('subtitle')?.cues?.[0]?.text).toBe(
			'<b>Please um continue</b>'
		);
		expect(commandHistory.undoStack).toHaveLength(1);
	});

	it('drag-selects a contiguous phrase and owns Backspace plus commit', async () => {
		const videoTrack: TimelineTrack = { ...track, id: 'video', name: 'Video', order: 1 };
		const video: TimelineItem = {
			id: 'video',
			trackId: videoTrack.id,
			from: 0,
			durationInFrames: 90,
			label: 'Interview',
			type: 'video',
			mediaId: 'media',
			sourceStart: 0,
			sourceEnd: 90,
			sourceFps: 30,
			speed: 1
		};
		const captions: TimelineItem = {
			...item,
			captionSource: {
				type: 'transcript',
				clipId: video.id,
				mediaId: 'media',
				sourceStartSeconds: 0,
				playbackSpeed: 1
			},
			cues: [
				{
					id: 'cue',
					startFrame: 0,
					endFrame: 90,
					text: 'One two three',
					words: [
						{ id: 'one', startFrame: 0, endFrame: 20, text: 'One' },
						{ id: 'two', startFrame: 30, endFrame: 50, text: 'two' },
						{ id: 'three', startFrame: 60, endFrame: 90, text: 'three' }
					]
				}
			]
		};
		timelineStore.setAll({
			tracks: [track, videoTrack],
			items: [video, captions],
			currentFrame: 0,
			fps: 30
		});
		commandHistory.clearHistory();
		const onedit = vi.fn();
		const screen = await render(TranscriptPanel, { onedit, itemIds: [video.id] });
		await screen.getByRole('button', { name: 'Edit video by transcript' }).click();
		const first = screen.getByRole('button', { name: 'Select "One"' }).element();
		const last = screen.getByRole('button', { name: 'Select "three"' }).element();
		const firstRect = first.getBoundingClientRect();
		const lastRect = last.getBoundingClientRect();
		first.dispatchEvent(
			new PointerEvent('pointerdown', {
				pointerId: 91,
				button: 0,
				clientX: firstRect.left + firstRect.width / 2,
				clientY: firstRect.top + firstRect.height / 2,
				bubbles: true
			})
		);
		window.dispatchEvent(
			new PointerEvent('pointermove', {
				pointerId: 91,
				clientX: lastRect.left + lastRect.width / 2,
				clientY: lastRect.top + lastRect.height / 2,
				bubbles: true
			})
		);
		window.dispatchEvent(
			new PointerEvent('pointerup', {
				pointerId: 91,
				clientX: lastRect.left + lastRect.width / 2,
				clientY: lastRect.top + lastRect.height / 2,
				bubbles: true
			})
		);
		await expect.element(screen.getByText('Words selected: 3')).toBeVisible();

		const panel = screen.getByTestId('transcript-panel').element();
		panel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true }));
		expect(transcriptIgnoreStore.ranges).toEqual({ media: [{ start: 0, end: 3 }] });
		await expect.element(screen.getByText('3 staged · 3.0s')).toBeVisible();
		expect(commandHistory.undoStack).toHaveLength(0);
		panel.dispatchEvent(
			new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true })
		);
		await vi.waitFor(() =>
			expect(timelineStore.items.filter((candidate) => candidate.type === 'video')).toHaveLength(0)
		);
		expect(commandHistory.undoStack).toHaveLength(1);
		expect(onedit).toHaveBeenCalledOnce();
	});
});
