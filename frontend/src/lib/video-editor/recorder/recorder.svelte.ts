/**
 * Screen capture recorder: separate screen / camera / microphone artifacts
 * with monotonic shared-timebase alignment, measured start offsets,
 * visible preflight/countdown/progress, and robust lifecycle.
 *
 * Each selected source records into its own MediaRecorder backed by an
 * ordered durable OPFS scratch sink (one file per recorder). Falls back
 * to a small bounded-memory sink when OPFS is unavailable. No unbounded
 * Blob[] accumulation.
 */

import { createLogger } from '../workspace-fs/logger';
import {
	estimateBytesPerMinute as estimateBytesPerMinutePure,
	formatBytes as formatBytesPure,
	mapRecorderError as mapRecorderErrorPure,
	pickAudioMimeType as pickAudioMimeTypePure,
	pickVideoMimeType as pickVideoMimeTypePure,
	recorderMimeType as recorderMimeTypePure,
	type RecorderErrorCode as RecorderErrorCodePure
} from './record-mime';
import {
	createScratchSink,
	discardScratchById,
	type ScratchKind,
	type ScratchSink
} from './recorder-scratch';

const logger = createLogger('ScreenCaptureRecorder');

export type RecorderKind = 'screen' | 'camera' | 'microphone';

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
	scratchId: string;
}

const COUNTDOWN_TICK_MS = 1000;
const STOP_TIMEOUT_MS = 4000;
const MAX_PENDING_WRITE_BYTES = 8 * 1024 * 1024;

export const pickVideoMimeType = pickVideoMimeTypePure;
export const pickAudioMimeType = pickAudioMimeTypePure;
export const recorderMimeType = recorderMimeTypePure;
export const mapRecorderError = mapRecorderErrorPure;
export const estimateBytesPerMinute = estimateBytesPerMinutePure;
export const formatBytes = formatBytesPure;

function isNumberValue(value: unknown): value is number {
	// oxlint-disable-next-line anti-slop/no-runtime-typeof -- narrow number at boundary
	return typeof value === 'number';
}

function extractRecorderError(event: Event): DOMException | null {
	if (!('error' in event)) return null;
	const error = event.error;
	if (error instanceof DOMException) return error;
	if (!(error instanceof Object) || !('name' in error)) return null;
	const name = String(error.name);
	const message = 'message' in error ? String(error.message) : name;
	return new DOMException(message, name);
}

function isMediaRecorderAvailable(): boolean {
	// oxlint-disable-next-line anti-slop/no-runtime-typeof -- browser capability probe
	return (
		typeof MediaRecorder !== 'undefined' && typeof MediaRecorder.isTypeSupported === 'function'
	);
}

function isNavigatorAvailable(): boolean {
	// oxlint-disable-next-line anti-slop/no-runtime-typeof -- browser global check
	return typeof navigator !== 'undefined';
}

export async function listRecorderDevices(): Promise<RecorderDeviceLists> {
	if (!navigator.mediaDevices?.enumerateDevices) return { cameras: [], microphones: [] };
	const devices = await navigator.mediaDevices.enumerateDevices();
	return {
		cameras: devices.filter((d) => d.kind === 'videoinput'),
		microphones: devices.filter((d) => d.kind === 'audioinput')
	};
}

export function hasRecorderSupport(selection: RecorderSelection): boolean {
	if (!isNavigatorAvailable() || !isMediaRecorderAvailable()) return false;
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
	sink: ScratchSink;
	mimeType: string;
	startTimeMs: number | null;
	chunkCount: number;
	byteCount: number;
}

interface DisplayCaptureConstraints extends MediaTrackConstraints {
	cursor: 'always';
}

export class ScreenCaptureRecorder {
	status = $state<RecorderStatus>('idle');
	selection = $state<RecorderSelection | null>(null);
	elapsedMs = $state(0);
	countdownRemaining = $state<number | null>(null);
	error = $state<RecorderErrorCode | null>(null);
	lastArtifacts = $state<CaptureArtifact[]>([]);
	counters = $state<Record<RecorderKind, { chunks: number; bytes: number }>>({
		screen: { chunks: 0, bytes: 0 },
		camera: { chunks: 0, bytes: 0 },
		microphone: { chunks: 0, bytes: 0 }
	});
	screenStream = $state<MediaStream | null>(null);
	cameraStream = $state<MediaStream | null>(null);
	micStream = $state<MediaStream | null>(null);

	private internal: InternalRecorder[] = [];
	private acquiredStreams: MediaStream[] = [];
	private timer: ReturnType<typeof setInterval> | null = null;
	private countdownTimer: ReturnType<typeof setInterval> | null = null;
	private countdownReject: ((error: Error) => void) | null = null;
	private startMonotonic: number | null = null;
	private generation = 0;
	private stopGeneration = 0;
	private stopPromise: Promise<CaptureArtifact[]> | null = null;
	private pendingWriteBytes = 0;

