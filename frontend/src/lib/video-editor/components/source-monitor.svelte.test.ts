import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import type { MediaMetadata } from '$lib/video-editor/media/types';
import { mediaPool } from '$lib/video-editor/media/pool.svelte';
import type { Project, TimelineTrack } from '$lib/video-editor/project/types';
import { editorSession } from '$lib/video-editor/editor.svelte';
import { commandHistory } from '$lib/video-editor/timeline/commands/command-store.svelte';
import { timelineStore } from '$lib/video-editor/timeline/stores/timeline-store.svelte';
import { setWorkspaceRoot } from '$lib/video-editor/workspace-fs/root';
import SourceMonitor from './source-monitor.svelte';
import proResFixtureUrl from '../media/fixtures/prores-proxy.mov?url';
import { clearWaveformCache } from '$lib/video-editor/media/waveform-client';
import { saveWaveform } from '$lib/video-editor/media/waveform-persistence';
import { keyboardShortcuts } from '$lib/video-editor/settings/keyboard-shortcuts.svelte';

const videoTrack: TimelineTrack = {
	id: 'video',
	name: 'Video 1',
	kind: 'video',
	height: 96,
	locked: false,
	visible: true,
	muted: false,
	solo: false,
	order: 0
};

const audioTrack: TimelineTrack = {
	id: 'audio',
	name: 'Audio 1',
	kind: 'audio',
	height: 72,
	locked: false,
	visible: true,
	muted: false,
	solo: false,
	volume: 1,
	order: 1
};

const source: MediaMetadata = {
	id: 'source',
	storageType: 'handle',
	fileName: 'interview.mp4',
	fileSize: 128,
	mimeType: 'video/mp4',
	duration: 10,
	width: 1920,
	height: 1080,
	fps: 30,
	codec: 'avc',
	bitrate: 1000,
	audioCodec: 'aac',
	tags: ['video']
};

function setRange(input: HTMLInputElement, value: number): void {
	input.value = String(value);
	input.dispatchEvent(new Event('input', { bubbles: true }));
}

function linkedFileHandle(name: string, getFile: () => Promise<File>): FileSystemFileHandle {
	const handle: FileSystemFileHandle = {
		kind: 'file',
		name,
		getFile,
		async createWritable() {
			throw new Error('This read-only test handle cannot write.');
		},
		async createSyncAccessHandle() {
			throw new Error('This read-only test handle cannot open synchronous access.');
		},
		async isSameEntry(other) {
			return other === handle;
		}
	};
	return handle;
}

beforeEach(() => {
	keyboardShortcuts.resetAll();
	commandHistory.clearHistory();
	mediaPool.clear();
	timelineStore.__resetForTesting();
	timelineStore.setAll({ tracks: [videoTrack, audioTrack], items: [], currentFrame: 20, fps: 30 });
	editorSession.clock.seek(20);
	editorSession.project = {
		id: 'project',
		name: 'Project',
		description: '',
		createdAt: 0,
		updatedAt: 0,
		duration: 0,
		metadata: { width: 1920, height: 1080, fps: 30, backgroundColor: '#000000' },
		timeline: { tracks: [videoTrack, audioTrack], items: [] }
	} satisfies Project;
	const file = new File([new Uint8Array(128)], source.fileName, { type: source.mimeType });
	mediaPool.upsert(
		{
			...source,
			// SAFETY: resolveMediaBlob only calls getFile on this linked test handle.
			fileHandle: { getFile: async () => file } as FileSystemFileHandle
		},
		'ready'
	);
	// SAFETY: linked media resolves before any directory method is used.
	setWorkspaceRoot({ name: 'test' } as FileSystemDirectoryHandle);
});

afterEach(() => {
	keyboardShortcuts.resetAll();
	mediaPool.clear();
	setWorkspaceRoot(null);
	vi.restoreAllMocks();
});

