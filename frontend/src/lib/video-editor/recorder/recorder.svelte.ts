// oxlint-disable anti-slop/no-runtime-typeof, anti-slop/require-safety-comment-for-type-assertion -- recorder boundary checks and MediaRecorder shape casts
/**
 * Screen capture recorder: separate screen / camera / microphone artifacts
 * with monotonic shared-timebase alignment, measured start offsets,
 * visible preflight/countdown/progress, and robust lifecycle.
 *
 * Each selected source records into its own MediaRecorder so the timeline
 * can place them as independent clips with correct sync. No compositing.
 */

import { createLogger } from '../workspace-fs/logger';
import {
	estimateBytesPerMinute as estimateBytesPerMinutePure,
	formatBytes as formatBytesPure,
	mapRecorderError as mapRecorderErrorPure,
	pickAudioMimeType as pickAudioMimeTypePure,
	pickVideoMimeType as pickVideoMimeTypePure,
	recorderErrorMessage as recorderErrorMessagePure,
	recorderMimeType as recorderMimeTypePure,
	type RecorderErrorCode as RecorderErrorCodePure
} from './record-mime';

const logger = createLogger('ScreenCaptureRecorder');

export type RecorderKind = 'screen' | 'camera' | 'microphone';

export type RecorderSource = 'screen' | 'camera' | 'audio' | 'screen-camera';

export interface RecorderSelection {
	screen: boolean;
	camera: boolean;
	microphone: boolean;
}

export interface RecorderStartOptions {
	cameraDeviceId?: string | null;
	microphoneDeviceId?: string | null;
	includeSystemAudio?: boolean;
	countdownSeconds?: number;
}

export interface RecorderDeviceLists {
	cameras: MediaDeviceInfo[];
	microphones: MediaDeviceInfo[];
}

export type RecorderStatus =
	| 'idle'
	| 'requesting'
	| 'countdown'
	| 'recording'
	| 'stopping'
	| 'error';

export type RecorderErrorCode = RecorderErrorCodePure;

export interface CaptureArtifact {
	kind: RecorderKind;
	blob: Blob;
	mimeType: string;
	durationMs: number;
	startOffsetMs: number;
	sizeBytes: number;
}

export interface RecorderSnapshot {
	status: RecorderStatus;
	selection: RecorderSelection | null;
	elapsedMs: number;
	countdownRemaining: number | null;
	artifacts: CaptureArtifact[];
	error: RecorderErrorCode | null;
	errorMessage: string | null;
	counters: Record<RecorderKind, { chunks: number; bytes: number }>;
	hasPreview: boolean;
}

const COUNTDOWN_TICK_MS = 1000;
const STOP_TIMEOUT_MS = 4000;

export const pickVideoMimeType = pickVideoMimeTypePure;
export const pickAudioMimeType = pickAudioMimeTypePure;
export const recorderMimeType = recorderMimeTypePure;
export const mapRecorderError = mapRecorderErrorPure;
export const recorderErrorMessage = recorderErrorMessagePure;
export const estimateBytesPerMinute = estimateBytesPerMinutePure;
export const formatBytes = formatBytesPure;

export async function listRecorderDevices(): Promise<RecorderDeviceLists> {
	if (!navigator.mediaDevices?.enumerateDevices) return { cameras: [], microphones: [] };
	const devices = await navigator.mediaDevices.enumerateDevices();
	return {
		cameras: devices.filter((d) => d.kind === 'videoinput'),
		microphones: devices.filter((d) => d.kind === 'audioinput')
	};
}

export function hasRecorderSupport(selection: RecorderSelection): boolean {
	if (typeof navigator === 'undefined' || typeof MediaRecorder === 'undefined') return false;
	if (selection.screen && !navigator.mediaDevices?.getDisplayMedia) return false;
	if ((selection.camera || selection.microphone) && !navigator.mediaDevices?.getUserMedia)
		return false;
	if (selection.screen || selection.camera) return Boolean(pickVideoMimeType());
	if (selection.microphone) return Boolean(pickAudioMimeType());
	return false;
}

