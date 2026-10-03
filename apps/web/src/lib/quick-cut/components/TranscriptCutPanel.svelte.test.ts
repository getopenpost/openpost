import { beforeEach, afterEach, expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { userEvent } from 'vitest/browser';
import TranscriptCutPanel from './TranscriptCutPanel.svelte';
import StreamSelector from './StreamSelector.svelte';
import CleanupPanel from './CleanupPanel.svelte';
import type { QuickCutSource } from '../types';
import { createNewProject, parseProject, serializeProject } from '../project';
import {
	BrowserTranscriber,
	TranscriptionJob
} from '$lib/video-editor/transcript/engine/transcriber';
import { handleGlobalPlayPauseShortcut } from '$lib/video-editor/settings/keyboard-shortcuts';

import { setWorkspaceRoot } from '$lib/video-editor/workspace-fs/root';
beforeEach(async () => {
	setWorkspaceRoot(
		await (
			await navigator.storage.getDirectory()
		).getDirectoryHandle(crypto.randomUUID(), { create: true })
	);
});
afterEach(() => setWorkspaceRoot(null));

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
		source: {
			...source,
			audioStreams: [],
			audioCodec: null,
			transcript: undefined
		},
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
		source: {
			...source,
			audioStreams: [],
			audioCodec: null,
			transcript: undefined
		},
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

test('Space activates a transcript word instead of the global playback shortcut', async () => {
	const toggle = vi.fn();
	const listener = (event: KeyboardEvent) => handleGlobalPlayPauseShortcut(event, 'space', toggle);
	window.addEventListener('keydown', listener, true);
	try {
		const screen = await render(TranscriptCutPanel, {
			source,
			segments: [{ id: 'kept', sourceId: source.id, start: 0, end: 10 }],
			currentTime: 0,
			onsave: vi.fn(),
			onseek: vi.fn(),
			onremove: vi.fn()
		});
		screen.getByRole('button', { name: 'Hello', exact: true }).element().focus();
		await userEvent.keyboard(' ');
		expect(toggle).not.toHaveBeenCalled();
		await expect
			.element(screen.getByRole('button', { name: 'Remove 1 words', exact: true }))
			.toBeEnabled();
	} finally {
		window.removeEventListener('keydown', listener, true);
	}
});

test('explains an empty successful transcript and retains that outcome when reopened', async () => {
	const file = new File(['owned transport fixture'], 'tone.wav', { type: 'audio/wav' });
	const input = { ...source, file, transcript: undefined };
	const collect = vi.spyOn(TranscriptionJob.prototype, 'collect').mockResolvedValueOnce([]);
	const onsave = vi.fn();
	try {
		const screen = await render(TranscriptCutPanel, {
			source: input,
			segments: [],
			currentTime: 0,
			onsave,
			onseek: vi.fn(),
			onremove: vi.fn()
		});
		await expect
			.element(
				screen.getByText(
					'No speech was found in this audio. Check the language or choose audio with speech, then try again.',
					{ exact: true }
				)
			)
			.not.toBeInTheDocument();
		screen.getByRole('button', { name: 'Create transcript', exact: true }).element().focus();
		await userEvent.keyboard('{Enter}');
		await vi.waitFor(() =>
			expect(onsave).toHaveBeenCalledExactlyOnceWith(source.id, { audioTrackIndex: 0, words: [] })
		);
		await screen.rerender({ source: { ...input, transcript: onsave.mock.calls[0]![1] } });
		await expect
			.element(screen.getByRole('status'))
			.toHaveTextContent(
				'No speech was found in this audio. Check the language or choose audio with speech, then try again.'
			);
		await expect
			.element(screen.getByRole('button', { name: 'Create transcript', exact: true }))
			.toBeEnabled();
		await screen.unmount();
		const reopened = await render(TranscriptCutPanel, {
			source: { ...input, transcript: onsave.mock.calls[0]![1] },
			segments: [],
			currentTime: 0,
			onsave,
			onseek: vi.fn(),
			onremove: vi.fn()
		});
		await expect
			.element(reopened.getByRole('status'))
			.toHaveTextContent('No speech was found in this audio.');
		await reopened.rerender({ source: { ...input, transcript: undefined } });
		await expect
			.element(
				reopened.getByText(
					'No speech was found in this audio. Check the language or choose audio with speech, then try again.',
					{ exact: true }
				)
			)
			.not.toBeInTheDocument();
	} finally {
		collect.mockRestore();
	}
});

test('does not report an empty successful result after transcription is cancelled', async () => {
	let finish!: (result: []) => void;
	const collect = vi.spyOn(TranscriptionJob.prototype, 'collect').mockImplementationOnce(
		() =>
			new Promise((resolve) => {
				finish = resolve;
			})
	);
	const onsave = vi.fn();
	try {
		const screen = await render(TranscriptCutPanel, {
			source: {
				...source,
				file: new File(['owned fixture'], 'tone.wav', { type: 'audio/wav' }),
				transcript: undefined
			},
			segments: [],
			currentTime: 0,
			onsave,
			onseek: vi.fn(),
			onremove: vi.fn()
		});
		await screen.getByRole('button', { name: 'Create transcript', exact: true }).click();
		await screen.getByRole('button', { name: 'Cancel transcription', exact: true }).click();
		finish([]);
		await expect
			.element(screen.getByRole('button', { name: 'Create transcript', exact: true }))
			.toBeEnabled();
		await expect
			.element(
				screen.getByText(
					'No speech was found in this audio. Check the language or choose audio with speech, then try again.',
					{ exact: true }
				)
			)
			.not.toBeInTheDocument();
		expect(onsave).not.toHaveBeenCalled();
	} finally {
		collect.mockRestore();
	}
});

test('explains audio deselection and clears the guidance when a source track is enabled again', async () => {
	let input = {
		...source,
		file: new File(['owned fixture'], 'interview.mp4', { type: 'video/mp4' }),
		transcript: undefined
	};
	const panel = await render(TranscriptCutPanel, {
		source: input,
		segments: [],
		currentTime: 0,
		onsave: vi.fn(),
		onseek: vi.fn(),
		onremove: vi.fn()
	});
	const selector = await render(StreamSelector, {
		source: input,
		onChange: async (patch) => {
			input = { ...input, ...patch };
			await selector.rerender({ source: input });
			await panel.rerender({ source: input });
		}
	});
	const audio = selector.getByRole('checkbox', { name: 'Audio 1 Interview.mp4', exact: true });
	await expect
		.element(panel.getByRole('button', { name: 'Create transcript', exact: true }))
		.toBeEnabled();
	audio.element().focus();
	await userEvent.keyboard(' ');
	await expect
		.element(panel.getByRole('button', { name: 'Create transcript', exact: true }))
		.toBeDisabled();
	await expect
		.element(panel.getByRole('status'))
		.toHaveTextContent(
			'No source audio is selected. Enable an audio track under Export → Video and audio tracks to create a transcript.'
		);
	await expect.element(audio).toHaveFocus();
	await userEvent.keyboard(' ');
	await expect
		.element(panel.getByRole('button', { name: 'Create transcript', exact: true }))
		.toBeEnabled();
	await expect
		.element(
			panel.getByText(
				'No source audio is selected. Enable an audio track under Export → Video and audio tracks to create a transcript.',
				{ exact: true }
			)
		)
		.not.toBeInTheDocument();
});

test('keeps the cached transcript target when another audio stream is retained and after portable reopen', async () => {
	let input: QuickCutSource = {
		...source,
		audioStreams: [
			{ index: 0, codec: 'aac', sampleRate: 48000, channels: 2 },
			{ index: 1, codec: 'aac', sampleRate: 22050, channels: 1 }
		],
		selectedAudioTrackIndices: [1],
		transcript: { ...source.transcript!, audioTrackIndex: 1 }
	};
	const onremove = vi.fn();
	const onsave = vi.fn();
	const props = {
		source: input,
		segments: [{ id: 'kept', sourceId: source.id, start: 0, end: 10 }],
		currentTime: 0,
		onsave,
		onseek: vi.fn(),
		onremove
	};
	const panel = await render(TranscriptCutPanel, props);
	const selector = await render(StreamSelector, {
		source: input,
		onChange: async (patch) => {
			input = { ...input, ...patch };
			await selector.rerender({ source: input });
			await panel.rerender({ source: input });
		}
	});
	await expect.element(panel.getByRole('button', { name: 'Hello', exact: true })).toBeVisible();
	const first = selector.getByRole('checkbox', { name: 'Audio 1 Interview.mp4', exact: true });
	first.element().focus();
	await userEvent.keyboard(' ');
	expect(input.selectedAudioTrackIndices).toEqual([0, 1]);
	await expect.element(first).toHaveFocus();
	await expect.element(panel.getByRole('button', { name: 'Hello', exact: true })).toBeVisible();
	await panel.getByRole('button', { name: 'again', exact: true }).click();
	await panel.getByRole('button', { name: 'Remove 1 words', exact: true }).click();
	expect(onremove).toHaveBeenCalledExactlyOnceWith('interview', [
		{ text: 'again', start: 1, end: 1.5 }
	]);
	expect(onsave).not.toHaveBeenCalled();
	const saved = serializeProject(createNewProject([input]));
	await panel.unmount();
	const reopened = parseProject(saved).sources[0]!;
	expect(reopened.selectedAudioTrackIndices).toEqual([0, 1]);
	expect(reopened.transcript?.audioTrackIndex).toBe(1);
	const cold = await render(TranscriptCutPanel, { ...props, source: reopened });
	await expect.element(cold.getByRole('button', { name: 'Hello', exact: true })).toBeVisible();
	const collect = vi.spyOn(TranscriptionJob.prototype, 'collect').mockResolvedValueOnce([]);
	const transcribe = vi.spyOn(BrowserTranscriber.prototype, 'transcribe');
	try {
		await cold.rerender({
			source: {
				...reopened,
				file: new File(['owned transport fixture'], 'interview.mp4', { type: 'video/mp4' })
			}
		});
		await cold.getByText('Create transcript', { exact: true }).first().click();
		await cold.getByRole('button', { name: 'Create transcript', exact: true }).click();
		expect(transcribe).toHaveBeenCalledWith(
			expect.any(File),
			expect.objectContaining({ audioTrackIndex: 1 })
		);
		await vi.waitFor(() =>
			expect(onsave).toHaveBeenCalledExactlyOnceWith('interview', { audioTrackIndex: 1, words: [] })
		);
	} finally {
		collect.mockRestore();
		transcribe.mockRestore();
	}
	await cold.rerender({ source: { ...reopened, selectedAudioTrackIndices: [0] } });
	await expect
		.element(cold.getByRole('button', { name: 'Hello', exact: true }))
		.not.toBeInTheDocument();
	await cold.rerender({ source: { ...reopened, selectedAudioTrackIndices: [] } });
	await expect
		.element(cold.getByRole('button', { name: 'Create transcript', exact: true }))
		.toBeDisabled();
	await cold.rerender({ source: { ...reopened, selectedAudioTrackIndices: [1] } });
	await expect.element(cold.getByRole('button', { name: 'Hello', exact: true })).toBeVisible();
});
