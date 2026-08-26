/**
 * Recorder module: screen / camera / microphone capture with crash-safe
 * session persistence, honest cursor settings, and configurable PiP.
 */

import { createLogger } from '../workspace-fs/logger';
import { requireWorkspaceRoot } from '../workspace-fs/root';
import { createCursorSidecar } from './cursor-capture';
import {
	clampPipGeometry,
	loadPipGeometry,
	pipRectForCanvas,
	savePipGeometry,
	type PipGeometry
} from './pip-geometry';
import {
	appendRecordingChunk,
	createRecordingSession,
	markSessionReady,
	markSessionInterrupted,
	readRecordingBlob
} from './recording-sessions';

const logger = createLogger('Recorder');

export type RecorderSource = 'screen' | 'camera' | 'audio' | 'screen-camera';

export interface RecorderDeviceLists {
	cameras: MediaDeviceInfo[];
	microphones: MediaDeviceInfo[];
}

const MIME_CANDIDATES = [
	'video/webm;codecs=vp9,opus',
	'video/webm;codecs=vp8,opus',
	'video/webm',
	'audio/webm'
] as const;

export function recorderMimeType(includeVideo: boolean): string {
	for (const candidate of MIME_CANDIDATES) {
		if (!includeVideo && !candidate.startsWith('audio')) continue;
		if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(candidate)) {
			return candidate;
		}
	}
	return '';
}

export async function listRecorderDevices(): Promise<RecorderDeviceLists> {
	const devices = await navigator.mediaDevices.enumerateDevices();
	return {
		cameras: devices.filter((d) => d.kind === 'videoinput'),
		microphones: devices.filter((d) => d.kind === 'audioinput')
	};
}

type StopResult = { blob: Blob; mimeType: string; seconds: number; sessionId?: string };

export class RecorderSession {
	stream = $state<MediaStream | null>(null);
	recording = $state(false);
	elapsedSeconds = $state(0);
	error = $state<string | null>(null);
	backpressure = $state(false);

	private mediaRecorder: MediaRecorder | null = null;
	private chunks: Blob[] = [];
	private timer: ReturnType<typeof setInterval> | null = null;
	private composited = false;
	private sessionId: string | null = null;
	private writeChain: Promise<void> = Promise.resolve();
	private pendingWrites = 0;
	private readonly highWatermark = 4;
	private readonly lowWatermark = 2;
	private fatalWriteError: unknown | null = null;
	private sourceTracks: MediaStream[] = [];
	private canvasEl: HTMLCanvasElement | null = null;
	private ctx2d: CanvasRenderingContext2D | null = null;
	private screenVideoEl: HTMLVideoElement | null = null;
	private cameraVideoEl: HTMLVideoElement | null = null;
	private rafId: number | null = null;
	private audioContext: AudioContext | null = null;
	private pipGeometry: PipGeometry = loadPipGeometry();
	private settled = false;
	private cleaned = false;

	get pip(): PipGeometry {
		return this.pipGeometry;
	}

	setPipGeometry(next: Partial<PipGeometry>): void {
		this.pipGeometry = clampPipGeometry(next);
		savePipGeometry(this.pipGeometry);
	}

	get usesCompositing(): boolean {
		return this.composited;
	}

	get activeSessionId(): string | null {
		return this.sessionId;
	}