	async startWithSelection(
		selection: RecorderSelection,
		options: RecorderStartOptions = {}
	): Promise<void> {
		if (this.status !== 'idle' && this.status !== 'error') throw new Error('Already active');
		if (!selection.screen && !selection.camera && !selection.microphone) {
			this.setError('start-failed');
			throw new Error('Select at least one source');
		}
		const includeVideo = selection.screen || selection.camera;
		const mimeOk = includeVideo ? pickVideoMimeType() : pickAudioMimeType();
		if (!mimeOk) {
			this.setError('unsupported');
			throw new Error('No supported MIME type');
		}
		if (!hasRecorderSupport(selection)) {
			this.setError('unsupported');
			throw new Error('Unsupported');
		}
		const generation = ++this.generation;
		this.clearError();
		this.resetCounters();
		this.status = 'requesting';
		this.selection = selection;
		this.elapsedMs = 0;
		this.countdownRemaining = null;
		this.acquiredStreams = [];
		this.stopPromise = null;
		this.pendingWriteBytes = 0;

		let screenStream: MediaStream | null = null;
		let cameraStream: MediaStream | null = null;
		let micStream: MediaStream | null = null;

		const trackAcquired = (stream: MediaStream | null) => {
			if (stream) this.acquiredStreams.push(stream);
		};

		try {
			if (selection.screen) {
				const video: DisplayCaptureConstraints = { cursor: 'always' };
				const constraints: DisplayMediaStreamOptions = {
					video,
					audio: options.includeSystemAudio !== false
				};
				screenStream = await navigator.mediaDevices.getDisplayMedia(constraints);
				trackAcquired(screenStream);
				if (generation !== this.generation) {
					this.cleanupAcquiredStreams();
					return;
				}
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
				trackAcquired(cameraStream);
				if (generation !== this.generation) {
					this.cleanupAcquiredStreams();
					return;
				}
			}
			if (selection.microphone) {
				const deviceId = options.microphoneDeviceId ?? null;
				micStream = await navigator.mediaDevices.getUserMedia({
					audio: deviceId ? { deviceId: { exact: deviceId } } : true,
					video: false
				});
				trackAcquired(micStream);
				if (generation !== this.generation) {
					this.cleanupAcquiredStreams();
					return;
				}
			}
		} catch (error) {
			this.cleanupAcquiredStreams();
			if (generation === this.generation) {
				const code = mapRecorderError(error);
				this.setError(code);
				this.status = 'error';
			}
			throw error;
		}

		if (generation !== this.generation) {
			this.cleanupAcquiredStreams();
			throw new Error('Cancelled');
		}

		this.screenStream = screenStream;
		this.cameraStream = cameraStream;
		this.micStream = micStream;

		const countdown = options.countdownSeconds ?? 0;
		if (countdown > 0) {
			this.status = 'countdown';
			this.countdownRemaining = countdown;
			try {
				await this.runCountdown(countdown, generation);
			} catch (error) {
				this.cleanupAcquiredStreams();
				this.clearPreview();
				if (generation === this.generation) {
					this.status = 'idle';
					this.countdownRemaining = null;
					this.selection = null;
					this.acquiredStreams = [];
				}
				throw error;
			}
			if (generation !== this.generation) {
				this.cleanupAcquiredStreams();
				this.clearPreview();
				throw new Error('Cancelled');
			}
		}

		const toCreate: Array<{ kind: ScratchKind; stream: MediaStream; mime: string }> = [];
		if (screenStream)
			toCreate.push({ kind: 'screen', stream: screenStream, mime: pickVideoMimeType() });
		if (cameraStream)
			toCreate.push({ kind: 'camera', stream: cameraStream, mime: pickVideoMimeType() });
		if (micStream)
			toCreate.push({ kind: 'microphone', stream: micStream, mime: pickAudioMimeType() });

		const newInternal: InternalRecorder[] = [];
		try {
			for (const { kind, stream, mime } of toCreate) {
				const sink = await createScratchSink(kind, mime);
				let recorder: MediaRecorder;
				try {
					recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
				} catch (error) {
					await sink.discard();
					throw error;
				}
				const entry: InternalRecorder = {
					kind,
					stream,
					recorder,
					sink,
					mimeType: (recorder.mimeType || mime).trim(),
					startTimeMs: null,
					chunkCount: 0,
					byteCount: 0
				};
				// Queue ordered durable writes; dataavailable must not retain Blob[] in RAM
				recorder.addEventListener('dataavailable', (event: BlobEvent) => {
					if (event.data.size === 0) return;
					const chunk = event.data;
					entry.chunkCount += 1;
					entry.byteCount += chunk.size;
					this.counters[kind] = { chunks: entry.chunkCount, bytes: entry.byteCount };
					this.pendingWriteBytes += chunk.size;
					const backlogExceeded = this.pendingWriteBytes > MAX_PENDING_WRITE_BYTES;
					void entry.sink
						.write(chunk)
						.catch((writeError) => {
							logger.warn(`sink write failed (${kind})`, writeError);
							this.setError(mapRecorderError(writeError));
							if (this.status === 'recording') void this.stop();
						})
						.finally(() => {
							this.pendingWriteBytes = Math.max(0, this.pendingWriteBytes - chunk.size);
						});
					if (backlogExceeded && this.status === 'recording') {
						this.setError('storage-full');
						void this.stop();
					}
				});
				recorder.addEventListener('error', (event: Event) => {
					const err = extractRecorderError(event);
					logger.warn(`MediaRecorder error (${kind})`, err);
					const code = mapRecorderError(err ?? new Error('Recorder failed'));
					this.setError(code);
				});
				newInternal.push(entry);
			}
		} catch (error) {
			for (const e of newInternal) {
				try {
					await e.sink.discard();
				} catch {
					// ignore
				}
			}
			this.cleanupAcquiredStreams();
			this.clearPreview();
			if (generation === this.generation) {
				const code = mapRecorderError(error);
				this.setError(code);
				this.status = 'error';
			}
			throw error;
		}

		this.internal = newInternal;

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
						const err = extractRecorderError(event) ?? new Error('Start failed');
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
			for (const entry of this.internal) {
				await this.stopRecorderForDiscard(entry.recorder);
				try {
					await entry.sink.discard();
				} catch {
					// ignore
				}
			}
			this.internal = [];
			this.clearPreview();
			this.cleanupAcquiredStreams();
			if (generation === this.generation) {
				const code = mapRecorderError(error);
				this.setError(code);
				this.status = 'error';
			}
			throw error;
		}