interface InternalRecorder {
	kind: RecorderKind;
	stream: MediaStream;
	recorder: MediaRecorder;
	chunks: Blob[];
	mimeType: string;
	startTimeMs: number | null;
	chunkCount: number;
	byteCount: number;
	stopPromise: Promise<void> | null;
}

function selectionFromLegacy(source: RecorderSource): RecorderSelection {
	switch (source) {
		case 'screen':
			return { screen: true, camera: false, microphone: false };
		case 'camera':
			return { screen: false, camera: true, microphone: false };
		case 'audio':
			return { screen: false, camera: false, microphone: true };
		case 'screen-camera':
			return { screen: true, camera: true, microphone: true };
		default:
			return { screen: false, camera: false, microphone: false };
	}
}

export class ScreenCaptureRecorder {
	status = $state<RecorderStatus>('idle');
	selection = $state<RecorderSelection | null>(null);
	elapsedMs = $state(0);
	countdownRemaining = $state<number | null>(null);
	error = $state<RecorderErrorCode | null>(null);
	errorMessage = $state<string | null>(null);
	lastArtifacts = $state<CaptureArtifact[]>([]);
	counters = $state<Record<RecorderKind, { chunks: number; bytes: number }>>({
		screen: { chunks: 0, bytes: 0 },
		camera: { chunks: 0, bytes: 0 },
		microphone: { chunks: 0, bytes: 0 }
	});
	// Preview streams for UI
	screenStream = $state<MediaStream | null>(null);
	cameraStream = $state<MediaStream | null>(null);
	micStream = $state<MediaStream | null>(null);

	private internal: InternalRecorder[] = [];
	private timer: ReturnType<typeof setInterval> | null = null;
	private countdownTimer: ReturnType<typeof setInterval> | null = null;
	private countdownReject: ((error: Error) => void) | null = null;
	private startMonotonic: number | null = null;
	private generation = 0;
	private stopGeneration = 0;
	private leakedTracks: MediaStreamTrack[] = [];

	get recording(): boolean {
		return (
			this.status === 'recording' || this.status === 'countdown' || this.status === 'requesting'
		);
	}

	get hasPreview(): boolean {
		return Boolean(this.screenStream || this.cameraStream || this.micStream);
	}

	get snapshot(): RecorderSnapshot {
		return {
			status: this.status,
			selection: this.selection,
			elapsedMs: this.elapsedMs,
			countdownRemaining: this.countdownRemaining,
			artifacts: this.lastArtifacts,
			error: this.error,
			errorMessage: this.errorMessage,
			counters: $state.snapshot(this.counters),
			hasPreview: this.hasPreview
		};
	}

	/** Legacy compat: start(source, options) */
	async start(
		sourceOrSelection: RecorderSource | RecorderSelection,
		options: RecorderStartOptions & {
			cameraId?: string;
			micId?: string;
			systemAudio?: boolean;
		} = {}
	): Promise<void> {
		let selection: RecorderSelection;
		if (typeof sourceOrSelection === 'string') {
			selection = selectionFromLegacy(sourceOrSelection);
			// Map legacy options
			const mapped: RecorderStartOptions = {
				cameraDeviceId: options.cameraId ?? options.cameraDeviceId ?? null,
				microphoneDeviceId: options.micId ?? options.microphoneDeviceId ?? null,
				includeSystemAudio: options.systemAudio ?? options.includeSystemAudio,
				countdownSeconds: options.countdownSeconds
			};
			return this.startWithSelection(selection, mapped);
		}
		return this.startWithSelection(sourceOrSelection, options);
	}

