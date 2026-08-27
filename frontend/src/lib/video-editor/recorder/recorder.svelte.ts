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
	recorderVideoBitsPerSecond,
	RECORDER_AUDIO_BITS_PER_SECOND,
	type RecorderCameraFacingMode,
	type RecorderErrorCode as RecorderErrorCodePure,
	type RecorderVideoFrameRate,
	type RecorderVideoResolution
} from './record-mime';
import {
	createScratchSink,
	discardScratchById,
	discardScratchRecoverySession,
	holdScratchRecoveryLock,
	loadRecoverableScratchSessions,
	writeScratchRecoveryManifest,
	type ScratchKind,
	type ScratchRecoveryManifest,
	type ScratchSink
} from './recorder-scratch';
import { microphoneConstraints, startMicLevelMeter } from './mic-recorder';
import {
	deriveSystemAudioStatus,
	detectRecordingCapabilities,
	isSystemAudioActive,
	readActualCursor,
	resolveCursorConstraint,
	type CursorActualMode,
	type CursorMode,
	type RecordingCapabilities,
	type SystemAudioStatus
} from './capture-capabilities';

const logger = createLogger('ScreenCaptureRecorder');

export type {
	CursorMode,
	CursorActualMode,
	SystemAudioStatus,
	RecordingCapabilities
} from './capture-capabilities';

export interface ScreenCaptureTruth {
	capturedAt: string;
	cursorSupported: boolean;
	cursorRequested: CursorMode;
	cursorActual: CursorActualMode;
	systemAudioRequested: boolean;
	systemAudioActive: boolean;
	systemAudioStatus: SystemAudioStatus;
}

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
	cursorMode?: CursorMode;
	countdownSeconds?: number;
	videoResolution?: RecorderVideoResolution;
	videoFrameRate?: RecorderVideoFrameRate;
	cameraFacingMode?: RecorderCameraFacingMode;
	noiseSuppression?: boolean;
	autoGainControl?: boolean;
}

export type {
	RecorderCameraFacingMode,
	RecorderVideoFrameRate,
	RecorderVideoResolution
} from './record-mime';

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
	recoverySessionId?: string;
	capture?: ScreenCaptureTruth;
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