		if (generation !== this.generation) {
			for (const entry of this.internal) {
				await this.stopRecorderForDiscard(entry.recorder);
				try {
					await entry.sink.discard();
				} catch {
					// ignore
				}
			}
			this.internal = [];
			this.clearPreview();
			this.cleanupAcquiredStreams();
			return;
		}

		this.status = 'recording';
		this.countdownRemaining = null;
		const startTimesForMonotonic = this.internal
			.map((e) => e.startTimeMs)
			.filter((v): v is number => isNumberValue(v) && Number.isFinite(v));
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

	private setError(code: RecorderErrorCode): void {
		this.error = code;
	}

	private clearError(): void {
		this.error = null;
	}

	private clearPreview(): void {
		this.screenStream = null;
		this.cameraStream = null;
		this.micStream = null;
	}

	private cleanupAcquiredStreams(): void {
		for (const s of this.acquiredStreams) {
			for (const t of s.getTracks()) t.stop();
		}
		this.acquiredStreams = [];
	}

	private stopRecorderForDiscard(recorder: MediaRecorder): Promise<void> {
		if (recorder.state === 'inactive') return Promise.resolve();
		return new Promise((resolve) => {
			let timeout: ReturnType<typeof setTimeout> | null = null;
			const settle = () => {
				if (timeout) clearTimeout(timeout);
				recorder.removeEventListener('stop', settle);
				recorder.removeEventListener('error', settle);
				resolve();
			};
			recorder.addEventListener('stop', settle, { once: true });
			recorder.addEventListener('error', settle, { once: true });
			timeout = setTimeout(settle, STOP_TIMEOUT_MS);
			try {
				recorder.stop();
			} catch {
				settle();
			}
		});
	}

