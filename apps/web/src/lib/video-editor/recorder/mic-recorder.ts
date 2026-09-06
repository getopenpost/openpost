/** Browser microphone capture used by timeline voiceover recording. */

const MIME_CANDIDATES = [
	'audio/webm;codecs=opus',
	'audio/webm',
	'audio/ogg;codecs=opus',
	'audio/mp4'
] as const;

export interface MicRecorderOptions {
	deviceId?: string;
	noiseSuppression?: boolean;
	autoGainControl?: boolean;
	onLevel?: (level: number) => void;
}

export interface MicRecorderResult {
	blob: Blob;
	mimeType: string;
	durationMs: number;
}

export interface MicMonitorHandle {
	stop(): void;
}

export function hasMicRecordingSupport(): boolean {
	return (
		typeof navigator !== 'undefined' &&
		Boolean(navigator.mediaDevices?.getUserMedia) &&
		typeof MediaRecorder !== 'undefined'
	);
}

export function pickMicRecorderMimeType(): string {
	if (typeof MediaRecorder === 'undefined') return '';
	return MIME_CANDIDATES.find((candidate) => MediaRecorder.isTypeSupported(candidate)) ?? '';
}

export function micRecordingExtension(mimeType: string): string {
	if (mimeType.includes('ogg')) return 'ogg';
	if (mimeType.includes('mp4')) return 'm4a';
	return 'webm';
}

export function microphoneConstraints(options: MicRecorderOptions): MediaTrackConstraints {
	const constraints: MediaTrackConstraints = {
		echoCancellation: true,
		noiseSuppression: options.noiseSuppression ?? true,
		autoGainControl: options.autoGainControl ?? false
	};
	if (options.deviceId) constraints.deviceId = { exact: options.deviceId };
	return constraints;
}

export async function enumerateMicrophones(): Promise<MediaDeviceInfo[]> {
	if (!navigator.mediaDevices?.enumerateDevices) return [];
	return (await navigator.mediaDevices.enumerateDevices()).filter(
		(device) => device.kind === 'audioinput'
	);
}

type AudioContextScope = typeof globalThis & {
	webkitAudioContext?: typeof AudioContext;
};

export function createBestEffortAudioContext(): AudioContext | null {
	// SAFETY: globalThis is augmented with webkitAudioContext for Safari; existence is checked before construction.
	const scope = globalThis as AudioContextScope;
	const Context = scope.AudioContext ?? scope.webkitAudioContext;
	if (!Context) return null;
	try {
		return new Context();
	} catch {
		return null;
	}
}

export function startMicLevelMeter(
	stream: MediaStream,
	onLevel?: (level: number) => void
): () => void {
	if (!onLevel) return () => undefined;
	const context = createBestEffortAudioContext();
	if (!context) {
		onLevel(0);
		return () => undefined;
	}
	let source: MediaStreamAudioSourceNode;
	let analyser: AnalyserNode;
	try {
		source = context.createMediaStreamSource(stream);
		analyser = context.createAnalyser();
		source.connect(analyser);
	} catch {
		void context.close().catch(() => undefined);
		onLevel(0);
		return () => undefined;
	}
	analyser.fftSize = 512;
	analyser.smoothingTimeConstant = 0.72;
	const samples = new Float32Array(analyser.fftSize);
	let animationFrame: number | null = null;
	let stopped = false;
	const update = () => {
		if (stopped) return;
		analyser.getFloatTimeDomainData(samples);
		let energy = 0;
		for (const sample of samples) energy += sample * sample;
		onLevel(Math.min(1, Math.sqrt(energy / samples.length) * 3));
		animationFrame = requestAnimationFrame(update);
	};
	update();
	return () => {
		stopped = true;
		if (animationFrame !== null) cancelAnimationFrame(animationFrame);
		source.disconnect();
		analyser.disconnect();
		void context.close().catch(() => undefined);
		onLevel(0);
	};
}

export async function startMicLevelMonitor(options: MicRecorderOptions): Promise<MicMonitorHandle> {
	const stream = await navigator.mediaDevices.getUserMedia({
		audio: microphoneConstraints(options),
		video: false
	});
	const stopMeter = startMicLevelMeter(stream, options.onLevel);
	let stopped = false;
	return {
		stop(): void {
			if (stopped) return;
			stopped = true;
			stopMeter();
			for (const track of stream.getTracks()) track.stop();
		}
	};
}

type MicRecorderState = 'idle' | 'recording' | 'paused';

