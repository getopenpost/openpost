import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import type { MediaMetadata } from '../media/types';
import TimelineVoiceoverControl from '../components/timeline-voiceover-control.svelte';
import TimelineVoiceoverOverlay from '../components/timeline-voiceover-overlay.svelte';
import * as micModule from './mic-recorder';
import * as importModule from '../media/import.svelte';
import * as insertModule from '../local-ai/insert-generated-audio';

const mocks = {
	start: vi.fn(),
	pause: vi.fn(),
	resume: vi.fn(),
	stop: vi.fn(),
	cancel: vi.fn(),
	elapsedMs: vi.fn(() => 500),
	importRecordedAudio: vi.fn(),
	insertVoiceover: vi.fn(() => 'voiceover-item'),
	// SAFETY: empty device list stub is typed as MediaDeviceInfo[] for enumeration.
	enumerateMicrophones: vi.fn(async () => [] as MediaDeviceInfo[]),
	startMonitor: vi.fn()
};

import { editorSession } from '../editor.svelte';
import { previewPlaybackSettings } from '../preview/playback-settings.svelte';
import { timelineStore } from '../timeline/stores/timeline-store.svelte';
import { voiceoverRecorder } from './voiceover-recorder.svelte';

const recordedMedia: MediaMetadata = {
	id: 'recorded-media',
	storageType: 'workspace',
	fileName: 'voiceover.webm',
	fileSize: 128,
	mimeType: 'audio/webm',
	duration: 1.5,
	width: 0,
	height: 0,
	fps: 0,
	codec: 'opus',
	bitrate: 96_000,
	tags: ['audio', 'recorded', 'voiceover']
};

function setProject(id: string): void {
	// SAFETY: project stub provides the minimal shape consumed by voiceover recorder (id + metadata).
	editorSession.project = {
		id,
		metadata: { width: 1920, height: 1080, fps: 30 }
	} as NonNullable<typeof editorSession.project>;
}

