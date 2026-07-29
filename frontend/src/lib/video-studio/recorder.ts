import { saveRecordingManifest } from './storage';
import { VIDEO_STUDIO_ROOT, type RecordingManifest, type RecordingTrackManifest } from './types';

const CHUNK_INTERVAL_MS = 1_000;
const MANIFEST_FLUSH_MS = 2_000;
const BACKPRESSURE_PAUSE_BYTES = 64 * 1024 * 1024;
const BACKPRESSURE_RESUME_BYTES = 16 * 1024 * 1024;

export interface RecordingOptions {
	projectID: string;
	camera: boolean;
	microphone: boolean;
	systemAudio: boolean;
	timelineOffsetUS?: number;
	onState?: (state: RecordingSessionState) => void;
}

export interface RecordingSessionState {
	elapsed_ms: number;
	bytes_written: number;
	pending_bytes: number;
	paused_for_storage: boolean;
	camera_active: boolean;
	microphone_active: boolean;
	system_audio_active: boolean;
}

interface ActiveTrack {
	manifest: RecordingTrackManifest;
	stream: MediaStream;
	recorder: MediaRecorder;
	pendingBytes: number;
	nextChunkIndex: number;
	writeTasks: Set<Promise<void>>;
	ready: Promise<void>;
	resolveReady: () => void;
	closed: Promise<void>;
	resolveClosed: () => void;
}

export class VideoRecordingSession {
	private readonly options: RecordingOptions;
	private readonly worker: Worker;
	private readonly tracks = new Map<string, ActiveTrack>();
	private readonly startedAt = performance.now();
	private flushTimer: number | undefined;
	private stateTimer: number | undefined;
	private stopped = false;
	private stopPromise: Promise<RecordingManifest> | null = null;
	readonly manifest: RecordingManifest;

	private constructor(options: RecordingOptions, manifest: RecordingManifest) {
		this.options = options;
		this.manifest = manifest;
		this.worker = new Worker(new URL('./recording-writer.worker.ts', import.meta.url), {
			type: 'module'
		});
		this.worker.onmessage = (event) => this.handleWorkerMessage(event);
	}