	async startWithSelection(
		selection: RecorderSelection,
		options: RecorderStartOptions = {}
	): Promise<void> {
		if (this.status !== 'idle' && this.status !== 'error') throw new Error('Already active');
		if (!selection.screen && !selection.camera && !selection.microphone) {
			this.setError('start-failed', 'Select at least one source.');
			throw new Error('Select at least one source');
		}
		const includeVideo = selection.screen || selection.camera;
		const mimeOk = includeVideo ? pickVideoMimeType() : pickAudioMimeType();
		if (!mimeOk) {
			this.setError('unsupported', recorderErrorMessage('unsupported'));
			throw new Error('No supported MIME type');
		}
		if (!hasRecorderSupport(selection)) {
			this.setError('unsupported', recorderErrorMessage('unsupported'));
			throw new Error('Unsupported');
		}
		const generation = ++this.generation;
		this.clearError();
		this.lastArtifacts = [];
		this.resetCounters();
		this.status = 'requesting';
		this.selection = selection;
		this.elapsedMs = 0;
		this.countdownRemaining = null;

		let screenStream: MediaStream | null = null;
		let cameraStream: MediaStream | null = null;
		let micStream: MediaStream | null = null;
		let previewScreen: MediaStream | null = null;
		let previewCamera: MediaStream | null = null;
		let previewMic: MediaStream | null = null;

		try {
			if (selection.screen) {
				screenStream = await navigator.mediaDevices.getDisplayMedia({
					video: { cursor: 'always' } as MediaTrackConstraints,
					audio: options.includeSystemAudio !== false
				});
				previewScreen = screenStream;
				// Auto-stop when user clicks browser stop sharing
				screenStream.getVideoTracks()[0]?.addEventListener('ended', () => {
					if (this.generation === generation && this.status === 'recording') {
						void this.stop().catch(() => undefined);
					}
				});
			}
			if (selection.camera) {
				const deviceId = options.cameraDeviceId ?? null;
				cameraStream = await navigator.mediaDevices.getUserMedia({
					video: deviceId ? { deviceId: { exact: deviceId } } : true,
					audio: false
				});
				previewCamera = cameraStream;
			}
			if (selection.microphone) {
				const deviceId = options.microphoneDeviceId ?? null;
				micStream = await navigator.mediaDevices.getUserMedia({
					audio: deviceId ? { deviceId: { exact: deviceId } } : true,
					video: false
				});
				previewMic = micStream;
			}
		} catch (error) {
			for (const s of [screenStream, cameraStream, micStream]) {
				for (const t of s?.getTracks() ?? []) t.stop();
			}
			if (generation === this.generation) {
				const code = mapRecorderError(error);
				this.setError(code, error instanceof Error ? error.message : String(error));
				this.status = 'error';
			}
			throw error;
		}

		if (generation !== this.generation) {
			for (const s of [screenStream, cameraStream, micStream]) {
				for (const t of s?.getTracks() ?? []) t.stop();
			}
			return;
		}

		this.screenStream = previewScreen;
		this.cameraStream = previewCamera;
		this.micStream = previewMic;

		const countdown = options.countdownSeconds ?? 0;
		if (countdown > 0) {
			this.status = 'countdown';
			this.countdownRemaining = countdown;
			try {
				await this.runCountdown(countdown, generation);
			} catch (error) {
				// Cancelled during countdown
				this.cleanupStreams([screenStream, cameraStream, micStream]);
				this.clearPreview();
				if (generation === this.generation) {
					this.status = 'idle';
					this.countdownRemaining = null;
				}
				throw error;
			}
			if (generation !== this.generation) {
				this.cleanupStreams([screenStream, cameraStream, micStream]);
				return;
			}
		}

		// Create MediaRecorders - one per kind, separate artifacts
		const toCreate: Array<{ kind: RecorderKind; stream: MediaStream; mime: string }> = [];
		if (screenStream)
			toCreate.push({ kind: 'screen', stream: screenStream, mime: pickVideoMimeType() });
		if (cameraStream)
			toCreate.push({ kind: 'camera', stream: cameraStream, mime: pickVideoMimeType() });
		if (micStream)
			toCreate.push({ kind: 'microphone', stream: micStream, mime: pickAudioMimeType() });

		// Build internal recorders, listen for dataavailable
		this.internal = toCreate.map(({ kind, stream, mime }) => {
			const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
			const actualMime = (recorder.mimeType || mime || '').trim();
			const entry: InternalRecorder = {
				kind,
				stream,
				recorder,
				chunks: [],
				mimeType: actualMime || mime,
				startTimeMs: null,
				chunkCount: 0,
				byteCount: 0,
				stopPromise: null
			};
			recorder.addEventListener('dataavailable', (event: BlobEvent) => {
				if (event.data.size === 0) return;
				entry.chunks.push(event.data);
				entry.chunkCount += 1;
				entry.byteCount += event.data.size;
				this.counters[kind] = { chunks: entry.chunkCount, bytes: entry.byteCount };
			});
			recorder.addEventListener('error', (event: Event) => {
				// SAFETY: error may be DOMException
				const err = (event as Event & { error?: DOMException }).error;
				logger.warn(`MediaRecorder error (${kind})`, err);
				this.setError(mapRecorderError(err ?? new Error('Recorder failed')), err?.message);
			});
			return entry;
		});

		// Start all recorders and capture monotonic start offsets
		const startPromises = this.internal.map(
			(entry) =>
				new Promise<void>((resolve, reject) => {
					const onStart = () => {
						entry.recorder.removeEventListener('error', onError);
						entry.startTimeMs = performance.now();
						resolve();
					};
					const onError = (event: Event) => {
						entry.recorder.removeEventListener('start', onStart);
						const err =
							(event as Event & { error?: DOMException }).error ?? new Error('Start failed');
						reject(err);
					};
					entry.recorder.addEventListener('start', onStart, { once: true });
					entry.recorder.addEventListener('error', onError, { once: true });
					try {
						entry.recorder.start(1000);
					} catch (error) {
						entry.recorder.removeEventListener('start', onStart);
						entry.recorder.removeEventListener('error', onError);
						reject(error);
					}
				})
		);

		try {
			await Promise.all(startPromises);
		} catch (error) {
			// Partial start - rollback already started recorders
			for (const entry of this.internal) {
				try {
					if (entry.recorder.state !== 'inactive') entry.recorder.stop();
				} catch {
					// ignore
				}
				for (const track of entry.stream.getTracks()) track.stop();
			}
			this.internal = [];
			this.clearPreview();
			if (generation === this.generation) {
				const code = mapRecorderError(error);
				this.setError(code, error instanceof Error ? error.message : String(error));
				this.status = 'error';
			}
			throw error;
		}

		if (generation !== this.generation) {
			for (const entry of this.internal) {
				try {
					if (entry.recorder.state !== 'inactive') entry.recorder.stop();
				} catch {
					// ignore
				}
				for (const track of entry.stream.getTracks()) track.stop();
			}
			this.internal = [];
			this.clearPreview();
			return;
		}

		this.status = 'recording';
		this.countdownRemaining = null;
		const startTimesForMonotonic = this.internal
			.map((e) => e.startTimeMs)
			.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
		this.startMonotonic =
			startTimesForMonotonic.length > 0 ? Math.min(...startTimesForMonotonic) : performance.now();
		this.startElapsedTimer();
	}

