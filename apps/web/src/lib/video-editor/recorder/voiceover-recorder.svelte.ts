import { createLogger } from '../workspace-fs/logger';
import { editorSession } from '../editor.svelte';
import { importRecordedAudio } from '../media/import.svelte';
import { insertVoiceoverOnNewTrack } from '../local-ai/insert-generated-audio';
import { previewPlaybackSettings } from '../preview/playback-settings.svelte';
import { timelineStore } from '../timeline/stores/timeline-store.svelte';
import {
	MicRecorder,
	createBestEffortAudioContext,
	enumerateMicrophones,
	hasMicRecordingSupport,
	micRecordingExtension,
	startMicLevelMonitor,
	type MicMonitorHandle,
	type MicRecorderOptions,
	type MicRecorderResult
} from './mic-recorder';

const logger = createLogger('VoiceoverRecorder');
const STORAGE_KEY = 'openpost-video-editor-voiceover-v1';
const MAX_SYNC_OFFSET_MS = 1_000;

function hasLocalStorage(): boolean {
	return typeof localStorage !== 'undefined';
}

function isStringValue(value: unknown): value is string {
	return typeof value === 'string';
}

function isObjectValue(value: unknown): boolean {
	return typeof value === 'object' && value !== null;
}

export type VoiceoverStatus = 'idle' | 'requesting' | 'recording' | 'paused' | 'finalizing';
export type VoiceoverErrorCode =
	| 'unsupported'
	| 'permission-denied'
	| 'no-device'
	| 'device-busy'
	| 'start-failed'
	| 'empty-recording'
	| 'save-failed';

export interface VoiceoverRecorderDevice {
	start(options?: MicRecorderOptions): Promise<void>;
	pause(): void;
	resume(): void;
	stop(): Promise<MicRecorderResult>;
	cancel(): void;
	elapsedMs(): number;
}

export interface VoiceoverRecorderDependencies {
	createRecorder(): VoiceoverRecorderDevice;
	createAudioContext(): AudioContext | null;
	enumerateDevices(): Promise<MediaDeviceInfo[]>;
	isSupported(): boolean;
	recordingExtension(mimeType: string): string;
	startMonitor(options: MicRecorderOptions): Promise<MicMonitorHandle>;
	importAudio: typeof importRecordedAudio;
	insertOnNewTrack: typeof insertVoiceoverOnNewTrack;
}

const productionDependencies: VoiceoverRecorderDependencies = {
	createRecorder: () => new MicRecorder(),
	createAudioContext: createBestEffortAudioContext,
	enumerateDevices: enumerateMicrophones,
	isSupported: hasMicRecordingSupport,
	recordingExtension: micRecordingExtension,
	startMonitor: startMicLevelMonitor,
	importAudio: importRecordedAudio,
	insertOnNewTrack: insertVoiceoverOnNewTrack
};

let dependencies = productionDependencies;

interface StoredVoiceoverPreferences {
	selectedDeviceId?: string | null;
	noiseSuppression?: boolean;
	autoGainControl?: boolean;
	muteTimeline?: boolean;
	syncOffsetMs?: number;
}

function storedPreferences(): StoredVoiceoverPreferences {
	if (!hasLocalStorage()) return {};
	try {
		const value: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
		if (!isObjectValue(value)) return {};
		// SAFETY: StoredVoiceoverPreferences is an optional bag; any JSON object can be viewed through it before per-field validation below.
		return value as StoredVoiceoverPreferences;
	} catch {
		return {};
	}
}

function clampSyncOffset(value: number): number {
	if (!Number.isFinite(value)) return 0;
	return Math.max(-MAX_SYNC_OFFSET_MS, Math.min(MAX_SYNC_OFFSET_MS, Math.round(value)));
}

function errorCode(cause: unknown): VoiceoverErrorCode {
	const name = cause instanceof DOMException ? cause.name : '';
	if (name === 'NotAllowedError' || name === 'SecurityError') return 'permission-denied';
	if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'no-device';
	if (name === 'NotReadableError' || name === 'AbortError') return 'device-busy';
	return 'start-failed';
}

async function decodedDurationSeconds(result: MicRecorderResult): Promise<number> {
	if (result.blob.size === 0) return 0;
	const context = dependencies.createAudioContext();
	if (context) {
		try {
			const decoded = await context.decodeAudioData(await result.blob.arrayBuffer());
			if (Number.isFinite(decoded.duration) && decoded.duration > 0) return decoded.duration;
		} catch (error) {
			logger.warn('Could not decode microphone duration; using capture clock', error);
		} finally {
			void context.close().catch(() => undefined);
		}
	}
	return Math.max(0, result.durationMs / 1_000);
}