	async start(
		source: RecorderSource,
		options: {
			cameraId?: string;
			micId?: string;
			systemAudio?: boolean;
			pip?: Partial<PipGeometry>;
		} = {}
	): Promise<void> {
		if (this.recording || this.stream) throw new Error('Already active');
		this.error = null;
		this.settled = false;
		this.cleaned = false;
		this.chunks = [];
		this.fatalWriteError = null;
		this.writeChain = Promise.resolve();
		this.pendingWrites = 0;
		this.backpressure = false;

		if (options.pip) this.setPipGeometry(options.pip);

		let displayStream: MediaStream | null = null;
		let cameraStream: MediaStream | null = null;
		let micStream: MediaStream | null = null;
		let failed = false;

		try {
			if (source === 'screen' || source === 'screen-camera') {
				displayStream = await navigator.mediaDevices.getDisplayMedia({
					// SAFETY: cursor option is part of MediaTrackConstraints for getDisplayMedia at boundary
					video: { cursor: 'always' } as MediaTrackConstraints,
					audio: options.systemAudio !== false
				});
				const track = displayStream.getVideoTracks()[0];
				track?.addEventListener('ended', () => {
					void this.stop({ reason: 'track-ended' });
				});
			}
			if (source === 'camera') {
				cameraStream = await navigator.mediaDevices.getUserMedia({
					video: options.cameraId ? { deviceId: { exact: options.cameraId } } : true,
					audio: false
				});
			}
			const wantsMic =
				source === 'audio' ||
				source === 'screen-camera' ||
				(source === 'camera' && Boolean(options.micId));
			if (wantsMic) {
				micStream = await navigator.mediaDevices.getUserMedia({
					audio: options.micId ? { deviceId: { exact: options.micId } } : true
				});
			}
		} catch (error) {
			failed = true;
			for (const s of [displayStream, cameraStream, micStream]) {
				for (const t of s?.getTracks() ?? []) t.stop();
			}
			this.error = error instanceof Error ? error.message : String(error);
			throw error;
		}

		if (failed) return;

		// SAFETY: filtered streams are valid MediaStreams at boundary
		this.sourceTracks = [displayStream, cameraStream, micStream].filter(Boolean) as MediaStream[];

		let recordStream: MediaStream;
		if (source === 'screen-camera' && displayStream && cameraStream) {
			try {
				recordStream = this.composite(displayStream, cameraStream, micStream);
				this.composited = true;
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				logger.warn('Composite failed, attempting audio-mixer fallback', error);
				this.cleanupCompositeResources();
				try {
					const context = new AudioContext();
					this.audioContext = context;
					const destination = context.createMediaStreamDestination();
					let mixed = false;
					for (const src of [displayStream, micStream]) {
						for (const track of src?.getAudioTracks() ?? []) {
							// SAFETY: createMediaStreamSource expects MediaStream with audio track
							const node = context.createMediaStreamSource(new MediaStream([track]));
							node.connect(destination);
							mixed = true;
						}
					}
					recordStream = new MediaStream();
					for (const track of displayStream.getVideoTracks()) recordStream.addTrack(track);
					if (mixed) {
						for (const track of destination.stream.getAudioTracks()) recordStream.addTrack(track);
					} else {
						for (const track of displayStream.getAudioTracks()) recordStream.addTrack(track);
					}
					this.error = `${message} — using display video with mixed audio fallback. If microphone is missing, try again without system audio.`;
					this.composited = false;
				} catch (fallbackError) {
					logger.warn('Audio mixer fallback also failed', fallbackError);
					recordStream = new MediaStream();
					for (const track of displayStream.getVideoTracks()) recordStream.addTrack(track);
					for (const track of displayStream.getAudioTracks()) recordStream.addTrack(track);
					this.error = `${message} — recording contains screen video and display audio only. Microphone was requested but not included; your display capture is still recoverable.`;
					this.composited = false;
				}
			}
		} else {
			recordStream = new MediaStream();
			for (const stream of [displayStream, cameraStream, micStream]) {
				if (!stream) continue;
				for (const track of stream.getTracks()) recordStream.addTrack(track);
			}
			this.composited = false;
		}

		this.stream = recordStream;
		const mimeType = recorderMimeType(source !== 'audio');
		if (hasWorkspace()) {
			try {
				const cursor = createCursorSidecar(source === 'screen' || source === 'screen-camera');
				const session = await createRecordingSession({
					source,
					mimeType,
					pip: source === 'screen-camera' ? this.pipGeometry : undefined,
					cursor
				});
				this.sessionId = session.id;
			} catch (error) {
				logger.warn('Could not create recording session', error);
				this.sessionId = null;
			}
		}

		this.chunks = [];
		this.fatalWriteError = null;
		this.mediaRecorder = new MediaRecorder(recordStream, mimeType ? { mimeType } : undefined);
		this.mediaRecorder.ondataavailable = (event: BlobEvent) => {
			if (event.data.size === 0) return;
			if (this.sessionId) {
				this.queueChunk(event.data);
			} else {
				const totalSize = this.chunks.reduce((sum, b) => sum + b.size, 0) + event.data.size;
				const maxChunks = 120;
				const maxBytes = 200 * 1024 * 1024;
				if (this.chunks.length >= maxChunks || totalSize > maxBytes) {
					logger.warn('In-memory recording buffer exceeded bounded limit without workspace');
					this.error =
						'Recording is too long without a workspace. Open a workspace to enable crash-safe long recordings.';
				} else {
					this.chunks.push(event.data);
				}
			}
		};
		this.mediaRecorder.onerror = (event: Event) => {
			// SAFETY: MediaRecorder error events carry optional DOMException error at boundary
			const err = (event as Event & { error?: DOMException }).error;
			logger.warn('MediaRecorder error', err);
			this.error = err?.message ?? 'Recording failed';
		};
		this.mediaRecorder.start(1000);
		this.recording = true;
		this.elapsedSeconds = 0;
		this.timer = setInterval(() => {
			this.elapsedSeconds += 1;
		}, 1000);
	}

