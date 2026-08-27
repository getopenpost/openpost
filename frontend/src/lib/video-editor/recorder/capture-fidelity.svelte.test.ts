import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ScreenCaptureRecorder } from './recorder.svelte';

class FakeTrack {
	enabled = true;
	muted = false;
	readyState: MediaStreamTrackState = 'live';
	stop = vi.fn();
	getSettings = () => ({});
	addEventListener = vi.fn();
	removeEventListener = vi.fn();
	constructor(readonly kind: 'audio' | 'video') {}
}

class FakeStream {
	constructor(readonly tracks: FakeTrack[]) {}
	getTracks(): FakeTrack[] {
		return this.tracks as unknown as MediaStreamTrack[];
	}
	getVideoTracks(): FakeTrack[] {
		return this.tracks.filter((t) => t.kind === 'video') as unknown as MediaStreamTrack[];
	}
	getAudioTracks(): FakeTrack[] {
		return this.tracks.filter((t) => t.kind === 'audio') as unknown as MediaStreamTrack[];
	}
}

function mediaStream(stream: FakeStream): MediaStream {
	return stream as unknown as MediaStream;
}

class FakeMediaRecorder extends EventTarget {
	static instances: FakeMediaRecorder[] = [];
	static isTypeSupported(t: string): boolean {
		return t.includes('webm');
	}
	mimeType: string;
	state: RecordingState = 'inactive';
	requestData = vi.fn();
	start = vi.fn((ts?: number) => {
		this.state = 'recording';
		this.timeslice = ts;
		queueMicrotask(() => this.dispatchEvent(new Event('start')));
	});
	stop = vi.fn(() => {
		this.state = 'inactive';
		this.dispatchEvent(
			Object.assign(new Event('dataavailable'), {
				data: new Blob(['data'], { type: this.mimeType })
			})
		);
		this.dispatchEvent(new Event('stop'));
	});
	timeslice: number | undefined;
	constructor(stream: MediaStream, opts?: MediaRecorderOptions) {
		super();
		this.mimeType = opts?.mimeType ?? 'video/webm';
		FakeMediaRecorder.instances.push(this);
	}
}

describe('recording fidelity: capture truth and teardown', () => {
	let now = 1000;
	let displayWithAudio: FakeStream;
	let displayWithoutAudio: FakeStream;
	let cameraStream: FakeStream;
	let micStream: FakeStream;
	let getDisplayMedia: ReturnType<typeof vi.fn>;
	let getUserMedia: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		now = 1000;
		FakeMediaRecorder.instances = [];
		displayWithAudio = new FakeStream([new FakeTrack('video'), new FakeTrack('audio')]);
		displayWithoutAudio = new FakeStream([new FakeTrack('video')]);
		cameraStream = new FakeStream([new FakeTrack('video')]);
		micStream = new FakeStream([new FakeTrack('audio')]);
		vi.spyOn(performance, 'now').mockImplementation(() => {
			const v = now;
			now += 25;
			return v;
		});
		getDisplayMedia = vi.fn(async () => mediaStream(displayWithAudio));
		getUserMedia = vi.fn(async (c: MediaStreamConstraints) =>
			c.video ? mediaStream(cameraStream) : mediaStream(micStream)
		);
		vi.stubGlobal('navigator', {
			mediaDevices: {
				getDisplayMedia,
				getUserMedia,
				enumerateDevices: vi.fn(async () => []),
				getSupportedConstraints: () => ({ cursor: true }),
				addEventListener: vi.fn(),
				removeEventListener: vi.fn()
			},
			storage: { estimate: async () => ({ quota: 1_000_000_000, usage: 0 }) }
		} as any);
		vi.stubGlobal('MediaRecorder', FakeMediaRecorder as any);
	});

	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
	});

	it('preserves cursor truth and never claims system audio without track', async () => {
		const recorder = new ScreenCaptureRecorder();
		// with audio tracks -> active
		await recorder.startWithSelection(
			{ screen: true, camera: false, microphone: false },
			{ includeSystemAudio: true, cursorMode: 'motion' }
		);
		expect(recorder.captureTruth?.cursorRequested).toBe('motion');
		expect(recorder.captureTruth?.cursorActual).toBe('motion');
		expect(recorder.captureTruth?.systemAudioRequested).toBe(true);
		expect(recorder.captureTruth?.systemAudioActive).toBe(true);
		expect(recorder.captureTruth?.systemAudioStatus).toBe('active');
		// verify constraint passed
		expect(getDisplayMedia).toHaveBeenCalledWith(
			expect.objectContaining({ video: expect.objectContaining({ cursor: 'motion' }) })
		);
		const arts = await recorder.stop();
		expect(arts[0]?.capture?.systemAudioActive).toBe(true);
		expect(arts[0]?.capture?.systemAudioStatus).toBe('active');
		await recorder.clearRecoverableAndDiscard();
	});

	it('marks inactive when system audio requested but no audio track provided', async () => {
		getDisplayMedia.mockResolvedValueOnce(mediaStream(displayWithoutAudio));
		const recorder = new ScreenCaptureRecorder();
		await recorder.startWithSelection(
			{ screen: true, camera: false, microphone: false },
			{ includeSystemAudio: true, cursorMode: 'always' }
		);
		expect(recorder.captureTruth?.systemAudioActive).toBe(false);
		expect(recorder.captureTruth?.systemAudioStatus).toBe('inactive');
		const arts = await recorder.stop();
		expect(arts[0]?.capture?.systemAudioActive).toBe(false);
		expect(arts[0]?.capture?.systemAudioStatus).toBe('inactive');
		// preview/export must not claim audio exists with only requested flag: artifact says inactive, file has no audio track (simulated via stream without audio, encoder will have no audio)
		await recorder.clearRecoverableAndDiscard();
	});

	it('tears down tracks exactly once on cancel during recording', async () => {
		const recorder = new ScreenCaptureRecorder();
		await recorder.startWithSelection({ screen: true, camera: true, microphone: false }, {});
		const screenTracks = displayWithAudio.tracks;
		const camTracks = cameraStream.tracks;
		await recorder.cancel();
		expect(screenTracks.every((t) => t.stop.mock.calls.length === 1)).toBe(true);
		expect(camTracks.every((t) => t.stop.mock.calls.length === 1)).toBe(true);
		expect(recorder.captureTruth).toBeNull();
		expect(recorder.status).toBe('idle');
	});

	it('normalizes persisted capture metadata and keeps legacy media loadable', async () => {
		const { normalizeRecordingCaptureMetadata } = await import('../media/types');
		expect(normalizeRecordingCaptureMetadata(undefined)).toBeUndefined();
		expect(
			normalizeRecordingCaptureMetadata({
				version: 1,
				kind: 'screen',
				capturedAt: new Date().toISOString(),
				cursor: { requested: 'always', actual: 'always', supported: true },
				systemAudio: { requested: true, active: true, status: 'active' }
			})
		).toMatchObject({ kind: 'screen' });
		// invalid version should be dropped
		expect(
			normalizeRecordingCaptureMetadata({
				version: 2,
				kind: 'screen',
				capturedAt: new Date().toISOString()
			})
		).toBeUndefined();
		// invalid kind dropped
		expect(
			normalizeRecordingCaptureMetadata({
				version: 1,
				kind: 'bad',
				capturedAt: new Date().toISOString()
			})
		).toBeUndefined();
	});
});