	private runCountdown(seconds: number, generation: number): Promise<void> {
		return new Promise<void>((resolve, reject) => {
			this.countdownReject = reject;
			let remaining = seconds;
			this.countdownRemaining = remaining;
			this.countdownTimer = setInterval(() => {
				if (generation !== this.generation) {
					if (this.countdownTimer) clearInterval(this.countdownTimer);
					this.countdownTimer = null;
					this.countdownReject = null;
					reject(new Error('Cancelled'));
					return;
				}
				remaining -= 1;
				this.countdownRemaining = remaining;
				if (remaining <= 0) {
					if (this.countdownTimer) clearInterval(this.countdownTimer);
					this.countdownTimer = null;
					this.countdownReject = null;
					resolve();
				}
			}, COUNTDOWN_TICK_MS);
		});
	}

	private startElapsedTimer(): void {
		this.stopElapsedTimer();
		this.timer = setInterval(() => {
			if (this.startMonotonic !== null) {
				this.elapsedMs = Math.max(0, Math.round(performance.now() - this.startMonotonic));
			}
		}, 100);
	}

	private stopElapsedTimer(): void {
		if (this.timer) clearInterval(this.timer);
		this.timer = null;
	}

	private stopCountdownTimer(): void {
		if (this.countdownTimer) clearInterval(this.countdownTimer);
		this.countdownTimer = null;
		this.countdownReject = null;
	}

