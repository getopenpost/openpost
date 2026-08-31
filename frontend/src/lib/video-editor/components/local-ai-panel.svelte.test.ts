import { beforeEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import type { MediaMetadata } from '$lib/video-editor/media/types';
import type { GeneratedAudio } from '$lib/video-editor/local-ai/types';
import type { LocalTtsGenerateOptions } from '$lib/video-editor/local-ai/tts/registry';
import { timelineStore } from '$lib/video-editor/timeline/stores/timeline-store.svelte';
import { mediaTaskId, mediaTasks } from '$lib/video-editor/media/media-tasks.svelte';
import { LOCAL_TTS_ENGINE_STORAGE_KEY } from '$lib/video-editor/local-ai/tts/preferences';
import LocalAiPanel from './local-ai-panel.svelte';
import '../../../routes/layout.css';

const generated: GeneratedAudio = {
	blob: new Blob([new Uint8Array(48)], { type: 'audio/wav' }),
	file: new File([new Uint8Array(48)], 'voice.wav', { type: 'audio/wav' }),
	duration: 2.4,
	sampleRate: 24_000
};

const media: MediaMetadata = {
	id: 'generated-media',
	storageType: 'workspace',
	fileName: 'voice.wav',
	fileSize: 48,
	mimeType: 'audio/wav',
	duration: 2.4,
	width: 0,
	height: 0,
	fps: 0,
	codec: '',
	bitrate: 160,
	tags: ['audio', 'ai-generated', 'tts']
};

beforeEach(() => {
	localStorage.removeItem(LOCAL_TTS_ENGINE_STORAGE_KEY);
	mediaTasks.reset();
	timelineStore.__resetForTesting();
	timelineStore.setAll({ fps: 30, currentFrame: 91 });
});

describe('LocalAiPanel', () => {
	it('fits the editor asset panel without horizontal overflow', async () => {
		await page.viewport(390, 844);
		const screen = await render(LocalAiPanel, {
			projectId: 'project-1',
			oninserted: vi.fn(),
			generateSpeech: vi.fn(async () => generated),
			commitAudio: vi.fn(),
			supported: true
		});
		screen.container.style.width = '260px';
		screen.container.style.height = '720px';
		screen.container.style.background = 'oklch(0.15 0.008 55)';

		await screen.getByRole('textbox', { name: 'Script' }).fill('A concise launch voiceover.');
		await screen.getByRole('button', { name: 'Generate voiceover', exact: true }).click();
		await page.screenshot({
			element: screen.container,
			path: '../../../../.svelte-kit/openpost-local-ai-panel.png'
		});

		expect(screen.container.scrollWidth).toBeLessThanOrEqual(screen.container.clientWidth);
		await expect
			.element(screen.getByRole('button', { name: 'Generate voiceover', exact: true }))
			.toBeVisible();
		await expect.element(screen.getByRole('button', { name: 'Models', exact: true })).toBeVisible();
		await expect
			.element(screen.getByRole('button', { name: 'Add at playhead', exact: true }))
			.toBeVisible();
	});

	it('generates a reviewable voiceover and reuses the saved media when inserting it', async () => {
		const generateSpeech = vi.fn(async (options: LocalTtsGenerateOptions) => {
			options.onProgress?.({
				stage: 'generating',
				message: 'Generating speech',
				progress: 0.5
			});
			return generated;
		});
		const commitAudio = vi
			.fn()
			.mockResolvedValueOnce({ media })
			.mockResolvedValueOnce({ media, itemId: 'voice-item' });
		const oninserted = vi.fn();
		const screen = await render(LocalAiPanel, {
			projectId: 'project-1',
			oninserted,
			generateSpeech,
			commitAudio,
			supported: true
		});

		await screen.getByRole('textbox', { name: 'Script' }).fill('A concise launch voiceover.');
		await screen.getByRole('button', { name: 'Generate voiceover' }).click();
		await expect.element(screen.getByText('2.4 seconds')).toBeVisible();
		expect(screen.container.querySelector('audio')).not.toBeNull();
		expect(generateSpeech).toHaveBeenCalledWith(
			expect.objectContaining({ text: 'A concise launch voiceover.', voice: 'af_heart', speed: 1 })
		);

		await screen.getByRole('button', { name: 'Save to media pool' }).click();
		await expect.element(screen.getByRole('button', { name: 'Saved' })).toBeDisabled();
		await screen.getByRole('button', { name: 'Add at playhead' }).click();

		expect(commitAudio).toHaveBeenLastCalledWith(
			generated,
			expect.objectContaining({
				projectId: 'project-1',
				existingMediaId: media.id,
				insertAtFrame: 91
			})
		);
		expect(oninserted).toHaveBeenCalledWith('voice-item');
	});

	it('prefills selected text and inserts aligned linked speech instead of using the playhead', async () => {
		const commitAudio = vi.fn().mockResolvedValue({ media, itemId: 'linked-voice' });
		const oninserted = vi.fn();
		const screen = await render(LocalAiPanel, {
			projectId: 'project-1',
			oninserted,
			generateSpeech: vi.fn(async () => generated),
			commitAudio,
			supported: true,
			textVoiceRequest: {
				id: 'request-1',
				sourceTextItemId: 'title-item',
				text: 'A linked launch line.'
			}
		});

		await expect
			.element(screen.getByRole('textbox', { name: 'Script' }))
			.toHaveValue('A linked launch line.');
		await expect
			.element(screen.getByText('Audio will start with and stay linked to this text item.'))
			.toBeVisible();
		await screen.getByRole('button', { name: 'Generate voiceover' }).click();
		await screen.getByRole('button', { name: 'Add and link' }).click();

		expect(commitAudio).toHaveBeenCalledWith(
			generated,
			expect.objectContaining({
				projectId: 'project-1',
				sourceTextItemId: 'title-item'
			})
		);
		expect(commitAudio.mock.calls[0]?.[1]).not.toHaveProperty('insertAtFrame');
		expect(oninserted).toHaveBeenCalledWith('linked-voice');

		screen.container.style.width = '260px';
		expect(screen.container.scrollWidth).toBeLessThanOrEqual(screen.container.clientWidth);
	});

	it('switches to Supertonic with its own voices and language selection', async () => {
		const generateSpeech = vi.fn(async () => generated);
		const screen = await render(LocalAiPanel, {
			projectId: 'project-1',
			oninserted: vi.fn(),
			generateSpeech,
			commitAudio: vi.fn(),
			supported: true
		});
		await screen.getByRole('button', { name: 'Engine', exact: true }).click();
		await screen.getByRole('option', { name: 'Supertonic' }).click();
		expect(localStorage.getItem(LOCAL_TTS_ENGINE_STORAGE_KEY)).toBe('supertonic');
		await expect.element(screen.getByRole('group', { name: 'Expressive tags' })).toBeVisible();
		const script = screen.getByRole('textbox', { name: 'Script' });
		await script.fill('A warm welcome.');
		// SAFETY: The Script role resolves the component's textarea.
		const textarea = script.element() as HTMLTextAreaElement;
		textarea.setSelectionRange(2, 2);
		await screen.getByRole('button', { name: 'Laugh', exact: true }).click();
		await expect.element(script).toHaveValue('A <laugh>warm welcome.');
		screen.container.style.width = '260px';
		await page.screenshot({
			element: screen.container,
			path: '../../../../.svelte-kit/openpost-supertonic-expressive-tags.png'
		});
		expect(screen.container.scrollWidth).toBeLessThanOrEqual(screen.container.clientWidth);
		await screen.getByRole('button', { name: 'Voice', exact: true }).click();
		await screen.getByRole('option', { name: /Lily/ }).click();
		await screen.getByRole('button', { name: 'Language', exact: true }).click();
		await screen.getByRole('option', { name: 'Portuguese' }).click();
		await screen.getByRole('textbox', { name: 'Script' }).fill('Uma locução local.');
		await screen.getByRole('button', { name: 'Generate voiceover' }).click();

		expect(generateSpeech).toHaveBeenCalledWith(
			expect.objectContaining({
				engine: 'supertonic',
				text: 'Uma locução local.',
				voice: 'F2',
				language: 'pt',
				speed: 1
			})
		);
	});

	it('keeps each generated preview linked to the text item that requested it', async () => {
		const commitAudio = vi.fn().mockResolvedValue({ media, itemId: 'linked-voice' });
		const screen = await render(LocalAiPanel, {
			projectId: 'project-1',
			oninserted: vi.fn(),
			generateSpeech: vi.fn(async () => generated),
			commitAudio,
			supported: true,
			textVoiceRequest: {
				id: 'request-1',
				sourceTextItemId: 'first-title',
				text: 'The first line.'
			}
		});

		await screen.getByRole('button', { name: 'Generate voiceover' }).click();
		await screen.rerender({
			projectId: 'project-1',
			oninserted: vi.fn(),
			generateSpeech: vi.fn(async () => generated),
			commitAudio,
			supported: true,
			textVoiceRequest: {
				id: 'request-2',
				sourceTextItemId: 'second-title',
				text: 'The second line.'
			}
		});
		await screen.getByRole('button', { name: 'Add and link' }).click();

		expect(commitAudio).toHaveBeenCalledWith(
			generated,
			expect.objectContaining({ sourceTextItemId: 'first-title' })
		);
	});

	it('offers MOSS multilingual voices and adjustable output speed', async () => {
		const generateSpeech = vi.fn(async () => generated);
		const screen = await render(LocalAiPanel, {
			projectId: 'project-1',
			oninserted: vi.fn(),
			generateSpeech,
			commitAudio: vi.fn(),
			supported: true
		});
		await screen.getByRole('button', { name: 'Engine', exact: true }).click();
		await screen.getByRole('option', { name: 'MOSS' }).click();
		await screen.getByRole('button', { name: 'Voice', exact: true }).click();
		await screen.getByRole('option', { name: 'Ava' }).click();
		const speedSlider = screen.getByRole('slider', { name: 'Speed' }).element();
		speedSlider.focus();
		for (let i = 0; i < 14; i++) {
			speedSlider.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
			speedSlider.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowRight', bubbles: true }));
		}
		await new Promise((r) => setTimeout(r, 50));
		await screen.getByRole('textbox', { name: 'Script' }).fill('A local multilingual voice.');
		await screen.getByRole('button', { name: 'Generate voiceover' }).click();

		expect(generateSpeech).toHaveBeenCalledWith(
			expect.objectContaining({
				engine: 'moss',
				text: 'A local multilingual voice.',
				voice: 'Ava',
				speed: 1.7
			})
		);
	});

	it('cancels an active generation through its abort signal', async () => {
		let receivedSignal: AbortSignal | undefined;
		const generateSpeech = vi.fn(
			(options: LocalTtsGenerateOptions) =>
				new Promise<GeneratedAudio>((_resolve, reject) => {
					receivedSignal = options.signal;
					options.onProgress?.({
						stage: 'downloading',
						message: 'Downloading voice model',
						progress: 0.25
					});
					options.signal?.addEventListener(
						'abort',
						() => reject(new DOMException('cancelled', 'AbortError')),
						{ once: true }
					);
				})
		);
		const screen = await render(LocalAiPanel, {
			projectId: 'project-1',
			oninserted: vi.fn(),
			generateSpeech,
			commitAudio: vi.fn(),
			supported: true
		});

		await screen.getByRole('textbox', { name: 'Script' }).fill('Cancel this.');
		await screen.getByRole('button', { name: 'Generate voiceover' }).click();
		const progress = screen.getByRole('progressbar', { name: 'Downloading voice model' }).element();
		expect(progress).toHaveAttribute('aria-valuenow', '25');
		const taskId = mediaTaskId('voice-generation', 'project-1');
		expect(mediaTasks.get(taskId)).toMatchObject({
			stage: 'downloading',
			progress: 0.25,
			cancellable: true
		});
		expect(mediaTasks.cancel(taskId)).toBe(true);

		expect(receivedSignal?.aborted).toBe(true);
		await expect.element(screen.getByRole('button', { name: 'Generate voiceover' })).toBeEnabled();
		expect(mediaTasks.get(taskId)).toBeUndefined();
	});
});