	private queueChunk(blob: Blob): void {
		if (!this.sessionId) return;
		this.pendingWrites += 1;
		if (this.pendingWrites >= this.highWatermark && this.mediaRecorder?.state === 'recording') {
			try {
				this.mediaRecorder.pause();
			} catch {
				// Already paused or inactive
			}
			this.backpressure = true;
		}
		const sessionId = this.sessionId;
		const task = this.writeChain
			.then(() => appendRecordingChunk(sessionId, blob))
			.then(() => {
				this.pendingWrites -= 1;
				if (this.backpressure && this.pendingWrites <= this.lowWatermark) {
					this.backpressure = false;
					if (this.mediaRecorder?.state === 'paused') {
						try {
							this.mediaRecorder.resume();
						} catch {
							// Resume may fail if stopped
						}
					}
				}
			})
			.catch((error) => {
				this.pendingWrites -= 1;
				this.fatalWriteError = error;
				logger.warn('Chunk persist failed', error);
				if (this.backpressure && this.pendingWrites <= this.lowWatermark) {
					this.backpressure = false;
				}
				if (this.recording) {
					this.error =
						'Local storage is full or unavailable. Recording stopped but data already written remains recoverable.';
					queueMicrotask(() => {
						void this.stop({ reason: 'write-failure' });
					});
				}
			});
		this.writeChain = task.catch(() => {
			// Swallow to keep chain alive but preserve fatalWriteError
		});
	}