	private resetCounters(): void {
		this.counters = {
			screen: { chunks: 0, bytes: 0 },
			camera: { chunks: 0, bytes: 0 },
			microphone: { chunks: 0, bytes: 0 }
		};
	}

	private setError(code: RecorderErrorCode, message?: string): void {
		this.error = code;
		this.errorMessage = message ?? recorderErrorMessage(code);
	}

	private clearError(): void {
		this.error = null;
		this.errorMessage = null;
	}

	private clearPreview(): void {
		this.screenStream = null;
		this.cameraStream = null;
		this.micStream = null;
	}

	private cleanupStreams(streams: Array<MediaStream | null>): void {
		for (const s of streams) {
			for (const t of s?.getTracks() ?? []) t.stop();
		}
	}

	/**
	 * Stop all recorders, collect separate artifacts with measured offsets.
	 * Returns empty array if nothing was recorded. Preserves artifacts
	 * on late failure for recovery.
	 */
	async stop(): Promise<CaptureArtifact[]> {
		if (this.status === 'idle' || this.status === 'error') return [];
		if (this.status === 'countdown') {
			// Cancel countdown and cleanup
			this.stopCountdownTimer();
			this.generation += 1;
			for (const entry of this.internal) {
				for (const t of entry.stream.getTracks()) t.stop();
			}
			this.internal = [];
			this.clearPreview();
			this.stopElapsedTimer();
			this.status = 'idle';
			this.countdownRemaining = null;
			this.selection = null;
			return [];
		}
		if (this.status !== 'recording') {
			// Already stopping
			return [];
		}
		const generation = ++this.stopGeneration;
		this.status = 'stopping';
		this.stopElapsedTimer();
		this.stopCountdownTimer();

		const internal = [...this.internal];
		if (internal.length === 0) {
			this.clearPreview();
			this.status = 'idle';
			return [];
		}

		// Request final data then stop
		const stopPromises = internal.map(
			(entry) =>
				new Promise<void>((resolve) => {
					let timeout: ReturnType<typeof setTimeout> | null = null;
					const onStop = () => {
						if (timeout) clearTimeout(timeout);
						entry.recorder.removeEventListener('error', onError);
						resolve();
					};
					const onError = () => {
						if (timeout) clearTimeout(timeout);
						entry.recorder.removeEventListener('stop', onStop);
						// Mark error but still resolve to preserve chunks
						this.setError('device-busy', 'One recorder encountered an error');
						resolve();
					};
					entry.recorder.addEventListener('stop', onStop, { once: true });
					entry.recorder.addEventListener('error', onError, { once: true });
					timeout = setTimeout(() => {
						entry.recorder.removeEventListener('stop', onStop);
						entry.recorder.removeEventListener('error', onError);
						this.setError(
							'stop-timeout',
							'Stop timed out - data already written remains recoverable'
						);
						resolve();
					}, STOP_TIMEOUT_MS);
					try {
						try {
							entry.recorder.requestData();
						} catch {
							// requestData may not be supported
						}
						entry.recorder.stop();
					} catch (error) {
						if (timeout) clearTimeout(timeout);
						entry.recorder.removeEventListener('stop', onStop);
						entry.recorder.removeEventListener('error', onError);
						logger.warn('Recorder stop threw', error);
						resolve();
					}
				})
		);

		await Promise.all(stopPromises);

		if (generation !== this.stopGeneration) {
			// Superseded
			return [];
		}

		const elapsedAtStop = this.startMonotonic
			? Math.max(0, Math.round(performance.now() - this.startMonotonic))
			: this.elapsedMs;

		// Determine monotonic base - earliest startTimeMs
		const startTimes = internal
			.map((e) => e.startTimeMs)
			.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
		const baseTime = startTimes.length > 0 ? Math.min(...startTimes) : performance.now();

		const artifacts: CaptureArtifact[] = [];
		for (const entry of internal) {
			const blob = new Blob(entry.chunks, { type: entry.mimeType || 'video/webm' });
			const sizeBytes = blob.size;
			const startOffsetMs =
				entry.startTimeMs !== null && Number.isFinite(entry.startTimeMs)
					? Math.max(0, Math.round(entry.startTimeMs - baseTime))
					: 0;
			// Preserve even empty blobs as recoverable if they have chunks? But filter truly empty
			if (sizeBytes === 0 && entry.chunks.length === 0) continue;
			artifacts.push({
				kind: entry.kind,
				blob,
				mimeType: entry.mimeType || blob.type || 'video/webm',
				durationMs: elapsedAtStop - startOffsetMs,
				startOffsetMs,
				sizeBytes
			});
		}

		// Cleanup tracks regardless
		for (const entry of internal) {
			for (const track of entry.stream.getTracks()) track.stop();
		}
		this.internal = [];
		this.clearPreview();
		this.startMonotonic = null;

		// Preserve for recovery if we produced something
		if (artifacts.length > 0) {
			this.lastArtifacts = artifacts;
		}

		this.status = 'idle';
		this.selection = null;
		this.countdownRemaining = null;

		// If we got no artifacts but expected some, surface error
		if (artifacts.length === 0 && internal.length > 0) {
			this.setError('start-failed', 'No data was captured.');
		}

		return artifacts;
	}