	static async start(options: RecordingOptions): Promise<VideoRecordingSession> {
		const display = await navigator.mediaDevices.getDisplayMedia({
			video: { frameRate: { ideal: 30, max: 60 } },
			audio: options.systemAudio,
			selfBrowserSurface: 'exclude',
			systemAudio: options.systemAudio ? 'include' : 'exclude',
			surfaceSwitching: 'include'
		} as DisplayMediaStreamOptions);
		const user =
			options.camera || options.microphone
				? await navigator.mediaDevices
						.getUserMedia({
							video: options.camera ? { width: { ideal: 1280 }, height: { ideal: 720 } } : false,
							audio: options.microphone
								? { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
								: false
						})
						.catch((cause) => {
							display.getTracks().forEach((track) => track.stop());
							throw cause;
						})
				: null;
		const manifest = recordingManifest(options.projectID);
		const session = new VideoRecordingSession(options, manifest);
		await session.initialize(display, user);
		return session;
	}

	static async startVoiceover(
		options: Pick<RecordingOptions, 'projectID' | 'timelineOffsetUS' | 'onState'>
	): Promise<VideoRecordingSession> {
		const user = await navigator.mediaDevices.getUserMedia({
			audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
			video: false
		});
		const microphoneTrack = user.getAudioTracks()[0];
		if (!microphoneTrack) {
			user.getTracks().forEach((track) => track.stop());
			throw new Error('The browser did not provide a microphone audio track.');
		}
		const fullOptions: RecordingOptions = {
			...options,
			camera: false,
			microphone: true,
			systemAudio: false
		};
		const session = new VideoRecordingSession(fullOptions, recordingManifest(options.projectID));
		await session.addTrack('microphone', new MediaStream([microphoneTrack]));
		await session.beginRecording();
		return session;
	}

	async stop(): Promise<RecordingManifest> {
		if (this.stopPromise) return await this.stopPromise;
		this.stopPromise = this.finish();
		return await this.stopPromise;
	}

	async cancel(): Promise<void> {
		this.stopped = true;
		this.clearTimers();
		for (const [id, track] of this.tracks) {
			if (track.recorder.state !== 'inactive') track.recorder.stop();
			track.stream.getTracks().forEach((mediaTrack) => mediaTrack.stop());
			this.worker.postMessage({ type: 'abort', track_id: id });
		}
		this.manifest.state = 'failed';
		this.manifest.updated_at = new Date().toISOString();
		await saveRecordingManifest(this.manifest);
		this.worker.terminate();
	}

	private async initialize(display: MediaStream, user: MediaStream | null): Promise<void> {
		const screenTrack = display.getVideoTracks()[0];
		if (!screenTrack) throw new Error('The browser did not provide a screen video track.');
		await this.addTrack('screen', new MediaStream([screenTrack]));
		const systemAudio = display.getAudioTracks()[0];
		if (systemAudio) await this.addTrack('system-audio', new MediaStream([systemAudio]));
		const cameraTrack = user?.getVideoTracks()[0];
		if (cameraTrack) await this.addTrack('camera', new MediaStream([cameraTrack]));
		const microphoneTrack = user?.getAudioTracks()[0];
		if (microphoneTrack) await this.addTrack('microphone', new MediaStream([microphoneTrack]));
		screenTrack.addEventListener('ended', () => {
			if (!this.stopped) void this.stop();
		});
		await this.beginRecording();
	}

	private async beginRecording(): Promise<void> {
		await saveRecordingManifest(this.manifest);
		for (const track of this.tracks.values()) {
			await track.ready;
			track.recorder.start(CHUNK_INTERVAL_MS);
		}
		this.flushTimer = window.setInterval(() => void this.flushManifest(), MANIFEST_FLUSH_MS);
		this.stateTimer = window.setInterval(() => this.emitState(), 250);
		this.emitState();
	}

	private async addTrack(kind: RecordingTrackManifest['kind'], stream: MediaStream): Promise<void> {
		const id = `${kind}_${crypto.randomUUID()}`;
		const mimeType = selectRecordingMIME(kind === 'screen' || kind === 'camera');
		const recorder = new MediaRecorder(stream, {
			mimeType,
			videoBitsPerSecond: kind === 'screen' ? 10_000_000 : 3_000_000,
			audioBitsPerSecond: 192_000
		});
		let resolveReady!: () => void;
		let resolveClosed!: () => void;
		const track: ActiveTrack = {
			manifest: {
				id,
				kind,
				path: `projects/${this.options.projectID}/recordings/${id}.webm`,
				mime_type: mimeType,
				start_offset_us:
					(this.options.timelineOffsetUS ?? 0) +
					Math.max(0, Math.round((performance.now() - this.startedAt) * 1_000)),
				duration_us: 0,
				bytes_written: 0,
				last_chunk_index: -1,
				last_chunk_timestamp_us: 0,
				chunks: [],
				state: 'recording'
			},
			stream,
			recorder,
			pendingBytes: 0,
			nextChunkIndex: 0,
			writeTasks: new Set(),
			ready: new Promise((resolve) => (resolveReady = resolve)),
			resolveReady,
			closed: new Promise((resolve) => (resolveClosed = resolve)),
			resolveClosed
		};
		this.tracks.set(id, track);
		this.manifest.tracks.push(track.manifest);
		recorder.ondataavailable = (event) => this.queueChunk(track, event.data);
		recorder.onerror = (event) => {
			track.manifest.state = 'failed';
			track.manifest.error = event.error.message;
			void this.flushManifest();
		};
		for (const mediaTrack of stream.getTracks()) {
			mediaTrack.addEventListener('ended', () => {
				if (recorder.state !== 'inactive') recorder.stop();
				if (track.manifest.state === 'recording') track.manifest.state = 'interrupted';
				void this.flushManifest();
			});
		}
		this.worker.postMessage({
			type: 'init',
			track_id: id,
			path: `${VIDEO_STUDIO_ROOT}/${track.manifest.path}`
		});
	}

	private async writeChunk(track: ActiveTrack, blob: Blob): Promise<void> {
		if (blob.size === 0) return;
		const data = await blob.arrayBuffer();
		track.pendingBytes += data.byteLength;
		this.applyBackpressure();
		const index = track.nextChunkIndex++;
		const timestampUS = Math.max(0, Math.round((performance.now() - this.startedAt) * 1_000));
		this.worker.postMessage(
			{ type: 'chunk', track_id: track.manifest.id, index, timestamp_us: timestampUS, data },
			[data]
		);
	}

	private queueChunk(track: ActiveTrack, blob: Blob): void {
		const task = this.writeChunk(track, blob).catch((cause) => {
			track.manifest.state = 'failed';
			track.manifest.error =
				cause instanceof Error ? cause.message : 'A recording chunk could not be prepared.';
			void this.flushManifest();
		});
		track.writeTasks.add(task);
		void task.finally(() => track.writeTasks.delete(task));
	}

	private handleWorkerMessage(event: MessageEvent): void {
		const message = event.data as Record<string, unknown>;
		const track = this.tracks.get(String(message.track_id ?? ''));
		if (!track) return;
		switch (message.type) {
			case 'ready':
				track.resolveReady();
				break;
			case 'written':
				track.pendingBytes = Math.max(0, track.pendingBytes - Number(message.bytes ?? 0));
				track.manifest.bytes_written += Number(message.bytes ?? 0);
				track.manifest.last_chunk_index = Number(message.index ?? -1);
				track.manifest.last_chunk_timestamp_us = Number(message.timestamp_us ?? 0);
				track.manifest.chunks.push({
					index: track.manifest.last_chunk_index,
					timestamp_us: track.manifest.last_chunk_timestamp_us,
					position: Number(message.position ?? 0),
					size_bytes: Number(message.bytes ?? 0),
					sha256: String(message.checksum ?? '')
				});
				track.manifest.duration_us = Math.max(
					track.manifest.duration_us,
					track.manifest.last_chunk_timestamp_us - track.manifest.start_offset_us
				);
				this.applyBackpressure();
				break;
			case 'closed':
				track.manifest.state = track.manifest.state === 'failed' ? 'failed' : 'complete';
				track.resolveClosed();
				break;
			case 'error':
				track.manifest.state = 'failed';
				track.manifest.error = String(message.message ?? 'Recording write failed.');
				track.resolveClosed();
				void this.flushManifest();
				break;
		}
	}

	private applyBackpressure(): void {
		const pending = Array.from(this.tracks.values()).reduce(
			(total, track) => total + track.pendingBytes,
			0
		);
		if (pending >= BACKPRESSURE_PAUSE_BYTES) {
			for (const track of this.tracks.values()) {
				if (track.recorder.state === 'recording') track.recorder.pause();
			}
		} else if (pending <= BACKPRESSURE_RESUME_BYTES) {
			for (const track of this.tracks.values()) {
				if (track.recorder.state === 'paused') track.recorder.resume();
			}
		}
	}

	private async finish(): Promise<RecordingManifest> {
		this.stopped = true;
		this.clearTimers();
		for (const track of this.tracks.values()) {
			if (track.recorder.state !== 'inactive') {
				await new Promise<void>((resolve) => {
					track.recorder.addEventListener('stop', () => resolve(), { once: true });
					track.recorder.stop();
				});
			}
			await Promise.all(track.writeTasks);
			track.stream.getTracks().forEach((mediaTrack) => mediaTrack.stop());
			this.worker.postMessage({ type: 'close', track_id: track.manifest.id });
		}
		await Promise.all(Array.from(this.tracks.values(), (track) => track.closed));
		this.manifest.state = this.manifest.tracks.some((track) => track.state === 'failed')
			? 'recoverable'
			: 'complete';
		this.manifest.updated_at = new Date().toISOString();
		this.manifest.last_flushed_at = Date.now();
		await saveRecordingManifest(this.manifest);
		this.worker.terminate();
		return structuredClone(this.manifest);
	}

	private async flushManifest(): Promise<void> {
		this.manifest.updated_at = new Date().toISOString();
		this.manifest.last_flushed_at = Date.now();
		await saveRecordingManifest(this.manifest);
	}

	private emitState(): void {
		const tracks = Array.from(this.tracks.values());
		this.options.onState?.({
			elapsed_ms: performance.now() - this.startedAt,
			bytes_written: tracks.reduce((total, track) => total + track.manifest.bytes_written, 0),
			pending_bytes: tracks.reduce((total, track) => total + track.pendingBytes, 0),
			paused_for_storage: tracks.some((track) => track.recorder.state === 'paused'),
			camera_active: tracks.some(
				(track) => track.manifest.kind === 'camera' && track.manifest.state === 'recording'
			),
			microphone_active: tracks.some(
				(track) => track.manifest.kind === 'microphone' && track.manifest.state === 'recording'
			),
			system_audio_active: tracks.some(
				(track) => track.manifest.kind === 'system-audio' && track.manifest.state === 'recording'
			)
		});
	}

	private clearTimers(): void {
		if (this.flushTimer !== undefined) clearInterval(this.flushTimer);
		if (this.stateTimer !== undefined) clearInterval(this.stateTimer);
	}
}

function recordingManifest(projectID: string): RecordingManifest {
	const now = new Date().toISOString();
	return {
		id: `recording_${crypto.randomUUID()}`,
		project_id: projectID,
		created_at: now,
		updated_at: now,
		session_started_at: performance.timeOrigin + performance.now(),
		last_flushed_at: Date.now(),
		state: 'recording',
		tracks: []
	};
}

function selectRecordingMIME(video: boolean): string {
	const candidates = video
		? ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']
		: ['audio/webm;codecs=opus', 'audio/webm'];
	const supported = candidates.find((mimeType) => MediaRecorder.isTypeSupported(mimeType));
	if (!supported) throw new Error('This browser does not provide a compatible recording encoder.');
	return supported;
}