const stored = storedPreferences();
const state = $state({
	// SAFETY: 'idle' is a defined member of VoiceoverStatus.
	status: 'idle' as VoiceoverStatus,
	elapsedMs: 0,
	level: 0,
	// SAFETY: initial device list is empty and typed as MediaDeviceInfo[].
	devices: [] as MediaDeviceInfo[],
	selectedDeviceId:
		isStringValue(stored.selectedDeviceId) || stored.selectedDeviceId === null
			? stored.selectedDeviceId
			: null,
	noiseSuppression: stored.noiseSuppression ?? true,
	autoGainControl: stored.autoGainControl ?? true,
	muteTimeline: stored.muteTimeline ?? true,
	syncOffsetMs: clampSyncOffset(stored.syncOffsetMs ?? 0),
	recordStartFrame: 0,
	// SAFETY: initial error is absent; null is a member of VoiceoverErrorCode | null.
	error: null as VoiceoverErrorCode | null
});

function persistPreferences(): void {
	if (!hasLocalStorage()) return;
	localStorage.setItem(
		STORAGE_KEY,
		JSON.stringify({
			selectedDeviceId: state.selectedDeviceId,
			noiseSuppression: state.noiseSuppression,
			autoGainControl: state.autoGainControl,
			muteTimeline: state.muteTimeline,
			syncOffsetMs: state.syncOffsetMs
		})
	);
}

class VoiceoverRecorderController {
	private recorder: VoiceoverRecorderDevice | null = null;
	private monitor: MicMonitorHandle | null = null;
	private monitorGeneration = 0;
	private sessionGeneration = 0;
	private sessionProjectId: string | null = null;
	private elapsedTimer: ReturnType<typeof setInterval> | null = null;
	private clockUnsubscribers: Array<() => void> = [];
	private suppressClockEvents = false;
	private previousMonitorMuted: boolean | null = null;
	private stopPromise: Promise<string | null> | null = null;
	private insertionListeners = new Set<(itemId: string) => void>();
	private lastLevelUpdate = Number.NEGATIVE_INFINITY;

	get status(): VoiceoverStatus {
		return state.status;
	}

	get elapsedMs(): number {
		return state.elapsedMs;
	}

	get level(): number {
		return state.level;
	}

	get devices(): MediaDeviceInfo[] {
		return state.devices;
	}

	get selectedDeviceId(): string | null {
		return state.selectedDeviceId;
	}

	get noiseSuppression(): boolean {
		return state.noiseSuppression;
	}

	get autoGainControl(): boolean {
		return state.autoGainControl;
	}

	get muteTimeline(): boolean {
		return state.muteTimeline;
	}

	get syncOffsetMs(): number {
		return state.syncOffsetMs;
	}

	get recordStartFrame(): number {
		return state.recordStartFrame;
	}

	get error(): VoiceoverErrorCode | null {
		return state.error;
	}

	get active(): boolean {
		return state.status === 'recording' || state.status === 'paused';
	}

	get sessionOpen(): boolean {
		return state.status !== 'idle';
	}

	get supported(): boolean {
		return dependencies.isSupported();
	}

	clearError(): void {
		state.error = null;
	}

	setSelectedDeviceId(deviceId: string | null): void {
		state.selectedDeviceId = deviceId;
		persistPreferences();
		if (this.monitor) void this.restartMonitor();
	}

	setNoiseSuppression(enabled: boolean): void {
		state.noiseSuppression = enabled;
		persistPreferences();
		if (this.monitor) void this.restartMonitor();
	}

	setAutoGainControl(enabled: boolean): void {
		state.autoGainControl = enabled;
		persistPreferences();
		if (this.monitor) void this.restartMonitor();
	}

	setMuteTimeline(enabled: boolean): void {
		state.muteTimeline = enabled;
		persistPreferences();
	}

	setSyncOffsetMs(value: number): void {
		state.syncOffsetMs = clampSyncOffset(value);
		persistPreferences();
	}

	onInserted(listener: (itemId: string) => void): () => void {
		this.insertionListeners.add(listener);
		return () => this.insertionListeners.delete(listener);
	}

	reconcileProject(projectId: string): void {
		if (this.sessionProjectId && this.sessionProjectId !== projectId) this.cancel();
	}

	async refreshDevices(): Promise<void> {
		try {
			state.devices = await dependencies.enumerateDevices();
			if (
				state.selectedDeviceId &&
				!state.devices.some((device) => device.deviceId === state.selectedDeviceId)
			) {
				state.selectedDeviceId = null;
				persistPreferences();
			}
		} catch (error) {
			logger.warn('Could not enumerate microphones', error);
		}
	}