	private composite(
		screen: MediaStream,
		camera: MediaStream,
		mic: MediaStream | null
	): MediaStream {
		const videoTrack = screen.getVideoTracks()[0];
		const settings = videoTrack?.getSettings() ?? {};
		const width = Math.max(640, settings.width ?? 1280);
		const height = Math.max(360, settings.height ?? 720);
		const canvas = document.createElement('canvas');
		canvas.width = width;
		canvas.height = height;
		const context2d = canvas.getContext('2d');
		if (!context2d) throw new Error('Canvas unavailable');
		this.canvasEl = canvas;
		this.ctx2d = context2d;

		const screenVideo = document.createElement('video');
		screenVideo.srcObject = new MediaStream(screen.getVideoTracks());
		screenVideo.muted = true;
		void screenVideo.play().catch(() => {
			// Autoplay may be blocked until user gesture
		});
		const cameraVideo = document.createElement('video');
		cameraVideo.srcObject = new MediaStream(camera.getVideoTracks());
		cameraVideo.muted = true;
		void cameraVideo.play().catch(() => {
			// Autoplay may be blocked until user gesture
		});
		this.screenVideoEl = screenVideo;
		this.cameraVideoEl = cameraVideo;

		const draw = () => {
			if (this.rafId === null && !this.recording) return;
			if (!this.ctx2d) return;
			this.ctx2d.drawImage(screenVideo, 0, 0, width, height);
			const aspect = cameraVideo.videoWidth / Math.max(1, cameraVideo.videoHeight || 1);
			const rect = pipRectForCanvas(this.pipGeometry, width, height, aspect || 1);
			try {
				this.ctx2d.drawImage(cameraVideo, rect.x, rect.y, rect.width, rect.height);
			} catch {
				// Video not ready yet
			}
			this.rafId = requestAnimationFrame(draw);
		};
		this.rafId = requestAnimationFrame(draw);

		const canvasStream = canvas.captureStream(30);
		const result = new MediaStream(canvasStream.getVideoTracks());
		for (const track of screen.getAudioTracks()) result.addTrack(track);
		if (mic) {
			const context = new AudioContext();
			this.audioContext = context;
			const destination = context.createMediaStreamDestination();
			for (const src of [screen, mic]) {
				for (const track of src.getAudioTracks()) {
					// SAFETY: createMediaStreamSource expects MediaStream with audio track
					const node = context.createMediaStreamSource(new MediaStream([track]));
					node.connect(destination);
				}
			}
			for (const track of destination.stream.getAudioTracks()) result.addTrack(track);
		}
		return result;
	}

	async stop(options: { reason?: string } = {}): Promise<StopResult | null> {
		if (this.settled) return null;
		if (!this.recording || !this.mediaRecorder) {
			this.settled = true;
			this.cleanupAll();
			return null;
		}
		this.settled = true;
		this.recording = false;
		this.backpressure = false;
		if (this.timer) clearInterval(this.timer);
		this.timer = null;

		const recorder = this.mediaRecorder;
		const secondsAtStop = this.elapsedSeconds;
		const mimeType = recorder.mimeType || 'video/webm';
		const sessionId = this.sessionId;

		let stopError: unknown | null = null;
		try {
			await new Promise<void>((resolve, reject) => {
				let hardTimeout: ReturnType<typeof setTimeout> | null = null;
				const onStop = () => {
					if (hardTimeout) clearTimeout(hardTimeout);
					recorder.removeEventListener('error', onError);
					resolve();
				};
				const onError = (event: Event) => {
					if (hardTimeout) clearTimeout(hardTimeout);
					recorder.removeEventListener('stop', onStop);
					// SAFETY: MediaRecorder error events carry optional DOMException
					const err =
						(event as Event & { error?: DOMException }).error ?? new Error('Recorder error');
					reject(err);
				};
				recorder.addEventListener('stop', onStop, { once: true });
				recorder.addEventListener('error', onError, { once: true });
				hardTimeout = setTimeout(() => {
					logger.warn('MediaRecorder stop timeout - no stop event, keeping session recoverable');
					recorder.removeEventListener('stop', onStop);
					recorder.removeEventListener('error', onError);
					reject(new Error('MediaRecorder stop timed out - recording remains recoverable'));
				}, 4000);
				try {
					recorder.requestData();
					recorder.stop();
				} catch (error) {
					if (hardTimeout) clearTimeout(hardTimeout);
					recorder.removeEventListener('stop', onStop);
					recorder.removeEventListener('error', onError);
					reject(error);
				}
			});
		} catch (error) {
			logger.warn('Recorder stop failed', error);
			this.error = error instanceof Error ? error.message : String(error);
			if (sessionId) {
				try {
					await markSessionInterrupted(sessionId);
				} catch {
					// Mark interrupted best-effort
				}
			}
			stopError = error;
		}
		if (stopError) {
			try {
				await this.writeChain;
			} catch {
				// Write chain errors already handled
			}
			this.cleanupAll();
			return null;
		}

		// Await all queued chunk writes
		try {
			await this.writeChain;
		} catch {
			// Write chain errors already handled per-chunk
		}

		if (this.fatalWriteError) {
			if (sessionId) {
				try {
					await markSessionInterrupted(sessionId);
				} catch {
					// Mark interrupted best-effort
				}
			}
			this.cleanupAll();
			return null;
		}

		// Mark session ready (recoverable) before reading blob
		if (sessionId) {
			try {
				await markSessionReady(sessionId);
			} catch {
				// Mark ready best-effort
			}
		}

		// Prefer fully persisted blob after writes settle; never present in-memory fallback as complete persisted take when write failed
		let blob: Blob | null = null;
		if (sessionId) {
			try {
				blob = await readRecordingBlob(sessionId);
			} catch {
				// Read best-effort
			}
			if (!blob || blob.size === 0) {
				this.cleanupAll();
				return null;
			}
		} else {
			blob = new Blob(this.chunks, { type: mimeType });
		}

		this.cleanupAll();

		if (!blob || blob.size === 0) return null;

		return { blob, mimeType, seconds: secondsAtStop, sessionId: sessionId ?? undefined };
	}

