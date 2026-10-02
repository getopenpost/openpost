import { expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { userEvent } from 'vitest/browser';
import TranscriptCutPanel from './TranscriptCutPanel.svelte';
import CleanupPanel from './CleanupPanel.svelte';
import type { QuickCutSource } from '../types';

const source: QuickCutSource = {
	id: 'interview',
	name: 'Interview.mp4',
	size: 1024,
	mimeType: 'video/mp4',
	duration: 10,
	width: 640,
	height: 360,
	videoCodec: 'avc',
	audioCodec: 'aac',
	sampleRate: 48000,
	channels: 2,
	rotation: 0,
	fps: 30,
	keyframeTimestamps: [],
	keyframeState: 'unknown',
	videoStreams: [],
	audioStreams: [{ index: 0, codec: 'aac', sampleRate: 48000, channels: 2 }],
	transcript: {
		audioTrackIndex: 0,
		words: [
			{ text: 'Hello', start: 0, end: 0.5 },
			{ text: 'again', start: 1, end: 1.5 },
			{ text: 'friends', start: 2, end: 2.5 }
		]
	}
};

test('opens the transcript panel for a video without audio and prevents transcription', async () => {
	const screen = await render(TranscriptCutPanel, {
		source: { ...source, audioStreams: [], audioCodec: null, transcript: undefined },
		segments: [],
		currentTime: 0,
		onsave: vi.fn(),
		onseek: vi.fn(),
		onremove: vi.fn()
	});
	await expect
		.element(screen.getByRole('button', { name: 'Create transcript', exact: true }))
		.toBeDisabled();
	await expect.element(screen.getByText('No audio tracks', { exact: true })).toBeVisible();
});

test('explains why cleanup is unavailable for a video without audio', async () => {
	const screen = await render(CleanupPanel, {
		source: { ...source, audioStreams: [], audioCodec: null, transcript: undefined },
		onapply: vi.fn(),
		onpreview: vi.fn(),
		onreview: vi.fn()
	});
	await expect
		.element(screen.getByRole('button', { name: 'Find cuts', exact: true }))
		.toBeDisabled();
	await expect.element(screen.getByText('No audio tracks', { exact: true })).toBeVisible();
});

test('selects words and removes their source ranges while preserving existing transcript cuts', async () => {
	const onremove = vi.fn();
	const screen = await render(TranscriptCutPanel, {
		source,
		segments: [{ id: 'kept', sourceId: source.id, start: 0.5, end: 10 }],
		currentTime: 0,
		onsave: vi.fn(),
		onseek: vi.fn(),
		onremove
	});
	await expect.element(screen.getByRole('button', { name: 'Hello', exact: true })).toBeDisabled();
	await screen.getByRole('button', { name: 'again', exact: true }).click();
	await userEvent.keyboard('{Shift>}');
	await screen.getByRole('button', { name: 'friends', exact: true }).click();
	await userEvent.keyboard('{/Shift}');
	await screen.getByRole('button', { name: 'Remove 2 words' }).click();
	expect(onremove).toHaveBeenCalledExactlyOnceWith('interview', [
		{ text: 'again', start: 1, end: 1.5 },
		{ text: 'friends', start: 2, end: 2.5 }
	]);
});