	async startMonitor(): Promise<void> {
		if (this.monitor || state.status !== 'idle' || !this.supported) return;
		const generation = ++this.monitorGeneration;
		try {
			const monitor = await dependencies.startMonitor({
				deviceId: state.selectedDeviceId ?? undefined,
				noiseSuppression: state.noiseSuppression,
				autoGainControl: state.autoGainControl,
				onLevel: (level) => this.updateLevel(level)
			});
			if (generation !== this.monitorGeneration || state.status !== 'idle') {
				monitor.stop();
				return;
			}
			this.monitor = monitor;
			void this.refreshDevices();
		} catch (error) {
			if (generation === this.monitorGeneration) state.error = errorCode(error);
		}
	}

	stopMonitor(): void {
		this.monitorGeneration += 1;
		this.monitor?.stop();
		this.monitor = null;
		state.level = 0;
	}

	private async restartMonitor(): Promise<void> {
		this.stopMonitor();
		await this.startMonitor();
	}

	async start(projectId: string, trackName: string): Promise<void> {
		if (state.status !== 'idle') return;
		if (!this.supported) {
			state.error = 'unsupported';
			return;
		}
		this.stopMonitor();
		state.error = null;
		state.status = 'requesting';
		const generation = ++this.sessionGeneration;
		this.sessionProjectId = projectId;
		let recorder = dependencies.createRecorder();
		this.recorder = recorder;
		try {
			await recorder.start(this.captureOptions());
		} catch (error) {
			recorder.cancel();
			if (
				error instanceof DOMException &&
				error.name === 'OverconstrainedError' &&
				state.selectedDeviceId
			) {
				state.selectedDeviceId = null;
				persistPreferences();
				recorder = dependencies.createRecorder();
				this.recorder = recorder;
				try {
					await recorder.start(this.captureOptions());
				} catch (fallbackError) {
					recorder.cancel();
					if (generation === this.sessionGeneration) {
						this.recorder = null;
						this.sessionProjectId = null;
						state.status = 'idle';
						state.error = errorCode(fallbackError);
					}
					return;
				}
			} else {
				if (generation === this.sessionGeneration) {
					this.recorder = null;
					this.sessionProjectId = null;
					state.status = 'idle';
					state.error = errorCode(error);
				}
				return;
			}
		}
		if (generation !== this.sessionGeneration || editorSession.project?.id !== projectId) {
			recorder.cancel();
			if (this.recorder === recorder) this.recorder = null;
			if (generation === this.sessionGeneration) this.resetTransientState();
			return;
		}
		void this.refreshDevices();
		this.applyMonitorMute();
		let anchor = timelineStore.currentFrame;
		if (anchor >= timelineStore.maxItemEndFrame && timelineStore.maxItemEndFrame > 0) {
			anchor = 0;
			editorSession.clock.seek(0);
		}
		state.recordStartFrame = anchor;
		state.elapsedMs = 0;
		state.status = 'recording';
		timelineStore._setSeekLocked(true);
		this.startElapsedTimer();
		this.watchClock(projectId, trackName);
		if (!editorSession.clock.isPlaying) {
			this.suppressClockEvents = true;
			editorSession.startPlayback({
				start: 0,
				end: Math.max(timelineStore.maxItemEndFrame, anchor + timelineStore.fps * 60 * 60),
				loop: false
			});
			this.suppressClockEvents = false;
		}
	}

	pause(): void {
		if (state.status !== 'recording' || !this.recorder) return;
		this.recorder.pause();
		this.suppressClockEvents = true;
		editorSession.pausePlayback();
		this.suppressClockEvents = false;
		this.stopElapsedTimer();
		state.elapsedMs = this.recorder.elapsedMs();
		state.status = 'paused';
	}

	resume(): void {
		if (state.status !== 'paused' || !this.recorder) return;
		this.recorder.resume();
		state.status = 'recording';
		this.suppressClockEvents = true;
		editorSession.startPlayback();
		this.suppressClockEvents = false;
		this.startElapsedTimer();
	}

	stop(projectId: string, trackName: string): Promise<string | null> {
		if (this.stopPromise) return this.stopPromise;
		if (!this.active || !this.recorder) return Promise.resolve(null);
		const promise = this.finish(projectId, trackName);
		this.stopPromise = promise;
		void promise.finally(() => {
			if (this.stopPromise === promise) this.stopPromise = null;
		});
		return promise;
	}