	async cancel(): Promise<void> {
		if (this.settled && !this.recording) {
			this.cleanupAll();
			return;
		}
		this.settled = true;
		this.recording = false;
		this.backpressure = false;
		if (this.timer) clearInterval(this.timer);
		this.timer = null;
		const sessionId = this.sessionId;
		try {
			if (this.mediaRecorder?.state !== 'inactive') {
				this.mediaRecorder?.stop();
			}
		} catch {
			// Already stopped
		}
		const pending = this.writeChain;
		try {
			await pending;
		} catch {
			// Drain best-effort
		}
		this.writeChain = Promise.resolve();
		this.pendingWrites = 0;
		this.fatalWriteError = null;
		if (!sessionId) this.chunks = [];
		else this.chunks = [];
		if (sessionId) {
			try {
				await markSessionInterrupted(sessionId);
			} catch {
				// Mark interrupted best-effort
			}
		}
		this.cleanupAll();
	}

	private cleanupAll(): void {
		if (this.cleaned) return;
		this.cleaned = true;
		this.cleanupCompositeResources();
		for (const track of this.stream?.getTracks() ?? []) track.stop();
		for (const stream of this.sourceTracks) {
			for (const track of stream.getTracks()) track.stop();
		}
		this.stream = null;
		this.sourceTracks = [];
		this.mediaRecorder = null;
		this.sessionId = null;
		this.chunks = [];
		this.composited = false;
		if (this.timer) {
			clearInterval(this.timer);
			this.timer = null;
		}
		this.backpressure = false;
	}

	private cleanupCompositeResources(): void {
		if (this.rafId !== null) {
			cancelAnimationFrame(this.rafId);
			this.rafId = null;
		}
		if (this.audioContext) {
			void this.audioContext.close().catch(() => {
				// Close best-effort
			});
			this.audioContext = null;
		}
		if (this.screenVideoEl) {
			this.screenVideoEl.pause();
			this.screenVideoEl.srcObject = null;
			this.screenVideoEl = null;
		}
		if (this.cameraVideoEl) {
			this.cameraVideoEl.pause();
			this.cameraVideoEl.srcObject = null;
			this.cameraVideoEl = null;
		}
		this.canvasEl = null;
		this.ctx2d = null;
	}
}

function hasWorkspace(): boolean {
	try {
		requireWorkspaceRoot();
		return true;
	} catch {
		return false;
	}
}
