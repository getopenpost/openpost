import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	ScreenCaptureRecorder,
	estimateBytesPerMinute,
	mapRecorderError,
	pickAudioMimeType,
	pickVideoMimeType
} from './recorder.svelte';

class FakeTrack {
	enabled = true;
	stop = vi.fn();
	getSettings = () => ({});
	addEventListener = vi.fn();
	removeEventListener = vi.fn();

	constructor(readonly kind: 'audio' | 'video') {}
}

class FakeStream {
	constructor(readonly tracks: FakeTrack[]) {}
	getTracks(): FakeTrack[] {
		return this.tracks;
	}
	getVideoTracks(): FakeTrack[] {
		return this.tracks.filter((track) => track.kind === 'video');
	}
	getAudioTracks(): FakeTrack[] {
		return this.tracks.filter((track) => track.kind === 'audio');
	}
}

function mediaStream(stream: FakeStream): MediaStream {
	// SAFETY: Tests pass this controlled subset only to code that reads these MediaStream methods.
	return stream as MediaStream;
}

function fakeStream(stream: MediaStream): FakeStream {
	// SAFETY: FakeMediaRecorder only receives streams made by mediaStream in this test.
	return stream as FakeStream;
}

class FakeMediaRecorder extends EventTarget {
	static instances: FakeMediaRecorder[] = [];
	static isTypeSupported(type: string): boolean {
		return type === 'video/webm;codecs=vp9,opus' || type === 'audio/webm;codecs=opus';
	}

	mimeType: string;
	state: RecordingState = 'inactive';
	readonly options: MediaRecorderOptions | undefined;
	requestData = vi.fn();
	pause = vi.fn();
	resume = vi.fn();
	start = vi.fn((timeslice?: number) => {
		this.state = 'recording';
		this.timeslice = timeslice;
		queueMicrotask(() => this.dispatchEvent(new Event('start')));
	});
	stop = vi.fn(() => {
		this.state = 'inactive';
		this.emitChunk(`final-${this.kind}`);
		this.dispatchEvent(new Event('stop'));
	});
	timeslice: number | undefined;
	readonly kind: string;

	constructor(stream: MediaStream, options?: MediaRecorderOptions) {
		super();
		this.options = options;
		this.kind = fakeStream(stream)
			.getTracks()
			.map((track) => track.kind)
			.join('+');
		this.mimeType = options?.mimeType ?? 'video/webm';
		FakeMediaRecorder.instances.push(this);
	}

	emitChunk(value: string): void {
		this.emitBlob(new Blob([value], { type: this.mimeType }));
	}

	emitBlob(data: Blob): void {
		this.dispatchEvent(
			Object.assign(new Event('dataavailable'), {
				data
			})
		);
	}
}