function stopMediaStreams(streams: MediaStream[]): void {
	for (const stream of streams) {
		for (const track of stream.getTracks()) track.stop();
	}
	streams.length = 0;
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

export function getRecordingCapabilities(): RecordingCapabilities {
	return detectRecordingCapabilities();
}

export function refreshRecordingCapabilities(recorder: ScreenCaptureRecorder): void {
	recorder.capabilities = detectRecordingCapabilities();
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
	cursor?: CursorMode;
}

const VIDEO_RESOLUTION_SIZE = {
	'720p': { width: 1280, height: 720 },
	'1080p': { width: 1920, height: 1080 },
	'2160p': { width: 3840, height: 2160 }
} as const satisfies Record<RecorderVideoResolution, { width: number; height: number }>;

function preferredVideoConstraints(
	options: RecorderStartOptions
): Pick<MediaTrackConstraints, 'width' | 'height' | 'frameRate'> {
	const resolution = options.videoResolution;
	const result: Pick<MediaTrackConstraints, 'width' | 'height' | 'frameRate'> = {};
	if (resolution) {
		const size = VIDEO_RESOLUTION_SIZE[resolution];
		result.width = { ideal: size.width };
		result.height = { ideal: size.height };
	}
	if (options.videoFrameRate) result.frameRate = { ideal: options.videoFrameRate };
	return result;
}

function mediaRecorderOptions(
	kind: RecorderKind,
	stream: MediaStream,
	mimeType: string,
	options: RecorderStartOptions
): MediaRecorderOptions | undefined {
	const result: MediaRecorderOptions = {};
	if (mimeType) result.mimeType = mimeType;
	if (kind !== 'microphone') {
		const videoBitsPerSecond = recorderVideoBitsPerSecond(options);
		if (videoBitsPerSecond) result.videoBitsPerSecond = videoBitsPerSecond;
	}
	if (stream.getAudioTracks().length > 0) {
		result.audioBitsPerSecond = RECORDER_AUDIO_BITS_PER_SECOND;
	}
	return Object.keys(result).length > 0 ? result : undefined;
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
	micLevel = $state(0);

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
	private activeRecoverySessionId: string | null = null;
	private activeRecoveryCreatedAt = 0;
	private recoveryManifestQueue: Promise<void> = Promise.resolve();
	private releaseRecoveryLock: (() => void) | null = null;
	private stopMicMeter: (() => void) | null = null;
	private lastMicLevelUpdate = Number.NEGATIVE_INFINITY;
	private activeCaptureTruth: ScreenCaptureTruth | null = null;
	capabilities = $state<RecordingCapabilities>(detectRecordingCapabilities());
	captureTruth = $state<ScreenCaptureTruth | null>(null);

	refreshCapabilities(): void {
		this.capabilities = detectRecordingCapabilities();
	}

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
		const acquiredStreams: MediaStream[] = [];
		this.acquiredStreams = acquiredStreams;
		this.stopPromise = null;
		this.pendingWriteBytes = 0;
		this.activeCaptureTruth = null;
		this.captureTruth = null;
		const capabilities = detectRecordingCapabilities();
		const cursorRequested: CursorMode = options.cursorMode ?? 'always';
		const cursorResolved = resolveCursorConstraint(cursorRequested, capabilities);
		const systemAudioRequested = options.includeSystemAudio !== false;
		let captureTruth: ScreenCaptureTruth | null = null;

		let screenStream: MediaStream | null = null;
		let cameraStream: MediaStream | null = null;
		let micStream: MediaStream | null = null;

		const trackAcquired = (stream: MediaStream | null) => {
			if (stream) acquiredStreams.push(stream);
		};
		const cleanupStartStreams = () => {
			stopMediaStreams(acquiredStreams);
			if (this.acquiredStreams === acquiredStreams) this.acquiredStreams = [];
		};

		try {
			if (selection.screen) {
				const baseVideo = preferredVideoConstraints(options);
				const video: DisplayCaptureConstraints = { ...baseVideo };
				if (cursorResolved) video.cursor = cursorResolved;
				const constraints: DisplayMediaStreamOptions = {
					video,
					audio: systemAudioRequested
				};
				screenStream = await navigator.mediaDevices.getDisplayMedia(constraints);
				trackAcquired(screenStream);
				if (generation !== this.generation) {
					cleanupStartStreams();
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
				const facingMode = options.cameraFacingMode ?? 'default';
				const video: MediaTrackConstraints = preferredVideoConstraints(options);
				if (deviceId) video.deviceId = { exact: deviceId };
				else if (facingMode !== 'default') video.facingMode = { ideal: facingMode };
				cameraStream = await navigator.mediaDevices.getUserMedia({
					video,
					audio: false
				});
				trackAcquired(cameraStream);
				if (generation !== this.generation) {
					cleanupStartStreams();
					return;
				}
			}
			if (selection.microphone) {
				const deviceId = options.microphoneDeviceId ?? null;
				micStream = await navigator.mediaDevices.getUserMedia({
					audio: microphoneConstraints({
						deviceId: deviceId ?? undefined,
						noiseSuppression: options.noiseSuppression,
						autoGainControl: options.autoGainControl
					}),
					video: false
				});
				trackAcquired(micStream);
				if (generation !== this.generation) {
					cleanupStartStreams();
					return;
				}
			}
		} catch (error) {
			cleanupStartStreams();
			if (generation === this.generation) {
				const code = mapRecorderError(error);
				this.setError(code);
				this.status = 'error';
				if (selection.screen) {
					const honestStatus = deriveSystemAudioStatus({
						requested: systemAudioRequested,
						stream: screenStream,
						error,
						capabilities
					});
					const honestCursorActual = readActualCursor(screenStream, capabilities);
					const honestTruth: ScreenCaptureTruth = {
						capturedAt: new Date().toISOString(),
						cursorSupported: capabilities.cursor.supported,
						cursorRequested,
						cursorActual: honestCursorActual,
						systemAudioRequested,
						systemAudioActive: false,
						systemAudioStatus: honestStatus
					};
					this.activeCaptureTruth = honestTruth;
					this.captureTruth = honestTruth;
					this.capabilities = capabilities;
				}
			}
			throw error;
		}

		if (generation !== this.generation) {
			cleanupStartStreams();
			throw new Error('Cancelled');
		}

		const capturedAt = new Date().toISOString();
		if (selection.screen) {
			const systemAudioActive = isSystemAudioActive(screenStream);
			const systemAudioStatus = deriveSystemAudioStatus({
				requested: systemAudioRequested,
				stream: screenStream,
				capabilities
			});
			const cursorActual = readActualCursor(screenStream, capabilities);
			captureTruth = {
				capturedAt,
				cursorSupported: capabilities.cursor.supported,
				cursorRequested: cursorRequested,
				cursorActual,
				systemAudioRequested,
				systemAudioActive,
				systemAudioStatus
			};
			this.activeCaptureTruth = captureTruth;
			this.captureTruth = captureTruth;
			this.capabilities = capabilities;
		} else {
			captureTruth = {
				capturedAt,
				cursorSupported: false,
				cursorRequested,
				cursorActual: 'unsupported',
				systemAudioRequested: false,
				systemAudioActive: false,
				systemAudioStatus: 'not-requested'
			};
			this.activeCaptureTruth = captureTruth;
			this.captureTruth = captureTruth;
			this.capabilities = capabilities;
		}

		if (micStream) {
			this.stopMicMeter = startMicLevelMeter(micStream, (level) => {
				const now = performance.now();
				if (now - this.lastMicLevelUpdate < 40) return;
				this.lastMicLevelUpdate = now;
				this.micLevel = Math.max(0, Math.min(1, level));
			});
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
				cleanupStartStreams();
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
				cleanupStartStreams();
				this.clearPreview();
				throw new Error('Cancelled');
			}
		}

		const recoverySessionId = crypto.randomUUID();
		const recoveryCreatedAt = Date.now();
		const releaseRecoveryLock = await holdScratchRecoveryLock(recoverySessionId);
		if (generation !== this.generation) {
			releaseRecoveryLock();
			this.cleanupAcquiredStreams();
			this.clearPreview();
			return;
		}
		this.activeRecoverySessionId = recoverySessionId;
		this.activeRecoveryCreatedAt = recoveryCreatedAt;
		this.recoveryManifestQueue = Promise.resolve();
		this.releaseRecoveryLock = releaseRecoveryLock;
		const toCreate: Array<{
			kind: ScratchKind;
			stream: MediaStream;
			mime: string;
		}> = [];
		if (screenStream)
			toCreate.push({
				kind: 'screen',
				stream: screenStream,
				mime: pickVideoMimeType()
			});
		if (cameraStream)
			toCreate.push({
				kind: 'camera',
				stream: cameraStream,
				mime: pickVideoMimeType()
			});
		if (micStream)
			toCreate.push({
				kind: 'microphone',
				stream: micStream,
				mime: pickAudioMimeType()
			});

		const newInternal: InternalRecorder[] = [];
		try {
			for (const { kind, stream, mime } of toCreate) {
				const sink = await createScratchSink(kind, mime, recoverySessionId);
				let recorder: MediaRecorder;
				try {
					recorder = new MediaRecorder(stream, mediaRecorderOptions(kind, stream, mime, options));
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
					this.counters[kind] = {
						chunks: entry.chunkCount,
						bytes: entry.byteCount
					};
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
			if (generation !== this.generation) {
				await discardScratchRecoverySession(
					recoverySessionId,
					newInternal.map((entry) => entry.sink.id)
				);
				throw new Error('Cancelled', { cause: error });
			}
			cleanupStartStreams();
			this.clearPreview();
			await this.discardActiveRecoverySession(recoverySessionId);
			if (generation === this.generation) {
				const code = mapRecorderError(error);
				this.setError(code);
				this.status = 'error';
			}
			throw error;
		}
		if (generation !== this.generation) {
			for (const entry of newInternal) await entry.sink.discard().catch(() => undefined);
			await discardScratchRecoverySession(
				recoverySessionId,
				newInternal.map((entry) => entry.sink.id)
			);
			return;
		}

		this.internal = newInternal;
		try {
			await this.writeActiveRecoveryManifest('recording');
		} catch (error) {
			for (const entry of newInternal) await entry.sink.discard().catch(() => undefined);
			if (this.activeRecoverySessionId === recoverySessionId) {
				this.internal = [];
				cleanupStartStreams();
				this.clearPreview();
				await this.discardActiveRecoverySession(recoverySessionId);
				this.setError(mapRecorderError(error));
				this.status = 'error';
			} else {
				await discardScratchRecoverySession(
					recoverySessionId,
					newInternal.map((entry) => entry.sink.id)
				);
			}
			throw error;
		}
		if (generation !== this.generation) {
			for (const entry of newInternal) await entry.sink.discard().catch(() => undefined);
			await discardScratchRecoverySession(
				recoverySessionId,
				newInternal.map((entry) => entry.sink.id)
			);
			return;
		}

		const startPromises = newInternal.map(
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
			for (const entry of newInternal) {
				await this.stopRecorderForDiscard(entry.recorder);
				try {
					await entry.sink.discard();
				} catch {
					// ignore
				}
			}
			if (this.activeRecoverySessionId === recoverySessionId) {
				this.internal = [];
				this.clearPreview();
				cleanupStartStreams();
				await this.discardActiveRecoverySession(recoverySessionId);
			} else {
				await discardScratchRecoverySession(
					recoverySessionId,
					newInternal.map((entry) => entry.sink.id)
				);
			}
			if (generation === this.generation) {
				const code = mapRecorderError(error);
				this.setError(code);
				this.status = 'error';
			}
			throw error;
		}

		if (generation !== this.generation) {
			for (const entry of newInternal) {
				await this.stopRecorderForDiscard(entry.recorder);
				try {
					await entry.sink.discard();
				} catch {
					// ignore
				}
			}
			if (this.activeRecoverySessionId === recoverySessionId) {
				this.internal = [];
				this.clearPreview();
				cleanupStartStreams();
				await this.discardActiveRecoverySession(recoverySessionId);
			} else {
				await discardScratchRecoverySession(
					recoverySessionId,
					newInternal.map((entry) => entry.sink.id)
				);
			}
			return;
		}

		this.status = 'recording';
		this.countdownRemaining = null;
		const startTimesForMonotonic = this.internal
			.map((e) => e.startTimeMs)
			.filter((v): v is number => isNumberValue(v) && Number.isFinite(v));
		this.startMonotonic =
			startTimesForMonotonic.length > 0 ? Math.min(...startTimesForMonotonic) : performance.now();
		try {
			await this.writeActiveRecoveryManifest('recording');
		} catch (error) {
			logger.warn('Could not persist recorder recovery offsets', error);
			if (this.activeRecoverySessionId === recoverySessionId) {
				await this.cancel();
				this.setError(mapRecorderError(error));
				this.status = 'error';
			}
			throw error;
		}
		if (generation !== this.generation) return;
		this.startElapsedTimer();
	}

	private buildRecoveryManifest(
		status: ScratchRecoveryManifest['status'],
		artifacts: CaptureArtifact[] = []
	): ScratchRecoveryManifest | null {
		const sessionId = this.activeRecoverySessionId;
		if (!sessionId) return null;
		const byScratchId = new Map(artifacts.map((artifact) => [artifact.scratchId, artifact]));
		const startTimes = this.internal
			.map((entry) => entry.startTimeMs)
			.filter((value): value is number => isNumberValue(value) && Number.isFinite(value));
		const baseTime = startTimes.length > 0 ? Math.min(...startTimes) : null;
		const durableEntries = this.internal.filter((entry) => entry.sink.durable);
		if (durableEntries.length === 0) return null;
		return {
			version: 1,
			sessionId,
			createdAt: this.activeRecoveryCreatedAt,
			status,
			artifacts: durableEntries.map((entry) => {
				const complete = byScratchId.get(entry.sink.id);
				const startOffsetMs =
					entry.startTimeMs !== null && baseTime !== null
						? Math.max(0, Math.round(entry.startTimeMs - baseTime))
						: 0;
				return {
					scratchId: entry.sink.id,
					kind: entry.kind,
					mimeType: entry.mimeType,
					startOffsetMs: complete?.startOffsetMs ?? startOffsetMs,
					durationMs: complete?.durationMs ?? 0,
					sizeBytes: complete?.sizeBytes ?? entry.sink.bytes
				};
			})
		};
	}

	private async writeActiveRecoveryManifest(
		status: ScratchRecoveryManifest['status'],
		artifacts: CaptureArtifact[] = []
	): Promise<void> {
		const manifest = this.buildRecoveryManifest(status, artifacts);
		if (!manifest) return;
		const write = this.recoveryManifestQueue.then(() => writeScratchRecoveryManifest(manifest));
		this.recoveryManifestQueue = write.catch(() => undefined);
		await write;
	}

	private async discardActiveRecoverySession(expectedSessionId?: string): Promise<void> {
		if (expectedSessionId && this.activeRecoverySessionId !== expectedSessionId) return;
		const sessionId = this.activeRecoverySessionId;
		this.activeRecoverySessionId = null;
		this.activeRecoveryCreatedAt = 0;
		await this.recoveryManifestQueue.catch(() => undefined);
		this.recoveryManifestQueue = Promise.resolve();
		this.releaseRecoveryLock?.();
		this.releaseRecoveryLock = null;
		if (sessionId) await discardScratchRecoverySession(sessionId);
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
		this.stopMicMeter?.();
		this.stopMicMeter = null;
		this.lastMicLevelUpdate = Number.NEGATIVE_INFINITY;
		this.micLevel = 0;
		this.screenStream = null;
		this.cameraStream = null;
		this.micStream = null;
	}

	private cleanupAcquiredStreams(): void {
		const streams = this.acquiredStreams;
		this.acquiredStreams = [];
		stopMediaStreams(streams);
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
			await this.discardActiveRecoverySession();
			this.clearPreview();
			this.status = 'idle';
			this.stopPromise = null;
			return [];
		}

		const recoverySessionId = this.activeRecoverySessionId ?? undefined;
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
				const capture = this.activeCaptureTruth ?? undefined;
				artifacts.push({
					kind: entry.kind,
					blob: file,
					mimeType: entry.mimeType || file.type || 'video/webm',
					durationMs: Math.max(0, elapsedAtStop - startOffsetMs),
					startOffsetMs,
					sizeBytes,
					scratchId: entry.sink.id,
					recoverySessionId,
					capture: capture ?? undefined
				});
			}

			if (artifacts.length > 0) {
				try {
					await this.writeActiveRecoveryManifest('complete', artifacts);
				} catch (error) {
					logger.warn('Could not finalize recorder recovery manifest', error);
				}
			}

			for (const entry of internal) {
				for (const track of entry.stream.getTracks()) track.stop();
			}
			this.internal = [];
			this.acquiredStreams = [];
			this.clearPreview();
			this.startMonotonic = null;
			this.pendingWriteBytes = 0;
			this.releaseRecoveryLock?.();
			this.releaseRecoveryLock = null;
			this.activeRecoverySessionId = null;
			this.activeRecoveryCreatedAt = 0;

			if (artifacts.length > 0) {
				const scratchIds = new Set(artifacts.map((artifact) => artifact.scratchId));
				this.lastArtifacts = [
					...this.lastArtifacts.filter((artifact) => !scratchIds.has(artifact.scratchId)),
					...artifacts
				];
			}

			this.status = 'idle';
			this.selection = null;
			this.countdownRemaining = null;

			if (artifacts.length === 0 && internal.length > 0) {
				if (recoverySessionId) {
					await discardScratchRecoverySession(
						recoverySessionId,
						internal.map((entry) => entry.sink.id)
					);
				}
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
		this.activeCaptureTruth = null;
		this.captureTruth = null;
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
		await this.discardActiveRecoverySession();
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
		if (this.lastArtifacts.length === 0) {
			this.activeCaptureTruth = null;
			this.captureTruth = null;
		}
	}

	async discardArtifacts(artifacts: CaptureArtifact[]): Promise<void> {
		const scratchIds = new Set(artifacts.map((artifact) => artifact.scratchId));
		const bySession = new Map<string, string[]>();
		for (const artifact of artifacts) {
			if (!artifact.recoverySessionId) continue;
			const ids = bySession.get(artifact.recoverySessionId) ?? [];
			ids.push(artifact.scratchId);
			bySession.set(artifact.recoverySessionId, ids);
		}
		for (const [sessionId, ids] of bySession) {
			await discardScratchRecoverySession(sessionId, ids);
		}
		for (const artifact of artifacts) {
			if (!artifact.recoverySessionId) await discardScratchById(artifact.scratchId);
		}
		this.lastArtifacts = this.lastArtifacts.filter(
			(artifact) => !scratchIds.has(artifact.scratchId)
		);
		if (this.lastArtifacts.length === 0) {
			this.activeCaptureTruth = null;
			this.captureTruth = null;
		}
	}

	async discardAllScratches(): Promise<void> {
		const bySession = new Map<string, string[]>();
		const ungroupedIds: string[] = [];
		for (const artifact of this.lastArtifacts) {
			if (artifact.recoverySessionId) {
				const ids = bySession.get(artifact.recoverySessionId) ?? [];
				ids.push(artifact.scratchId);
				bySession.set(artifact.recoverySessionId, ids);
			} else {
				ungroupedIds.push(artifact.scratchId);
			}
		}
		for (const [sessionId, ids] of bySession) {
			try {
				await discardScratchRecoverySession(sessionId, ids);
			} catch {
				// ignore
			}
		}
		for (const id of ungroupedIds) await discardScratchById(id).catch(() => undefined);
		this.lastArtifacts = [];
		this.activeCaptureTruth = null;
		this.captureTruth = null;
	}

	async loadRecoverableArtifacts(): Promise<CaptureArtifact[]> {
		const sessions = await loadRecoverableScratchSessions();
		const artifacts = sessions.flatMap((session) =>
			session.artifacts.map((artifact) => ({
				kind: artifact.kind,
				blob: artifact.blob,
				mimeType: artifact.mimeType,
				durationMs: artifact.durationMs,
				startOffsetMs: artifact.startOffsetMs,
				sizeBytes: artifact.sizeBytes,
				scratchId: artifact.scratchId,
				recoverySessionId: session.manifest.sessionId
			}))
		);
		const merged = new Map(
			this.lastArtifacts.map((artifact) => [artifact.scratchId, artifact] as const)
		);
		for (const artifact of artifacts) merged.set(artifact.scratchId, artifact);
		this.lastArtifacts = [...merged.values()];
		return this.lastArtifacts;
	}

	async clearRecoverableAndDiscard(): Promise<void> {
		await this.discardAllScratches();
		this.activeCaptureTruth = null;
		this.captureTruth = null;
	}
}

export const recorder = new ScreenCaptureRecorder();