export class MicRecorder {
	private state: MicRecorderState = 'idle';
	private stream: MediaStream | null = null;
	private mediaRecorder: MediaRecorder | null = null;
	private chunks: Blob[] = [];
	private mimeType = '';
	private stopMeter: (() => void) | null = null;
	private startedAtMs = 0;
	private accumulatedMs = 0;

	get currentState(): MicRecorderState {
		return this.state;
	}

	async start(options: MicRecorderOptions = {}): Promise<void> {
		if (this.state !== 'idle' || this.stream) throw new Error('Microphone recorder is active.');
		const stream = await navigator.mediaDevices.getUserMedia({
			audio: microphoneConstraints(options),
			video: false
		});
		this.stream = stream;
		try {
			this.stopMeter = startMicLevelMeter(stream, options.onLevel);
			this.mimeType = pickMicRecorderMimeType();
			const recorder = new MediaRecorder(
				stream,
				this.mimeType ? { mimeType: this.mimeType } : undefined
			);
			this.mimeType = recorder.mimeType || this.mimeType || 'audio/webm';
			this.mediaRecorder = recorder;
			this.chunks = [];
			recorder.addEventListener('dataavailable', (event) => {
				if (event.data.size > 0) this.chunks.push(event.data);
			});
			await new Promise<void>((resolve, reject) => {
				const onStart = () => {
					recorder.removeEventListener('error', onError);
					this.startedAtMs = performance.now();
					this.accumulatedMs = 0;
					this.state = 'recording';
					resolve();
				};
				const onError = (event: Event) => {
					recorder.removeEventListener('start', onStart);
					// SAFETY: MediaRecorder error events carry an optional DOMException `error` when capture fails.
					reject((event as Event & { error?: DOMException }).error ?? new Error('Capture failed.'));
				};
				recorder.addEventListener('start', onStart, { once: true });
				recorder.addEventListener('error', onError, { once: true });
				recorder.start(1_000);
			});
		} catch (error) {
			this.dispose(true);
			throw error;
		}
	}

	pause(): void {
		if (this.state !== 'recording' || !this.mediaRecorder) return;
		this.accumulatedMs += performance.now() - this.startedAtMs;
		this.mediaRecorder.pause();
		this.state = 'paused';
	}

	resume(): void {
		if (this.state !== 'paused' || !this.mediaRecorder) return;
		this.mediaRecorder.resume();
		this.startedAtMs = performance.now();
		this.state = 'recording';
	}

	elapsedMs(): number {
		return this.state === 'recording'
			? this.accumulatedMs + performance.now() - this.startedAtMs
			: this.accumulatedMs;
	}

	async stop(): Promise<MicRecorderResult> {
		const recorder = this.mediaRecorder;
		if (!recorder || this.state === 'idle') throw new Error('Microphone recorder is idle.');
		if (this.state === 'recording') this.accumulatedMs += performance.now() - this.startedAtMs;
		const durationMs = this.accumulatedMs;
		let blob: Blob;
		try {
			blob = await new Promise<Blob>((resolve, reject) => {
				const onStop = () => {
					recorder.removeEventListener('error', onError);
					resolve(new Blob(this.chunks, { type: this.mimeType }));
				};
				const onError = (event: Event) => {
					recorder.removeEventListener('stop', onStop);
					// SAFETY: MediaRecorder error events carry an optional DOMException `error` when capture fails.
					reject((event as Event & { error?: DOMException }).error ?? new Error('Capture failed.'));
				};
				recorder.addEventListener('stop', onStop, { once: true });
				recorder.addEventListener('error', onError, { once: true });
				recorder.stop();
			});
		} catch (error) {
			this.dispose(true);
			throw error;
		}
		const mimeType = this.mimeType;
		this.dispose(false);
		return { blob, mimeType, durationMs };
	}

	cancel(): void {
		this.dispose(true);
	}

	private dispose(stopRecorder: boolean): void {
		this.state = 'idle';
		this.stopMeter?.();
		this.stopMeter = null;
		if (stopRecorder && this.mediaRecorder?.state !== 'inactive') {
			try {
				this.mediaRecorder?.stop();
			} catch {
				// The recorder may already be stopping after a device error.
			}
		}
		this.mediaRecorder = null;
		this.chunks = [];
		for (const track of this.stream?.getTracks() ?? []) track.stop();
		this.stream = null;
		this.accumulatedMs = 0;
		this.startedAtMs = 0;
	}
}