describe('ScreenCaptureRecorder', () => {
	let now = 1_000;
	let displayStream: FakeStream;
	let cameraStream: FakeStream;
	let microphoneStream: FakeStream;
	let getDisplayMedia: ReturnType<typeof vi.fn>;
	let getUserMedia: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		now = 1_000;
		FakeMediaRecorder.instances = [];
		displayStream = new FakeStream([new FakeTrack('video'), new FakeTrack('audio')]);
		cameraStream = new FakeStream([new FakeTrack('video')]);
		microphoneStream = new FakeStream([new FakeTrack('audio')]);
		vi.spyOn(performance, 'now').mockImplementation(() => {
			const value = now;
			now += 25;
			return value;
		});
		getDisplayMedia = vi.fn(async () => mediaStream(displayStream));
		getUserMedia = vi.fn(async (constraints: MediaStreamConstraints) =>
			constraints.video ? mediaStream(cameraStream) : mediaStream(microphoneStream)
		);
		vi.stubGlobal('navigator', {
			mediaDevices: {
				getDisplayMedia,
				getUserMedia,
				enumerateDevices: vi.fn(async () => []),
				// SAFETY: test returns only cursor flag for capability probe
				getSupportedConstraints: () => ({ cursor: true }) satisfies MediaTrackSupportedConstraints,
				addEventListener: vi.fn(),
				removeEventListener: vi.fn()
			},
			storage: { estimate: async () => ({ quota: 1_000_000_000, usage: 0 }) }
		});
		vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
	});

	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
	});

	it('chooses supported MIME types and estimates each selected source', () => {
		expect(pickVideoMimeType()).toBe('video/webm;codecs=vp9,opus');
		expect(pickAudioMimeType()).toBe('audio/webm;codecs=opus');
		expect(
			estimateBytesPerMinute({ screen: true, camera: true, microphone: true })
		).toBeGreaterThan(estimateBytesPerMinute({ screen: false, camera: false, microphone: true }));
	});

	it('applies persisted quality, facing, and microphone processing preferences', async () => {
		const recorder = new ScreenCaptureRecorder();
		await recorder.startWithSelection(
			{ screen: true, camera: true, microphone: true },
			{
				videoResolution: '2160p',
				videoFrameRate: 60,
				cameraFacingMode: 'environment',
				noiseSuppression: false,
				autoGainControl: true
			}
		);

		expect(getDisplayMedia).toHaveBeenCalledWith({
			video: {
				cursor: 'always',
				width: { ideal: 3840 },
				height: { ideal: 2160 },
				frameRate: { ideal: 60 }
			},
			audio: true
		});
		expect(getUserMedia).toHaveBeenNthCalledWith(1, {
			video: {
				width: { ideal: 3840 },
				height: { ideal: 2160 },
				frameRate: { ideal: 60 },
				facingMode: { ideal: 'environment' }
			},
			audio: false
		});
		expect(getUserMedia).toHaveBeenNthCalledWith(2, {
			audio: {
				echoCancellation: true,
				noiseSuppression: false,
				autoGainControl: true
			},
			video: false
		});
		expect(FakeMediaRecorder.instances.map((instance) => instance.options)).toEqual([
			{
				mimeType: 'video/webm;codecs=vp9,opus',
				videoBitsPerSecond: 40_000_000,
				audioBitsPerSecond: 128_000
			},
			{
				mimeType: 'video/webm;codecs=vp9,opus',
				videoBitsPerSecond: 40_000_000
			},
			{
				mimeType: 'audio/webm;codecs=opus',
				audioBitsPerSecond: 128_000
			}
		]);
		await recorder.cancel();
	});

	it('records separate ordered artifacts on one monotonic timebase', async () => {
		const recorder = new ScreenCaptureRecorder();
		await recorder.startWithSelection(
			{ screen: true, camera: true, microphone: true },
			{ includeSystemAudio: true }
		);
		expect(getDisplayMedia).toHaveBeenCalledOnce();
		expect(getDisplayMedia).toHaveBeenCalledWith({
			video: { cursor: 'always' },
			audio: true
		});
		expect(getUserMedia).toHaveBeenCalledTimes(2);
		expect(getUserMedia).toHaveBeenNthCalledWith(1, { video: {}, audio: false });
		expect(getUserMedia).toHaveBeenNthCalledWith(2, {
			audio: {
				echoCancellation: true,
				noiseSuppression: true,
				autoGainControl: false
			},
			video: false
		});
		expect(FakeMediaRecorder.instances).toHaveLength(3);
		for (const instance of FakeMediaRecorder.instances) {
			expect(instance.start).toHaveBeenCalledWith(1000);
		}

		FakeMediaRecorder.instances[0]!.emitChunk('screen-a');
		FakeMediaRecorder.instances[0]!.emitChunk('screen-b');
		FakeMediaRecorder.instances[2]!.emitChunk('mic-a');
		now += 2_000;

		const artifacts = await recorder.stop();
		expect(artifacts.map((artifact) => artifact.kind).sort()).toEqual([
			'camera',
			'microphone',
			'screen'
		]);
		const screen = artifacts.find((artifact) => artifact.kind === 'screen');
		expect(await screen?.blob.text()).toBe('screen-ascreen-bfinal-video+audio');
		expect(Math.min(...artifacts.map((artifact) => artifact.startOffsetMs))).toBe(0);
		for (const artifact of artifacts) {
			expect(artifact.startOffsetMs).toBeGreaterThanOrEqual(0);
			expect(artifact.startOffsetMs).toBeLessThan(500);
			expect(artifact.durationMs).toBeGreaterThan(0);
			expect(artifact.sizeBytes).toBe(artifact.blob.size);
			expect(artifact.scratchId).toMatch(/^(screen|camera|microphone)-/);
		}
		expect(displayStream.getTracks().every((track) => track.stop.mock.calls.length === 1)).toBe(
			true
		);
		expect(recorder.status).toBe('idle');
		expect(recorder.screenStream).toBeNull();
		await recorder.clearRecoverableAndDiscard();
		expect(recorder.lastArtifacts).toEqual([]);
	});

	it('releases an earlier stream when a later permission request fails', async () => {
		getUserMedia.mockRejectedValueOnce(new DOMException('Denied', 'NotAllowedError'));
		const recorder = new ScreenCaptureRecorder();
		await expect(
			recorder.startWithSelection(
				{ screen: true, camera: true },
				{ cameraDeviceId: 'selected-camera' }
			)
		).rejects.toMatchObject({ name: 'NotAllowedError' });
		expect(recorder.error).toBe('permission-denied');
		expect(getUserMedia).toHaveBeenCalledOnce();
		expect(displayStream.getTracks().every((track) => track.stop.mock.calls.length === 1)).toBe(
			true
		);
		expect(recorder.screenStream).toBeNull();
	});

	it('falls back to default inputs when saved camera and microphone devices disappeared', async () => {
		let request = 0;
		getUserMedia.mockImplementation(async (constraints: MediaStreamConstraints) => {
			request += 1;
			if (request === 1 || request === 3) {
				throw new DOMException('Saved device is unavailable', 'OverconstrainedError');
			}
			return constraints.video ? mediaStream(cameraStream) : mediaStream(microphoneStream);
		});
		const onDeviceFallback = vi.fn();
		const recorder = new ScreenCaptureRecorder();

		await recorder.startWithSelection(
			{ screen: false, camera: true, microphone: true },
			{
				cameraDeviceId: 'missing-camera',
				microphoneDeviceId: 'missing-microphone',
				onDeviceFallback
			}
		);

		expect(getUserMedia).toHaveBeenNthCalledWith(1, {
			video: { deviceId: { exact: 'missing-camera' } },
			audio: false
		});
		expect(getUserMedia).toHaveBeenNthCalledWith(2, { video: {}, audio: false });
		expect(getUserMedia).toHaveBeenNthCalledWith(3, {
			audio: {
				echoCancellation: true,
				noiseSuppression: true,
				autoGainControl: false,
				deviceId: { exact: 'missing-microphone' }
			},
			video: false
		});
		expect(getUserMedia).toHaveBeenNthCalledWith(4, {
			audio: {
				echoCancellation: true,
				noiseSuppression: true,
				autoGainControl: false
			},
			video: false
		});
		expect(onDeviceFallback.mock.calls).toEqual([['camera'], ['microphone']]);
		expect(recorder.status).toBe('recording');
		await recorder.cancel();
	});

	it('cancels a countdown without starting MediaRecorder', async () => {
		const recorder = new ScreenCaptureRecorder();
		const start = recorder.startWithSelection(
			{ screen: false, camera: false, microphone: true },
			{ countdownSeconds: 5 }
		);
		await vi.waitFor(() => expect(recorder.status).toBe('countdown'));
		await recorder.cancel();
		await expect(start).rejects.toThrow('Cancelled');
		expect(FakeMediaRecorder.instances).toHaveLength(0);
		expect(microphoneStream.getTracks()[0]?.stop).toHaveBeenCalledOnce();
		expect(recorder.status).toBe('idle');
	});

	it('shares a concurrent stop result and stops each MediaRecorder once', async () => {
		const recorder = new ScreenCaptureRecorder();
		await recorder.startWithSelection({ screen: true, camera: false, microphone: false }, {});
		now += 500;
		const first = recorder.stop();
		const second = recorder.stop();
		const [firstArtifacts, secondArtifacts] = await Promise.all([first, second]);
		expect(firstArtifacts).toBe(secondArtifacts);
		expect(firstArtifacts).toHaveLength(1);
		expect(FakeMediaRecorder.instances[0]?.stop).toHaveBeenCalledOnce();
		await recorder.clearRecoverableAndDiscard();
	});

	it('waits for an active recorder to stop before discarding a cancelled capture', async () => {
		const recorder = new ScreenCaptureRecorder();
		await recorder.startWithSelection({ screen: true, camera: false, microphone: false }, {});
		FakeMediaRecorder.instances[0]?.emitChunk('discard-me');
		await recorder.cancel();

		expect(FakeMediaRecorder.instances[0]?.stop).toHaveBeenCalledOnce();
		expect(displayStream.getTracks()[0]?.stop).toHaveBeenCalledOnce();
		expect(recorder.lastArtifacts).toEqual([]);
		expect(recorder.status).toBe('idle');
	});

	it('stops with a recoverable artifact before queued writes can grow without bound', async () => {
		const recorder = new ScreenCaptureRecorder();
		await recorder.startWithSelection({ screen: true, camera: false, microphone: false }, {});
		FakeMediaRecorder.instances[0]?.emitBlob(
			new Blob([new Uint8Array(8 * 1024 * 1024 + 1)], { type: 'video/webm' })
		);

		await vi.waitFor(() => expect(recorder.status).toBe('idle'));
		expect(recorder.error).toBe('storage-full');
		expect(recorder.lastArtifacts).toHaveLength(1);
		expect(recorder.lastArtifacts[0]?.sizeBytes).toBeGreaterThan(8 * 1024 * 1024);
		expect(FakeMediaRecorder.instances[0]?.stop).toHaveBeenCalledOnce();
		await recorder.clearRecoverableAndDiscard();
	});

	it('stops early and late streams when cancelled during a pending permission prompt', async () => {
		let resolveCamera!: (stream: MediaStream) => void;
		const pendingCamera = new Promise<MediaStream>((resolve) => {
			resolveCamera = resolve;
		});
		getUserMedia.mockImplementationOnce(() => pendingCamera);
		const recorder = new ScreenCaptureRecorder();
		const start = recorder.startWithSelection({ screen: true, camera: true }, {});
		await vi.waitFor(() => expect(recorder.status).toBe('requesting'));
		await recorder.cancel();
		expect(displayStream.getTracks()[0]?.stop).toHaveBeenCalledOnce();

		resolveCamera(mediaStream(cameraStream));
		await start;
		expect(cameraStream.getTracks()[0]?.stop).toHaveBeenCalledOnce();
		expect(recorder.status).toBe('idle');
		expect(recorder.screenStream).toBeNull();
		expect(recorder.cameraStream).toBeNull();
	});

	it('keeps a replacement capture alive when an older permission prompt resolves late', async () => {
		let resolveCamera!: (stream: MediaStream) => void;
		const pendingCamera = new Promise<MediaStream>((resolve) => {
			resolveCamera = resolve;
		});
		getUserMedia.mockImplementationOnce(() => pendingCamera);
		const recorder = new ScreenCaptureRecorder();
		const staleStart = recorder.startWithSelection({ screen: true, camera: true }, {});
		await vi.waitFor(() => expect(recorder.status).toBe('requesting'));
		await recorder.cancel();

		await recorder.startWithSelection({ screen: false, camera: false, microphone: true }, {});
		expect(recorder.status).toBe('recording');
		expect(microphoneStream.getTracks()[0]?.stop).not.toHaveBeenCalled();

		resolveCamera(mediaStream(cameraStream));
		await staleStart;

		expect(cameraStream.getTracks()[0]?.stop).toHaveBeenCalledOnce();
		expect(microphoneStream.getTracks()[0]?.stop).not.toHaveBeenCalled();
		expect(recorder.status).toBe('recording');
		await recorder.cancel();
	});

	it('maps browser and storage failures to stable error codes', () => {
		expect(mapRecorderError(new DOMException('', 'NotAllowedError'))).toBe('permission-denied');
		expect(mapRecorderError(new DOMException('', 'NotFoundError'))).toBe('no-device');
		expect(mapRecorderError(new DOMException('', 'NotReadableError'))).toBe('device-busy');
		expect(mapRecorderError(new DOMException('', 'QuotaExceededError'))).toBe('storage-full');
	});
});