	private async finish(projectId: string, trackName: string): Promise<string | null> {
		const recorder = this.recorder;
		if (!recorder) return null;
		const anchor = state.recordStartFrame;
		const generation = this.sessionGeneration;
		this.recorder = null;
		this.unwatchClock();
		this.stopElapsedTimer();
		this.suppressClockEvents = true;
		editorSession.pausePlayback();
		this.suppressClockEvents = false;
		timelineStore._setSeekLocked(false);
		this.restoreMonitorMute();
		state.status = 'finalizing';
		try {
			const result = await recorder.stop();
			const duration = await decodedDurationSeconds(result);
			if (result.blob.size === 0 || duration <= 0) throw new Error('EMPTY_RECORDING');
			const extension = dependencies.recordingExtension(result.mimeType);
			const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
			const file = new File([result.blob], `voiceover-${stamp}.${extension}`, {
				type: result.mimeType,
				lastModified: Date.now()
			});
			const media = await dependencies.importAudio(file, {
				projectId,
				duration,
				tags: ['voiceover']
			});
			if (generation !== this.sessionGeneration || editorSession.project?.id !== projectId) {
				return null;
			}
			const from = Math.max(
				0,
				anchor + Math.round((state.syncOffsetMs / 1_000) * timelineStore.fps)
			);
			const itemId = dependencies.insertOnNewTrack(media, from, trackName);
			editorSession.scheduleAutosave();
			for (const listener of this.insertionListeners) listener(itemId);
			return itemId;
		} catch (error) {
			logger.error('Could not save voiceover take', error);
			if (generation === this.sessionGeneration) {
				state.error =
					error instanceof Error && error.message === 'EMPTY_RECORDING'
						? 'empty-recording'
						: 'save-failed';
			}
			return null;
		} finally {
			if (generation === this.sessionGeneration) this.resetTransientState();
		}
	}

	cancel(): void {
		this.sessionGeneration += 1;
		this.unwatchClock();
		this.stopElapsedTimer();
		this.suppressClockEvents = true;
		editorSession.pausePlayback();
		this.suppressClockEvents = false;
		this.recorder?.cancel();
		this.recorder = null;
		timelineStore._setSeekLocked(false);
		this.restoreMonitorMute();
		this.resetTransientState();
	}

	private captureOptions() {
		return {
			deviceId: state.selectedDeviceId ?? undefined,
			noiseSuppression: state.noiseSuppression,
			autoGainControl: state.autoGainControl,
			onLevel: (level: number) => this.updateLevel(level)
		};
	}

	private updateLevel(level: number): void {
		const now = performance.now();
		if (now - this.lastLevelUpdate < 40) return;
		this.lastLevelUpdate = now;
		state.level = Math.max(0, Math.min(1, level));
	}

	private applyMonitorMute(): void {
		if (!state.muteTimeline) {
			this.previousMonitorMuted = null;
			return;
		}
		this.previousMonitorMuted = previewPlaybackSettings.muted;
		previewPlaybackSettings.setMuted(true);
	}

	private restoreMonitorMute(): void {
		if (this.previousMonitorMuted === null) return;
		previewPlaybackSettings.setMuted(this.previousMonitorMuted);
		this.previousMonitorMuted = null;
	}

	private watchClock(projectId: string, trackName: string): void {
		this.unwatchClock();
		this.clockUnsubscribers = [
			editorSession.clock.on('pause', () => {
				if (!this.suppressClockEvents && state.status === 'recording') {
					void this.stop(projectId, trackName);
				}
			}),
			editorSession.clock.on('play', () => {
				if (!this.suppressClockEvents && state.status === 'paused') this.resume();
			})
		];
	}

	private unwatchClock(): void {
		for (const unsubscribe of this.clockUnsubscribers) unsubscribe();
		this.clockUnsubscribers = [];
	}

	private startElapsedTimer(): void {
		this.stopElapsedTimer();
		this.elapsedTimer = setInterval(() => {
			if (this.recorder) state.elapsedMs = this.recorder.elapsedMs();
		}, 100);
	}

	private stopElapsedTimer(): void {
		if (this.elapsedTimer) clearInterval(this.elapsedTimer);
		this.elapsedTimer = null;
	}

	private resetTransientState(): void {
		this.sessionProjectId = null;
		state.status = 'idle';
		state.elapsedMs = 0;
		state.level = 0;
		state.recordStartFrame = 0;
	}

	__resetForTesting(): void {
		this.cancel();
		this.stopMonitor();
		state.error = null;
		dependencies = productionDependencies;
	}

	__setDependenciesForTesting(next: VoiceoverRecorderDependencies): void {
		dependencies = next;
	}
}

export const voiceoverRecorder = new VoiceoverRecorderController();