describe('SourceMonitor', () => {
	it('prepares a playable proxy while keeping original audio for a ProRes source', async () => {
		const response = await fetch(proResFixtureUrl);
		expect(response.ok).toBe(true);
		const fixture = await response.blob();
		const file = new File([fixture], 'prores-proxy.mov', { type: 'video/quicktime' });
		mediaPool.clear();
		mediaPool.upsert(
			{
				...source,
				fileName: file.name,
				fileSize: file.size,
				mimeType: file.type,
				duration: 0.125,
				width: 64,
				height: 36,
				fps: 24,
				codec: 'prores',
				videoCodecSupported: false,
				fileHandle: linkedFileHandle(file.name, async () => file)
			},
			'ready'
		);

		const screen = await render(SourceMonitor, {
			mediaId: source.id,
			onclose: vi.fn(),
			onedit: vi.fn()
		});
		await vi.waitFor(() => expect(screen.container.querySelector('video')?.src).toMatch(/^blob:/));

		const video = screen.container.querySelector('video')!;
		const originalAudio = screen.container.querySelector('audio')!;
		expect(originalAudio.src).toMatch(/^blob:/);
		expect(originalAudio.src).not.toBe(video.src);
		expect((await fetch(video.src)).headers.get('content-type')).toBe('video/webm');
	});

	it('marks an exclusive range and inserts linked video and audio at the program playhead', async () => {
		const onedit = vi.fn();
		const oninserted = vi.fn();
		const screen = await render(SourceMonitor, {
			mediaId: source.id,
			onclose: vi.fn(),
			onedit,
			oninserted
		});

		await expect.element(screen.getByText(source.fileName)).toBeVisible();
		const position = screen.getByLabelText('Source position').element();
		if (!(position instanceof HTMLInputElement))
			throw new Error('Source position is not a slider.');
		setRange(position, 30);
		await screen.getByRole('button', { name: 'Mark in' }).click();
		setRange(position, 59);
		await screen.getByRole('button', { name: 'Mark out' }).click();
		await screen.getByRole('button', { name: 'Insert edit ,' }).click();

		expect(timelineStore.currentFrame).toBe(50);
		expect(editorSession.clock.currentFrame).toBe(50);
		expect(timelineStore.items).toHaveLength(2);
		expect(
			timelineStore.items.map((item) => [item.type, item.sourceStart, item.sourceEnd])
		).toEqual([
			['video', 30, 60],
			['audio', 30, 60]
		]);
		expect(timelineStore.items[0]?.linkedGroupId).toBe(timelineStore.items[1]?.linkedGroupId);
		expect(oninserted).toHaveBeenCalledWith(timelineStore.items.map((item) => item.id));
		expect(onedit).toHaveBeenCalledOnce();
		expect(commandHistory.canUndo).toBe(true);
	});

	it('keeps every source control inside a narrow monitor', async () => {
		const screen = await render(SourceMonitor, {
			mediaId: source.id,
			onclose: vi.fn(),
			onedit: vi.fn()
		});
		screen.container.style.width = '320px';
		const monitor = screen.getByRole('region', { name: 'Source' }).element();
		if (!(monitor instanceof HTMLElement)) throw new Error('Source monitor region is missing.');
		expect(monitor.scrollWidth).toBeLessThanOrEqual(monitor.clientWidth);
	});

	it('owns J/K/L while focused and exposes each shuttle transition', async () => {
		vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
		vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(function () {
			queueMicrotask(() => this.dispatchEvent(new Event('pause')));
		});
		const screen = await render(SourceMonitor, {
			mediaId: source.id,
			onclose: vi.fn(),
			onedit: vi.fn()
		});
		const monitor = screen.getByRole('region', { name: 'Source' }).element();
		if (!(monitor instanceof HTMLElement)) throw new Error('Source monitor region is missing.');

		monitor.dispatchEvent(new KeyboardEvent('keydown', { key: 'l', code: 'KeyL', bubbles: true }));
		await expect.element(screen.getByLabelText('Forward shuttle 1×')).toBeVisible();
		monitor.dispatchEvent(new KeyboardEvent('keydown', { key: 'l', code: 'KeyL', bubbles: true }));
		await expect.element(screen.getByLabelText('Forward shuttle 2×')).toBeVisible();
		monitor.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', code: 'KeyJ', bubbles: true }));
		await expect.element(screen.getByLabelText('Reverse shuttle 1×')).toBeVisible();
		await new Promise((resolve) => queueMicrotask(resolve));
		await expect.element(screen.getByLabelText('Reverse shuttle 1×')).toBeVisible();
		monitor.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', code: 'KeyK', bubbles: true }));
		await expect
			.poll(() => screen.container.querySelector('[data-testid="shuttle-indicator"]'))
			.toBeNull();
	});

	it('replays the marked source range from its in point', async () => {
		const screen = await render(SourceMonitor, {
			mediaId: source.id,
			onclose: vi.fn(),
			onedit: vi.fn()
		});
		const position = screen.getByLabelText('Source position').element();
		if (!(position instanceof HTMLInputElement)) {
			throw new Error('Source position is not a slider.');
		}
		const replay = screen.getByRole('button', { name: 'Play in to out' });
		expect(replay.element()).toBeDisabled();
		setRange(position, 30);
		await screen.getByRole('button', { name: 'Mark in' }).click();
		setRange(position, 59);
		await screen.getByRole('button', { name: 'Mark out' }).click();

		await replay.click();

		expect(position.value).toBe('30');
		expect(replay.element()).toBeEnabled();
	});

	it('goes to the last source frame and honors remapped source edit shortcuts', async () => {
		keyboardShortcuts.setBinding('MARK_IN', 'alt+9');
		keyboardShortcuts.setBinding('MARK_OUT', 'alt+0');
		keyboardShortcuts.setBinding('INSERT_EDIT', 'alt+7');
		const screen = await render(SourceMonitor, {
			mediaId: source.id,
			onclose: vi.fn(),
			onedit: vi.fn()
		});
		const monitor = screen.getByRole('region', { name: 'Source' }).element();
		const position = screen.getByLabelText('Source position').element();
		if (!(monitor instanceof HTMLElement) || !(position instanceof HTMLInputElement)) {
			throw new Error('Source monitor controls are missing.');
		}

		await screen.getByRole('button', { name: 'Go to end' }).click();
		expect(position.value).toBe('299');

		setRange(position, 30);
		monitor.dispatchEvent(
			new KeyboardEvent('keydown', { code: 'Digit9', key: '9', altKey: true, bubbles: true })
		);
		setRange(position, 59);
		monitor.dispatchEvent(
			new KeyboardEvent('keydown', { code: 'Digit0', key: '0', altKey: true, bubbles: true })
		);
		monitor.dispatchEvent(
			new KeyboardEvent('keydown', { code: 'Digit7', key: '7', altKey: true, bubbles: true })
		);

		expect(
			timelineStore.items.map((item) => [item.type, item.sourceStart, item.sourceEnd])
		).toEqual([
			['video', 30, 60],
			['audio', 30, 60]
		]);
		expect(screen.getByRole('button', { name: 'Insert edit Alt+7' })).toBeDefined();
	});

	it('shows a seekable overview and detail waveform for audio sources', async () => {
		const mediaId = `source-audio-${crypto.randomUUID()}`;
		const audioFile = new File([new Uint8Array(256)], 'narration.wav', { type: 'audio/wav' });
		mediaPool.clear();
		mediaPool.upsert(
			{
				id: mediaId,
				storageType: 'handle',
				fileName: audioFile.name,
				fileSize: audioFile.size,
				mimeType: audioFile.type,
				duration: 10,
				width: 0,
				height: 0,
				fps: 0,
				codec: 'pcm_s16le',
				bitrate: 128_000,
				tags: ['audio'],
				fileHandle: linkedFileHandle(audioFile.name, async () => audioFile)
			},
			'ready'
		);
		await saveWaveform(mediaId, {
			peaks: Float32Array.from({ length: 5_000 }, (_, index) => (index % 250) / 250),
			durationSeconds: 10,
			samplesPerSecond: 500,
			loadedSamples: 5_000,
			isComplete: true
		});

		try {
			const screen = await render(SourceMonitor, {
				mediaId,
				onclose: vi.fn(),
				onedit: vi.fn()
			});
			screen.container.style.width = '320px';
			screen.container.style.height = '720px';
			const waveformSlider = screen.getByRole('slider', {
				name: 'Source audio waveform'
			});
			await expect.element(waveformSlider).toBeVisible();
			await vi.waitFor(() =>
				expect(waveformSlider.element().querySelector('canvas')).not.toBeNull()
			);

			waveformSlider
				.element()
				.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
			const position = screen.getByLabelText('Source position').element();
			if (!(position instanceof HTMLInputElement))
				throw new Error('Source position is not a slider.');
			await vi.waitFor(() => expect(position.value).toBe('299'));
			expect(screen.container.scrollWidth).toBeLessThanOrEqual(screen.container.clientWidth);
		} finally {
			await clearWaveformCache(mediaId);
		}
	});
});
