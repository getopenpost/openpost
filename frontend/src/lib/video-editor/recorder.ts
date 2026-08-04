import { estimateStorageBudget, saveRecordingManifest } from './storage';
import { VIDEO_EDITOR_ROOT, type RecordingManifest, type RecordingTrackManifest } from './types';

const CHUNK_INTERVAL_MS = 1_000;
const MANIFEST_FLUSH_MS = 2_000;
const BACKPRESSURE_PAUSE_BYTES = 64 * 1024 * 1024;
const BACKPRESSURE_RESUME_BYTES = 16 * 1024 * 1024;
const STORAGE_CHECK_MS = 5_000;
const MINIMUM_RECORDING_RESERVE_BYTES = 64 * 1024 * 1024;

export interface RecordingOptions {
	projectID: string;
	camera: boolean;
	microphone: boolean;
	systemAudio: boolean;
	timelineOffsetUS?: number;
	cameraDeviceID?: string;
	microphoneDeviceID?: string;
	countdownSeconds?: 0 | 3 | 5;
	onCountdown?: (secondsRemaining: number) => void;
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
	storage_available_bytes: number;
	storage_status: 'ok' | 'low' | 'stopping';
}

interface ActiveTrack {
	manifest: RecordingTrackManifest;
	stream: MediaStream;
	recorder: MediaRecorder;
	pendingBytes: number;
	nextChunkIndex: number;
	lastMediaTimestampUS: number;
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
	private storageTimer: number | undefined;
	private lastStateSampleAt = performance.now();
	private pausedForStorage = false;
	private storageCheckInFlight = false;
	private storageAvailableBytes = 0;
	private storageStatus: RecordingSessionState['storage_status'] = 'ok';
	private readonly recoveringInputs = new Set<'camera' | 'microphone'>();
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
							video: options.camera
								? {
										width: { ideal: 1280 },
										height: { ideal: 720 },
										...(options.cameraDeviceID
											? { deviceId: { exact: options.cameraDeviceID } }
											: {})
									}
								: false,
							audio: options.microphone
								? {
										echoCancellation: true,
										noiseSuppression: true,
										autoGainControl: true,
										...(options.microphoneDeviceID
											? { deviceId: { exact: options.microphoneDeviceID } }
											: {})
									}
								: false
						})
						.catch((cause) => {
							display.getTracks().forEach((track) => track.stop());
							throw cause;
						})
				: null;
		const countdownSeconds = options.countdownSeconds ?? 0;
		for (let remaining = countdownSeconds; remaining > 0; remaining -= 1) {
			options.onCountdown?.(remaining);
			await new Promise((resolve) => setTimeout(resolve, 1_000));
		}
		options.onCountdown?.(0);
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
		this.manifest.finalization_state = 'failed';
		this.manifest.updated_at = new Date().toISOString();
		await saveRecordingManifest(this.manifest);
		this.worker.terminate();
	}

	async switchInput(kind: 'camera' | 'microphone', deviceID: string): Promise<void> {
		if (this.stopped) throw new Error('This recording session has already stopped.');
		const previous = Array.from(this.tracks.values()).find(
			(track) => track.manifest.kind === kind && track.manifest.state === 'recording'
		);
		const atUS = this.sessionTimeUS();
		if (previous) {
			const segment = previous.manifest.segments.at(-1);
			if (segment) {
				segment.session_end_us = atUS;
				segment.media_end_us = previous.lastMediaTimestampUS;
				segment.reason_ended = 'device-switch';
			}
			previous.manifest.state = 'interrupted';
			await this.stopTrackRecorder(previous);
			previous.manifest.duration_us = Math.max(
				previous.manifest.duration_us,
				previous.lastMediaTimestampUS,
				atUS - previous.manifest.session_start_offset_us
			);
			previous.stream.getTracks().forEach((track) => track.stop());
		}
		this.manifest.events.push({
			type: 'device-switch',
			session_time_us: atUS,
			track_id: previous?.manifest.id,
			detail: kind
		});
		const stream = await navigator.mediaDevices.getUserMedia({
			video: kind === 'camera' ? { deviceId: { exact: deviceID } } : false,
			audio:
				kind === 'microphone'
					? {
							deviceId: { exact: deviceID },
							echoCancellation: true,
							noiseSuppression: true,
							autoGainControl: true
						}
					: false
		});
		const next = await this.addTrack(kind, stream, 'device-switch');
		await next.ready;
		next.recorder.start(CHUNK_INTERVAL_MS);
		await this.flushManifest();
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
		this.storageTimer = window.setInterval(() => void this.checkStorage(), STORAGE_CHECK_MS);
		void this.checkStorage();
		this.emitState();
	}

	private async addTrack(
		kind: RecordingTrackManifest['kind'],
		stream: MediaStream,
		reasonStarted: 'session-start' | 'device-switch' | 'recovery' = 'session-start'
	): Promise<ActiveTrack> {
		const id = `${kind}_${crypto.randomUUID()}`;
		const mimeType = selectRecordingMIME(kind === 'screen' || kind === 'camera');
		const recorder = new MediaRecorder(stream, {
			mimeType,
			videoBitsPerSecond: kind === 'screen' ? 10_000_000 : 3_000_000,
			audioBitsPerSecond: 192_000
		});
		const sessionStartOffsetUS = this.sessionTimeUS();
		const path = `projects/${this.options.projectID}/recordings/${id}.webm`;
		let resolveReady!: () => void;
		let resolveClosed!: () => void;
		const track: ActiveTrack = {
			manifest: {
				id,
				kind,
				path,
				mime_type: mimeType,
				session_start_offset_us: sessionStartOffsetUS,
				start_offset_us: (this.options.timelineOffsetUS ?? 0) + sessionStartOffsetUS,
				duration_us: 0,
				bytes_written: 0,
				verified_byte_length: 0,
				last_chunk_index: -1,
				last_chunk_timestamp_us: 0,
				chunks: [],
				segments: [
					{
						id: `${id}:segment:0`,
						path,
						mime_type: mimeType,
						session_start_us: sessionStartOffsetUS,
						media_start_us: 0,
						reason_started: reasonStarted
					}
				],
				state: 'recording'
			},
			stream,
			recorder,
			pendingBytes: 0,
			nextChunkIndex: 0,
			lastMediaTimestampUS: 0,
			writeTasks: new Set(),
			ready: new Promise((resolve) => (resolveReady = resolve)),
			resolveReady,
			closed: new Promise((resolve) => (resolveClosed = resolve)),
			resolveClosed
		};
		this.tracks.set(id, track);
		this.manifest.tracks.push(track.manifest);
		recorder.ondataavailable = (event) => this.queueChunk(track, event);
		recorder.onerror = (event) => {
			track.manifest.state = 'failed';
			track.manifest.error = event.error.message;
			void this.flushManifest();
		};
		for (const mediaTrack of stream.getTracks()) {
			mediaTrack.addEventListener('ended', () => {
				const unexpectedlyEnded = !this.stopped && track.manifest.state === 'recording';
				const atUS = this.sessionTimeUS();
				if (recorder.state !== 'inactive') recorder.stop();
				if (track.manifest.state === 'recording') track.manifest.state = 'interrupted';
				const segment = track.manifest.segments.at(-1);
				if (segment) {
					segment.session_end_us = atUS;
					segment.media_end_us = track.lastMediaTimestampUS;
					segment.reason_ended = kind === 'screen' ? 'external-stop' : 'device-loss';
				}
				this.manifest.events.push({
					type: kind === 'screen' ? 'external-stop' : 'device-loss',
					session_time_us: atUS,
					track_id: track.manifest.id,
					detail: kind
				});
				void this.flushManifest();
				if (unexpectedlyEnded && (kind === 'camera' || kind === 'microphone')) {
					void this.recoverLostInput(kind);
				}
			});
		}
		this.worker.postMessage({
			type: 'init',
			track_id: id,
			path: `${VIDEO_EDITOR_ROOT}/${track.manifest.path}`
		});
		return track;
	}

	private async writeChunk(
		track: ActiveTrack,
		blob: Blob,
		mediaTimestampMS: number
	): Promise<void> {
		if (blob.size === 0) return;
		const data = await blob.arrayBuffer();
		track.pendingBytes += data.byteLength;
		this.applyBackpressure();
		const index = track.nextChunkIndex++;
		const sessionEndUS = this.sessionTimeUS();
		const mediaEndUS = Math.max(
			track.lastMediaTimestampUS,
			Math.round(Math.max(0, mediaTimestampMS) * 1_000)
		);
		const mediaStartUS = track.lastMediaTimestampUS;
		const sessionStartUS = track.manifest.session_start_offset_us + Math.max(0, mediaStartUS);
		track.lastMediaTimestampUS = mediaEndUS;
		this.worker.postMessage(
			{
				type: 'chunk',
				track_id: track.manifest.id,
				index,
				timestamp_us: sessionEndUS,
				media_start_us: mediaStartUS,
				media_end_us: mediaEndUS,
				session_start_us: sessionStartUS,
				session_end_us: sessionEndUS,
				flush_sequence: this.manifest.flush_sequence,
				data
			},
			[data]
		);
	}

	private queueChunk(track: ActiveTrack, event: BlobEvent): void {
		const task = this.writeChunk(track, event.data, event.timecode).catch((cause) => {
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
				track.manifest.verified_byte_length =
					Number(message.position ?? 0) + Number(message.bytes ?? 0);
				track.manifest.last_chunk_index = Number(message.index ?? -1);
				track.manifest.last_chunk_timestamp_us = Number(message.timestamp_us ?? 0);
				track.manifest.chunks.push({
					index: track.manifest.last_chunk_index,
					timestamp_us: track.manifest.last_chunk_timestamp_us,
					position: Number(message.position ?? 0),
					size_bytes: Number(message.bytes ?? 0),
					sha256: String(message.checksum ?? ''),
					media_start_us: Number(message.media_start_us ?? 0),
					media_end_us: Number(message.media_end_us ?? 0),
					session_start_us: Number(message.session_start_us ?? 0),
					session_end_us: Number(message.session_end_us ?? 0),
					flush_sequence: Number(message.flush_sequence ?? 0)
				});
				track.manifest.duration_us = Math.max(
					track.manifest.duration_us,
					Number(message.media_end_us ?? 0)
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
			if (!this.pausedForStorage) {
				this.pausedForStorage = true;
				this.manifest.events.push({ type: 'pause', session_time_us: this.sessionTimeUS() });
			}
			for (const track of this.tracks.values()) {
				if (track.recorder.state === 'recording') track.recorder.pause();
			}
		} else if (pending <= BACKPRESSURE_RESUME_BYTES) {
			if (this.pausedForStorage) {
				this.pausedForStorage = false;
				this.manifest.events.push({ type: 'resume', session_time_us: this.sessionTimeUS() });
			}
			for (const track of this.tracks.values()) {
				if (track.recorder.state === 'paused') track.recorder.resume();
			}
		}
	}

	private async recoverLostInput(kind: 'camera' | 'microphone'): Promise<void> {
		if (this.stopped || this.recoveringInputs.has(kind)) return;
		this.recoveringInputs.add(kind);
		try {
			const preferredDeviceID =
				kind === 'camera' ? this.options.cameraDeviceID : this.options.microphoneDeviceID;
			const constraints = (deviceID?: string): MediaStreamConstraints => ({
				video:
					kind === 'camera'
						? {
								width: { ideal: 1280 },
								height: { ideal: 720 },
								...(deviceID ? { deviceId: { ideal: deviceID } } : {})
							}
						: false,
				audio:
					kind === 'microphone'
						? {
								echoCancellation: true,
								noiseSuppression: true,
								autoGainControl: true,
								...(deviceID ? { deviceId: { ideal: deviceID } } : {})
							}
						: false
			});
			let stream: MediaStream;
			try {
				stream = await navigator.mediaDevices.getUserMedia(constraints(preferredDeviceID));
			} catch {
				stream = await navigator.mediaDevices.getUserMedia(constraints());
			}
			if (this.stopped) {
				stream.getTracks().forEach((track) => track.stop());
				return;
			}
			const recovered = await this.addTrack(kind, stream, 'recovery');
			await recovered.ready;
			recovered.recorder.start(CHUNK_INTERVAL_MS);
			this.manifest.events.push({
				type: 'device-switch',
				session_time_us: this.sessionTimeUS(),
				track_id: recovered.manifest.id,
				detail: `${kind}:recovered`
			});
			await this.flushManifest();
		} catch (cause) {
			this.manifest.events.push({
				type: 'device-loss',
				session_time_us: this.sessionTimeUS(),
				detail: `${kind}:recovery-failed:${cause instanceof Error ? cause.name : 'unknown'}`
			});
			await this.flushManifest();
		} finally {
			this.recoveringInputs.delete(kind);
		}
	}

	private async checkStorage(): Promise<void> {
		if (this.stopped || this.storageCheckInFlight) return;
		this.storageCheckInFlight = true;
		try {
			const elapsedSeconds = Math.max(1, (performance.now() - this.startedAt) / 1_000);
			const bytesWritten = Array.from(this.tracks.values()).reduce(
				(total, track) => total + track.manifest.bytes_written + track.pendingBytes,
				0
			);
			const oneMinuteAtCurrentRate = Math.ceil((bytesWritten / elapsedSeconds) * 60 * 1.2);
			const reserve = Math.max(MINIMUM_RECORDING_RESERVE_BYTES, oneMinuteAtCurrentRate);
			const budget = await estimateStorageBudget(reserve);
			this.storageAvailableBytes = budget.available_bytes;
			if (budget.can_continue) {
				this.storageStatus =
					budget.available_bytes < reserve * 2 || budget.available_bytes < 256 * 1024 * 1024
						? 'low'
						: 'ok';
				return;
			}
			this.storageStatus = 'stopping';
			const atUS = this.sessionTimeUS();
			this.manifest.events.push({ type: 'storage-stop', session_time_us: atUS });
			for (const track of this.tracks.values()) {
				const segment = track.manifest.segments.at(-1);
				if (segment && segment.session_end_us === undefined) {
					segment.reason_ended = 'storage';
				}
			}
			this.emitState();
			void this.stop();
		} finally {
			this.storageCheckInFlight = false;
		}
	}

	private async finish(): Promise<RecordingManifest> {
		this.stopped = true;
		this.manifest.finalization_state = 'finalizing';
		this.clearTimers();
		for (const track of this.tracks.values()) {
			await this.stopTrackRecorder(track);
			const stoppedAtUS = this.sessionTimeUS();
			const segment = track.manifest.segments.at(-1);
			if (segment && segment.session_end_us === undefined) {
				segment.session_end_us = stoppedAtUS;
				segment.media_end_us = track.lastMediaTimestampUS;
				segment.reason_ended ??= 'session-stop';
			}
			track.manifest.duration_us = Math.max(
				track.manifest.duration_us,
				track.lastMediaTimestampUS,
				Math.max(
					0,
					(segment?.session_end_us ?? stoppedAtUS) - track.manifest.session_start_offset_us
				)
			);
			track.stream.getTracks().forEach((mediaTrack) => mediaTrack.stop());
			this.worker.postMessage({ type: 'close', track_id: track.manifest.id });
		}
		await Promise.all(Array.from(this.tracks.values(), (track) => track.closed));
		this.manifest.state = this.manifest.tracks.some((track) => track.state === 'failed')
			? 'recoverable'
			: 'complete';
		this.manifest.finalization_state =
			this.manifest.state === 'complete' ? 'complete' : 'recoverable';
		this.manifest.updated_at = new Date().toISOString();
		this.manifest.last_flushed_at = Date.now();
		await saveRecordingManifest(this.manifest);
		this.worker.terminate();
		return structuredClone(this.manifest);
	}

	private async stopTrackRecorder(track: ActiveTrack): Promise<void> {
		if (track.recorder.state !== 'inactive') {
			await new Promise<void>((resolve) => {
				track.recorder.addEventListener('stop', () => resolve(), { once: true });
				track.recorder.stop();
			});
		}
		// The final dataavailable event is dispatched before stop. Waiting here ensures
		// its OPFS write has joined the bounded task set before the manifest is consumed.
		await Promise.all(Array.from(track.writeTasks));
	}

	private async flushManifest(): Promise<void> {
		this.manifest.flush_sequence += 1;
		this.manifest.updated_at = new Date().toISOString();
		this.manifest.last_flushed_at = Date.now();
		await saveRecordingManifest(this.manifest);
	}

	private emitState(): void {
		const now = performance.now();
		const elapsedSinceSample = now - this.lastStateSampleAt;
		if (elapsedSinceSample > 2_000) {
			this.manifest.events.push({
				type: 'sleep-gap',
				session_time_us: this.sessionTimeUS(),
				duration_us: Math.round(elapsedSinceSample * 1_000)
			});
			void this.flushManifest();
		}
		this.lastStateSampleAt = now;
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
			),
			storage_available_bytes: this.storageAvailableBytes,
			storage_status: this.storageStatus
		});
	}

	private clearTimers(): void {
		if (this.flushTimer !== undefined) clearInterval(this.flushTimer);
		if (this.stateTimer !== undefined) clearInterval(this.stateTimer);
		if (this.storageTimer !== undefined) clearInterval(this.storageTimer);
	}

	private sessionTimeUS(): number {
		return Math.max(0, Math.round((performance.now() - this.startedAt) * 1_000));
	}
}

function recordingManifest(projectID: string): RecordingManifest {
	const now = new Date().toISOString();
	const sessionEpochMS = performance.timeOrigin + performance.now();
	return {
		manifest_version: 2,
		id: `recording_${crypto.randomUUID()}`,
		project_id: projectID,
		created_at: now,
		updated_at: now,
		session_epoch_ms: sessionEpochMS,
		session_started_at: sessionEpochMS,
		last_flushed_at: Date.now(),
		flush_sequence: 0,
		finalization_state: 'open',
		state: 'recording',
		tracks: [],
		events: []
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