	async stop(): Promise<CaptureArtifact[]> {
		if (this.stopPromise) return this.stopPromise;
		if (this.status === 'idle' || this.status === 'error') return [];
		if (this.status === 'countdown') {
			const reject = this.countdownReject;
			this.stopCountdownTimer();
			if (reject) reject(new Error('Cancelled'));
			this.generation += 1;
			for (const entry of this.internal) {
				try {
					await entry.sink.discard();
				} catch {
					// ignore
				}
			}
			this.internal = [];
			this.cleanupAcquiredStreams();
			this.clearPreview();
			this.stopElapsedTimer();
			this.status = 'idle';
			this.countdownRemaining = null;
			this.selection = null;
			return [];
		}
		if (this.status !== 'recording') {
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
			this.stopPromise = null;
			return [];
		}

		const promise = (async (): Promise<CaptureArtifact[]> => {
			const stopPromises = internal.map(
				(entry) =>
					new Promise<void>((resolve) => {
						let timeout: ReturnType<typeof setTimeout> | null = null;
						const onStop = () => {
							if (timeout) clearTimeout(timeout);
							entry.recorder.removeEventListener('error', onError);
							resolve();
						};
						const onError = (event: Event) => {
							if (timeout) clearTimeout(timeout);
							entry.recorder.removeEventListener('stop', onStop);
							const err = extractRecorderError(event);
							const code = mapRecorderError(err ?? new Error('Recorder error'));
							this.setError(code);
							resolve();
						};
						entry.recorder.addEventListener('stop', onStop, { once: true });
						entry.recorder.addEventListener('error', onError, { once: true });
						timeout = setTimeout(() => {
							entry.recorder.removeEventListener('stop', onStop);
							entry.recorder.removeEventListener('error', onError);
							this.setError('stop-timeout');
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
				return [];
			}

			// Await ordered durable writes and close sinks
			for (const entry of internal) {
				try {
					await entry.sink.close();
				} catch (error) {
					logger.warn('sink close failed', error);
					const code = mapRecorderError(error);
					this.setError(code);
				}
			}

			const elapsedAtStop = this.startMonotonic
				? Math.max(0, Math.round(performance.now() - this.startMonotonic))
				: this.elapsedMs;

			const startTimes = internal
				.map((e) => e.startTimeMs)
				.filter((v): v is number => isNumberValue(v) && Number.isFinite(v));
			const baseTime = startTimes.length > 0 ? Math.min(...startTimes) : performance.now();

			const artifacts: CaptureArtifact[] = [];
			for (const entry of internal) {
				let file: File;
				try {
					file = await entry.sink.getFile();
				} catch (error) {
					logger.warn('getFile failed, keeping partial', error);
					const code = mapRecorderError(error);
					this.setError(code);
					continue;
				}
				const sizeBytes = file.size;
				const startOffsetMs =
					entry.startTimeMs !== null && Number.isFinite(entry.startTimeMs)
						? Math.max(0, Math.round(entry.startTimeMs - baseTime))
						: 0;
				if (sizeBytes === 0 && entry.sink.chunks === 0) continue;
				artifacts.push({
					kind: entry.kind,
					blob: file,
					mimeType: entry.mimeType || file.type || 'video/webm',
					durationMs: Math.max(0, elapsedAtStop - startOffsetMs),
					startOffsetMs,
					sizeBytes,
					scratchId: entry.sink.id
				});
			}

			for (const entry of internal) {
				for (const track of entry.stream.getTracks()) track.stop();
			}
			this.internal = [];
			this.acquiredStreams = [];
			this.clearPreview();
			this.startMonotonic = null;
			this.pendingWriteBytes = 0;

			if (artifacts.length > 0) {
				this.lastArtifacts = artifacts;
			}

			this.status = 'idle';
			this.selection = null;
			this.countdownRemaining = null;

			if (artifacts.length === 0 && internal.length > 0) {
				this.setError('start-failed');
			}

			return artifacts;
		})();

		this.stopPromise = promise;
		try {
			const result = await promise;
			return result;
		} finally {
			if (this.stopPromise === promise) this.stopPromise = null;
		}
	}

	async cancel(): Promise<void> {
		this.generation += 1;
		this.stopGeneration += 1;
		this.stopElapsedTimer();
		const reject = this.countdownReject;
		this.stopCountdownTimer();
		if (reject) reject(new Error('Cancelled'));
		this.countdownRemaining = null;
		const toDiscard = [...this.internal];
		this.internal = [];
		for (const entry of toDiscard) {
			await this.stopRecorderForDiscard(entry.recorder);
			try {
				await entry.sink.discard();
			} catch {
				// ignore
			}
		}
		this.cleanupAcquiredStreams();
		this.clearPreview();
		this.startMonotonic = null;
		this.pendingWriteBytes = 0;
		this.status = 'idle';
		this.selection = null;
		this.elapsedMs = 0;
		this.resetCounters();
		this.clearError();
	}

	async discardScratch(scratchId: string): Promise<void> {
		await discardScratchById(scratchId);
		this.lastArtifacts = this.lastArtifacts.filter((a) => a.scratchId !== scratchId);
	}

	async discardAllScratches(): Promise<void> {
		const ids = this.lastArtifacts.map((a) => a.scratchId);
		for (const id of ids) {
			try {
				await discardScratchById(id);
			} catch {
				// ignore
			}
		}
		this.lastArtifacts = [];
	}

	async clearRecoverableAndDiscard(): Promise<void> {
		await this.discardAllScratches();
	}
}

export const recorder = new ScreenCaptureRecorder();