describe('voiceoverRecorder', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.start.mockResolvedValue(undefined);
		mocks.stop.mockResolvedValue({
			blob: new Blob(['voiceover'], { type: 'audio/webm;codecs=opus' }),
			mimeType: 'audio/webm;codecs=opus',
			durationMs: 1_500
		});
		mocks.importRecordedAudio.mockResolvedValue(recordedMedia);
		mocks.startMonitor.mockResolvedValue({ stop: vi.fn() });
		// SAFETY: test fakes replace MicRecorder with a minimal stub implementing the recorder surface.
		vi.spyOn(micModule, 'MicRecorder').mockImplementation(
			() =>
				({
					start: mocks.start,
					pause: mocks.pause,
					resume: mocks.resume,
					stop: mocks.stop,
					cancel: mocks.cancel,
					elapsedMs: mocks.elapsedMs
				}) as micModule.MicRecorder
		);
		vi.spyOn(micModule, 'createBestEffortAudioContext').mockReturnValue(null);
		// SAFETY: enumerateMicrophones stub returns empty device list for voiceover tests.
		vi.spyOn(micModule, 'enumerateMicrophones').mockImplementation(mocks.enumerateMicrophones as typeof micModule.enumerateMicrophones);
		vi.spyOn(micModule, 'hasMicRecordingSupport').mockReturnValue(true);
		vi.spyOn(micModule, 'micRecordingExtension').mockReturnValue('webm');
		// SAFETY: startMicLevelMonitor stub returns a no-op monitor handle for test isolation.
		vi.spyOn(micModule, 'startMicLevelMonitor').mockImplementation(mocks.startMonitor as typeof micModule.startMicLevelMonitor);
		// SAFETY: importRecordedAudio stub returns fixed recorded media for deterministic insert.
		vi.spyOn(importModule, 'importRecordedAudio').mockImplementation(mocks.importRecordedAudio as typeof importModule.importRecordedAudio);
		// SAFETY: insertVoiceover stub returns a fixed item id for transport assertions.
		vi.spyOn(insertModule, 'insertVoiceoverOnNewTrack').mockImplementation(mocks.insertVoiceover as typeof insertModule.insertVoiceoverOnNewTrack);
		voiceoverRecorder.__resetForTesting();
		voiceoverRecorder.setMuteTimeline(true);
		voiceoverRecorder.setSyncOffsetMs(0);
		previewPlaybackSettings.setMuted(false);
		timelineStore.__resetForTesting();
		timelineStore.setAll({ fps: 30 });
		timelineStore._setCurrentFrame(45);
		setProject('project-1');
		vi.stubGlobal('AudioContext', undefined);
	});

	afterEach(() => {
		voiceoverRecorder.__resetForTesting();
		editorSession.project = null;
		timelineStore.__resetForTesting();
		previewPlaybackSettings.setMuted(false);
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
	});

	it('keeps capture and transport in lockstep, then inserts one synced take', async () => {
		const startPlayback = vi.spyOn(editorSession, 'startPlayback').mockImplementation(() => {});
		const pausePlayback = vi.spyOn(editorSession, 'pausePlayback').mockImplementation(() => {});
		const scheduleAutosave = vi
			.spyOn(editorSession, 'scheduleAutosave')
			.mockImplementation(() => {});
		const inserted = vi.fn();
		const unsubscribe = voiceoverRecorder.onInserted(inserted);

		await voiceoverRecorder.start('project-1', 'Voiceover');

		expect(mocks.start).toHaveBeenCalledWith(
			expect.objectContaining({ noiseSuppression: true, autoGainControl: true })
		);
		expect(voiceoverRecorder.status).toBe('recording');
		expect(voiceoverRecorder.recordStartFrame).toBe(45);
		expect(timelineStore.seekLocked).toBe(true);
		expect(previewPlaybackSettings.muted).toBe(true);
		expect(startPlayback).toHaveBeenCalledOnce();
		timelineStore._setCurrentFrame(60);
		const overlay = await render(TimelineVoiceoverOverlay, {
			timelineX: (frame: number) => frame * 2,
			pixelsPerFrame: 2
		});
		const overlayRoot = overlay.container.querySelector<HTMLElement>('[data-voiceover-overlay]');
		// SAFETY: firstElementChild of the voiceover overlay is the live range div when rendered.
		const liveRange = overlayRoot?.firstElementChild as HTMLElement | null;
		expect(liveRange?.style.left).toBe('90px');
		expect(liveRange?.style.width).toBe('30px');

		voiceoverRecorder.pause();
		expect(mocks.pause).toHaveBeenCalledOnce();
		expect(pausePlayback).toHaveBeenCalledOnce();
		expect(voiceoverRecorder.status).toBe('paused');

		voiceoverRecorder.resume();
		expect(mocks.resume).toHaveBeenCalledOnce();
		expect(startPlayback).toHaveBeenCalledTimes(2);
		voiceoverRecorder.setSyncOffsetMs(100);

		const itemId = await voiceoverRecorder.stop('project-1', 'Voiceover');

		expect(itemId).toBe('voiceover-item');
		expect(mocks.importRecordedAudio).toHaveBeenCalledWith(
			expect.objectContaining({ name: expect.stringMatching(/^voiceover-.*\.webm$/) }),
			{ projectId: 'project-1', duration: 1.5, tags: ['voiceover'] }
		);
		expect(mocks.insertVoiceover).toHaveBeenCalledWith(recordedMedia, 48, 'Voiceover');
		expect(inserted).toHaveBeenCalledWith('voiceover-item');
		expect(scheduleAutosave).toHaveBeenCalledOnce();
		expect(timelineStore.seekLocked).toBe(false);
		expect(previewPlaybackSettings.muted).toBe(false);
		expect(voiceoverRecorder.status).toBe('idle');
		unsubscribe();
	});

	it('drops a permission result that resolves after the editor changes project', async () => {
		let releasePermission!: () => void;
		mocks.start.mockImplementation(
			() => new Promise<void>((resolve) => (releasePermission = resolve))
		);
		const startPlayback = vi.spyOn(editorSession, 'startPlayback').mockImplementation(() => {});

		const pending = voiceoverRecorder.start('project-1', 'Voiceover');
		setProject('project-2');
		releasePermission();
		await pending;

		expect(mocks.cancel).toHaveBeenCalledOnce();
		expect(startPlayback).not.toHaveBeenCalled();
		expect(timelineStore.seekLocked).toBe(false);
		expect(voiceoverRecorder.status).toBe('idle');
	});

	it('cancels an active take immediately when the editor changes project', async () => {
		vi.spyOn(editorSession, 'startPlayback').mockImplementation(() => {});
		vi.spyOn(editorSession, 'pausePlayback').mockImplementation(() => {});
		await voiceoverRecorder.start('project-1', 'Voiceover');
		expect(timelineStore.seekLocked).toBe(true);
		expect(previewPlaybackSettings.muted).toBe(true);

		voiceoverRecorder.reconcileProject('project-2');

		expect(mocks.cancel).toHaveBeenCalledOnce();
		expect(timelineStore.seekLocked).toBe(false);
		expect(previewPlaybackSettings.muted).toBe(false);
		expect(voiceoverRecorder.status).toBe('idle');
	});

	it('does not overwrite a user mute change when timeline muting is disabled', async () => {
		vi.spyOn(editorSession, 'startPlayback').mockImplementation(() => {});
		vi.spyOn(editorSession, 'pausePlayback').mockImplementation(() => {});
		voiceoverRecorder.setMuteTimeline(false);
		await voiceoverRecorder.start('project-1', 'Voiceover');
		previewPlaybackSettings.setMuted(true);

		voiceoverRecorder.cancel();

		expect(previewPlaybackSettings.muted).toBe(true);
	});

	it('finalizes the take when the main transport stops playback', async () => {
		await voiceoverRecorder.start('project-1', 'Voiceover');
		expect(editorSession.clock.isPlaying).toBe(true);

		editorSession.pausePlayback();

		await vi.waitFor(() => expect(mocks.importRecordedAudio).toHaveBeenCalledOnce());
		expect(mocks.insertVoiceover).toHaveBeenCalledWith(recordedMedia, 45, 'Voiceover');
		expect(timelineStore.seekLocked).toBe(false);
		expect(voiceoverRecorder.status).toBe('idle');
	});

	it('keeps setup compact and switches to clear live recording controls', async () => {
		vi.spyOn(editorSession, 'startPlayback').mockImplementation(() => {});
		vi.spyOn(editorSession, 'pausePlayback').mockImplementation(() => {});
		const screen = await render(TimelineVoiceoverControl, { projectId: 'project-1' });

		await expect.element(screen.getByRole('button', { name: 'Record voiceover' })).toBeVisible();
		await screen.getByRole('button', { name: 'Voiceover settings' }).click();
		await expect
			.element(screen.getByText('Choose the input and timing before you record.'))
			.toBeVisible();
		await expect.element(screen.getByText('Reduce background noise')).toBeVisible();
		await expect.element(screen.getByText('Keep voice level steady')).toBeVisible();
		await expect.element(screen.getByText('Mute timeline while recording')).toBeVisible();
		await screen.getByRole('button', { name: 'Move recorded audio later' }).click();
		await expect.element(screen.getByText('+10 ms')).toBeVisible();

		await screen.getByRole('button', { name: 'Record voiceover' }).click();
		await expect.element(screen.getByRole('group', { name: 'Voiceover recording' })).toBeVisible();
		await expect.element(screen.getByRole('button', { name: 'Pause voiceover' })).toBeVisible();
		await expect
			.element(screen.getByRole('button', { name: 'Stop and save voiceover' }))
			.toBeVisible();
		await expect.element(screen.getByRole('button', { name: 'Discard voiceover' })).toBeVisible();
	});
});
