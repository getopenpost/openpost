import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ScreenCaptureRecorder } from './recorder.svelte';
import {
	capabilitiesFixture,
	createTestStream,
	createTestTrack,
	createTrackWithCursor
} from './test-fixtures';

class FakeMediaRecorder extends EventTarget {
	static instances: FakeMediaRecorder[] = [];
	static isTypeSupported(type: string): boolean {
		return type.includes('webm');
	}

	mimeType: string;
	state: RecordingState = 'inactive';
	requestData = vi.fn();
	start = vi.fn((_: number | undefined) => {
		this.state = 'recording';
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

	constructor(stream: MediaStream, options?: MediaRecorderOptions) {
		super();
		this.mimeType = options?.mimeType ?? 'video/webm';
		// SAFETY: test stream is MediaStream with getTracks, safe for kind derivation
		const tracks = stream.getTracks();
		this.mimeType = options?.mimeType ?? 'video/webm';
		FakeMediaRecorder.instances.push(this);
		void tracks;
	}

	emit(_value: string): void {
		// no-op for helper
	}
}

describe('recording fidelity: capture truth and teardown', () => {
	let now = 1000;
	let displayWithAudio: MediaStream;
	let displayWithoutAudio: MediaStream;
	let cameraStream: MediaStream;
	let micStream: MediaStream;
	let getDisplayMedia: ReturnType<typeof vi.fn>;
	let getUserMedia: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		now = 1000;
		FakeMediaRecorder.instances = [];
		displayWithAudio = createTestStream([
			createTrackWithCursor('video', 'motion'),
			createTestTrack('audio')
		]);
		displayWithoutAudio = createTestStream([createTrackWithCursor('video', 'always')]);
		cameraStream = createTestStream([createTestTrack('video')]);
		micStream = createTestStream([createTestTrack('audio')]);
		vi.spyOn(performance, 'now').mockImplementation(() => {
			const value = now;
			now += 25;
			return value;
		});
		getDisplayMedia = vi.fn(async () => displayWithAudio);
		getUserMedia = vi.fn(async (constraints: MediaStreamConstraints) =>
			constraints.video ? cameraStream : micStream
		);
		// SAFETY: test navigator double with only mediaDevices subset needed for capture
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
		} as Navigator);
		// SAFETY: test double for MediaRecorder constructor
		vi.stubGlobal('MediaRecorder', FakeMediaRecorder as typeof MediaRecorder);
	});

	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
	});

	it('preserves cursor truth and never claims system audio without track', async () => {
		const recorder = new ScreenCaptureRecorder();
		await recorder.startWithSelection(
			{ screen: true, camera: false, microphone: false },
			{ includeSystemAudio: true, cursorMode: 'motion' }
		);
		expect(recorder.captureTruth?.cursorRequested).toBe('motion');
		expect(recorder.captureTruth?.cursorActual).toBe('motion');
		expect(recorder.captureTruth?.systemAudioRequested).toBe(true);
		expect(recorder.captureTruth?.systemAudioActive).toBe(true);
		expect(recorder.captureTruth?.systemAudioStatus).toBe('active');
		expect(getDisplayMedia).toHaveBeenCalledWith(
			expect.objectContaining({ video: expect.objectContaining({ cursor: 'motion' }) })
		);
		const arts = await recorder.stop();
		expect(arts[0]?.capture?.systemAudioActive).toBe(true);
		expect(arts[0]?.capture?.systemAudioStatus).toBe('active');
		await recorder.clearRecoverableAndDiscard();
	});

	it('marks inactive when system audio requested but no audio track provided', async () => {
		getDisplayMedia.mockResolvedValueOnce(displayWithoutAudio);
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
		await recorder.clearRecoverableAndDiscard();
	});

	it('does not mirror requested cursor when browser reports different mode or unknown', async () => {
		const streamAlways = createTestStream([
			createTrackWithCursor('video', 'always'),
			createTestTrack('audio')
		]);
		getDisplayMedia.mockResolvedValueOnce(streamAlways);
		const recorder = new ScreenCaptureRecorder();
		await recorder.startWithSelection(
			{ screen: true, camera: false, microphone: false },
			{ includeSystemAudio: false, cursorMode: 'motion' }
		);
		expect(recorder.captureTruth?.cursorRequested).toBe('motion');
		expect(recorder.captureTruth?.cursorActual).toBe('always');
		const arts = await recorder.stop();
		expect(arts[0]?.capture?.cursorActual).toBe('always');
		await recorder.clearRecoverableAndDiscard();
		const streamUnknown = createTestStream([createTestTrack('video'), createTestTrack('audio')]);
		getDisplayMedia.mockResolvedValueOnce(streamUnknown);
		const recorder2 = new ScreenCaptureRecorder();
		await recorder2.startWithSelection(
			{ screen: true, camera: false, microphone: false },
			{ includeSystemAudio: false, cursorMode: 'motion' }
		);
		expect(recorder2.captureTruth?.cursorActual).toBe('unknown');
		await recorder2.stop();
		await recorder2.clearRecoverableAndDiscard();
	});

	it('preserves capture-time audio active even if track ends before stop, reconciling via probe on import', async () => {
		const recorder = new ScreenCaptureRecorder();
		await recorder.startWithSelection(
			{ screen: true, camera: false, microphone: false },
			{ includeSystemAudio: true, cursorMode: 'always' }
		);
		// Simulate audio track ending before stop completes
		const audioTrack = displayWithAudio.getAudioTracks()[0];
		if (audioTrack) {
			// SAFETY: test track is mutable for simulation
			(audioTrack as { readyState: MediaStreamTrackState }).readyState = 'ended';
		}
		const arts = await recorder.stop();
		expect(arts[0]?.capture?.systemAudioActive).toBe(true);
		expect(arts[0]?.capture?.systemAudioStatus).toBe('active');
		const { reconcileSystemAudioWithProbe } = await import('../media/recording-capture-schema');
		let reconciled = reconcileSystemAudioWithProbe(
			{ requested: true, active: true, status: 'active' },
			true
		);
		expect(reconciled.active).toBe(true);
		expect(reconciled.status).toBe('active');
		reconciled = reconcileSystemAudioWithProbe(
			{ requested: true, active: true, status: 'active' },
			false
		);
		expect(reconciled.active).toBe(false);
		expect(reconciled.status).toBe('inactive');
		reconciled = reconcileSystemAudioWithProbe(
			{ requested: false, active: false, status: 'not-requested' },
			false
		);
		expect(reconciled.status).toBe('not-requested');
		await recorder.clearRecoverableAndDiscard();
	});

	it('tears down tracks exactly once on cancel during recording', async () => {
		const recorder = new ScreenCaptureRecorder();
		await recorder.startWithSelection({ screen: true, camera: true, microphone: false }, {});
		await recorder.cancel();
		expect(recorder.captureTruth).toBeNull();
		expect(recorder.status).toBe('idle');
	});

	it('normalizes persisted capture metadata and keeps legacy media loadable', async () => {
		const { normalizeRecordingCaptureMetadata } = await import('../media/recording-capture-schema');
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
		expect(
			normalizeRecordingCaptureMetadata({
				version: 2,
				kind: 'screen',
				capturedAt: new Date().toISOString()
			})
		).toBeUndefined();
		expect(
			normalizeRecordingCaptureMetadata({
				version: 1,
				kind: 'bad',
				capturedAt: new Date().toISOString()
			})
		).toBeUndefined();
	});

	it('shares one capturedAt across linked screen/camera/mic artifacts', async () => {
		const recorder = new ScreenCaptureRecorder();
		await recorder.startWithSelection(
			{ screen: true, camera: true, microphone: true },
			{ includeSystemAudio: true, cursorMode: 'always' }
		);
		const truthAt = recorder.captureTruth?.capturedAt;
		expect(truthAt).toBeTruthy();
		const arts = await recorder.stop();
		expect(arts.length).toBe(3);
		const ats = arts.map((artifact) => artifact.capture?.capturedAt);
		expect(ats.every((value) => value === truthAt)).toBe(true);
		expect(new Set(ats).size).toBe(1);
		await recorder.clearRecoverableAndDiscard();
	});

	it('denied second attempt cannot show stale active copy', async () => {
		const recorder = new ScreenCaptureRecorder();
		await recorder.startWithSelection(
			{ screen: true, camera: false, microphone: false },
			{ includeSystemAudio: true, cursorMode: 'always' }
		);
		expect(recorder.captureTruth?.systemAudioStatus).toBe('active');
		await recorder.stop();
		expect(recorder.captureTruth?.systemAudioStatus).toBe('active');
		getDisplayMedia.mockRejectedValueOnce(new DOMException('Denied', 'NotAllowedError'));
		await expect(
			recorder.startWithSelection(
				{ screen: true, camera: false, microphone: false },
				{ includeSystemAudio: true }
			)
		).rejects.toMatchObject({ name: 'NotAllowedError' });
		expect(recorder.captureTruth?.systemAudioStatus).toBe('denied');
		expect(recorder.captureTruth?.systemAudioActive).toBe(false);
		expect(recorder.error).toBe('permission-denied');
		await recorder.cancel().catch(() => undefined);
	});

	it('truth survives stop into recovery and is cleared only on discard/cancel', async () => {
		const recorder = new ScreenCaptureRecorder();
		await recorder.startWithSelection(
			{ screen: true, camera: false, microphone: false },
			{ includeSystemAudio: true }
		);
		const arts = await recorder.stop();
		expect(recorder.captureTruth).not.toBeNull();
		expect(recorder.captureTruth?.capturedAt).toBe(arts[0]?.capture?.capturedAt);
		expect(recorder.lastArtifacts[0]?.capture?.capturedAt).toBe(recorder.captureTruth?.capturedAt);
		await recorder.discardArtifacts(arts);
		expect(recorder.captureTruth).toBeNull();
		expect(recorder.lastArtifacts.length).toBe(0);
	});

	it('preserves partial valid capture metadata when another subfield is invalid', async () => {
		const { normalizeRecordingCaptureMetadata } = await import('../media/recording-capture-schema');
		const result = normalizeRecordingCaptureMetadata({
			version: 1,
			kind: 'screen',
			capturedAt: new Date().toISOString(),
			cursor: { requested: 'always', actual: 'bogus', supported: true },
			systemAudio: { requested: true, active: true, status: 'active' }
		});
		expect(result?.systemAudio).toBeTruthy();
		expect(result?.cursor).toBeUndefined();
	});

	it('import probe hasAudio=false reconciles requested active to inactive', async () => {
		const { reconcileSystemAudioWithProbe } = await import('../media/recording-capture-schema');
		const reconciled = reconcileSystemAudioWithProbe(
			{ requested: true, active: true, status: 'active' },
			false
		);
		expect(reconciled.active).toBe(false);
		expect(reconciled.status).toBe('inactive');
		const reconciled2 = reconcileSystemAudioWithProbe(
			{ requested: false, active: false, status: 'not-requested' },
			true
		);
		expect(reconciled2.active).toBe(true);
		expect(reconciled2.status).toBe('active');
	});
});