	async cancel(): Promise<void> {
		this.generation += 1;
		this.stopGeneration += 1;
		this.stopElapsedTimer();
		const reject = this.countdownReject;
		this.stopCountdownTimer();
		if (reject) reject(new Error('Cancelled'));
		this.countdownRemaining = null;
		for (const entry of this.internal) {
			try {
				if (entry.recorder.state !== 'inactive') entry.recorder.stop();
			} catch {
				// ignore
			}
			for (const track of entry.stream.getTracks()) track.stop();
		}
		this.internal = [];
		this.clearPreview();
		this.startMonotonic = null;
		this.status = 'idle';
		this.selection = null;
		this.elapsedMs = 0;
		this.resetCounters();
		this.clearError();
		// Do not clear lastArtifacts - preserve recoverable if needed by caller
	}

	clearRecoverable(): void {
		this.lastArtifacts = [];
	}

	// Exposed for UI: preview combined? For separate previews caller uses screenStream/cameraStream directly
	get stream(): MediaStream | null {
		// Compat: return screen stream if present else camera else mic
		return this.screenStream ?? this.cameraStream ?? this.micStream;
	}

	// Compat getters
	get elapsedSeconds(): number {
		return Math.floor(this.elapsedMs / 1000);
	}

	get usesCompositing(): boolean {
		return false;
	}

	// Legacy stop compat returns first blob; new callers should use stop() -> artifacts
	legacyStop(): { blob: Blob; mimeType: string; seconds: number } | null {
		const first = this.lastArtifacts[0];
		if (!first) return null;
		return {
			blob: first.blob,
			mimeType: first.mimeType,
			seconds: Math.round(first.durationMs / 1000)
		};
	}
}

/** Singleton used by /record and editor */
export const recorder = new ScreenCaptureRecorder();

/** Back-compat alias used by old /record page */
export const RecorderSession = ScreenCaptureRecorder;

export type StopResult = CaptureArtifact[];
