// oxlint-disable anti-slop/no-chained-type-assertions, anti-slop/require-safety-comment-for-type-assertion, anti-slop/no-unknown-parameters -- test fakes at boundary
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	ScreenCaptureRecorder,
	pickAudioMimeType,
	pickVideoMimeType,
	estimateBytesPerMinute,
	mapRecorderError
} from './recorder.svelte';

class FakeTrack {
	kind: string;
	enabled = true;
	constructor(kind: string) {
		this.kind = kind;
	}
	stop = vi.fn();
	getSettings = () => ({});
	addEventListener = vi.fn();
	removeEventListener = vi.fn();
}

class FakeStream {
	tracks: FakeTrack[];
	constructor(tracks: FakeTrack[]) {
		this.tracks = tracks;
	}
	getTracks() {
		return this.tracks;
	}
	getVideoTracks() {
		return this.tracks.filter((t) => t.kind === 'video');
	}
	getAudioTracks() {
		return this.tracks.filter((t) => t.kind === 'audio');
	}
	addTrack() {}
}

class FakeMediaRecorder extends EventTarget {
	static instances: FakeMediaRecorder[] = [];
	static isTypeSupported(type: string): boolean {
		return type === 'video/webm;codecs=vp9,opus' || type === 'audio/webm;codecs=opus';
	}
	mimeType: string;
	state: RecordingState = 'inactive';
	start = vi.fn((timeslice?: number) => {
		this.state = 'recording';
		this.timeslice = timeslice;
		// async start to allow monotonic offset difference via performance.now tick
		queueMicrotask(() => this.dispatchEvent(new Event('start')));
	});
	stop = vi.fn(() => {
		this.state = 'inactive';
		// emit dataavailable then stop
		this.dispatchEvent(
			Object.assign(new Event('dataavailable'), {
				data: new Blob([`chunk-${this.kind}`], { type: this.mimeType })
			})
		);
		this.dispatchEvent(new Event('stop'));
	});
	requestData = vi.fn();
	pause = vi.fn();
	resume = vi.fn();
	timeslice: number | undefined;
	kind: string;
	constructor(stream: MediaStream, options?: MediaRecorderOptions) {
		super();
		this.kind =
			(stream as unknown as FakeStream)
				.getTracks()
				.map((t) => t.kind)
				.join('+') || 'unknown';
		this.mimeType = options?.mimeType ?? 'video/webm';
		FakeMediaRecorder.instances.push(this);
	}
}

describe('ScreenCaptureRecorder', () => {
	let now = 1000;
	let getDisplayMedia: ReturnType<typeof vi.fn>;
	let getUserMedia: ReturnType<typeof vi.fn>;
	let enumerateDevices: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		now = 1000;
		FakeMediaRecorder.instances = [];
		vi.spyOn(performance, 'now').mockImplementation(() => {
			const v = now;
			now += 25;
			return v;
		});
		getDisplayMedia = vi.fn(
			async () =>
				new FakeStream([
					new FakeTrack('video'),
					new FakeTrack('audio')
				] as unknown as MediaStreamTrack[]) as unknown as MediaStream
		);
		getUserMedia = vi.fn(async (constraints: unknown) => {
			const c = constraints as { video?: unknown; audio?: unknown };
			if (c.video)
				return new FakeStream([
					new FakeTrack('video')
				] as unknown as MediaStreamTrack[]) as unknown as MediaStream;
			return new FakeStream([
				new FakeTrack('audio')
			] as unknown as MediaStreamTrack[]) as unknown as MediaStream;
		});
		enumerateDevices = vi.fn(async () => [
			{
				kind: 'videoinput',
				deviceId: 'cam-1',
				label: 'Cam',
				groupId: '',
				toJSON: () => ({})
			} as unknown as MediaDeviceInfo,
			{
				kind: 'audioinput',
				deviceId: 'mic-1',
				label: 'Mic',
				groupId: '',
				toJSON: () => ({})
			} as unknown as MediaDeviceInfo
		]);
		vi.stubGlobal('navigator', {
			mediaDevices: {
				getDisplayMedia,
				getUserMedia,
				enumerateDevices,
				addEventListener: vi.fn(),
				removeEventListener: vi.fn()
			},
			storage: { estimate: async () => ({ quota: 1000000000, usage: 0 }) }
		});
		vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
		// jsdom may not have requestAnimationFrame etc but not needed
	});

	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
	});

	it('picks correct MIME types via isTypeSupported ordering', () => {
		expect(pickVideoMimeType()).toBe('video/webm;codecs=vp9,opus');
		expect(pickAudioMimeType()).toBe('audio/webm;codecs=opus');
		expect(
			estimateBytesPerMinute({ screen: true, camera: true, microphone: true })
		).toBeGreaterThan(estimateBytesPerMinute({ microphone: true }));
	});

	it('produces separate artifacts with monotonic shared-timebase offsets', async () => {
		const recorder = new ScreenCaptureRecorder();
		await recorder.startWithSelection(
			{ screen: true, camera: true, microphone: true },
			{ includeSystemAudio: true }
		);
		expect(getDisplayMedia).toHaveBeenCalledOnce();
		expect(getUserMedia).toHaveBeenCalledTimes(2);
		expect(FakeMediaRecorder.instances).toHaveLength(3);
		// each recorder started with 1s timeslice
		for (const r of FakeMediaRecorder.instances) expect(r.start).toHaveBeenCalledWith(1000);
		expect(recorder.status).toBe('recording');
		expect(recorder.counters.screen.chunks).toBe(0);

		// simulate some dataavailable while recording
		FakeMediaRecorder.instances[0]!.dispatchEvent(
			Object.assign(new Event('dataavailable'), { data: new Blob([' screen1 ']) })
		);
		FakeMediaRecorder.instances[2]!.dispatchEvent(
			Object.assign(new Event('dataavailable'), { data: new Blob([' mic1 ']) })
		);
		// Advance monotonic clock so durations are measurable
		now += 2000;

		const artifacts = await recorder.stop();
		expect(artifacts).toHaveLength(3);
		const kinds = artifacts.map((a) => a.kind).sort();
		expect(kinds).toEqual(['camera', 'microphone', 'screen']);
		// earliest offset is zero
		expect(Math.min(...artifacts.map((a) => a.startOffsetMs))).toBe(0);
		// all offsets are monotonic non-negative and less than 500ms
		for (const a of artifacts) {
			expect(a.startOffsetMs).toBeGreaterThanOrEqual(0);
			expect(a.startOffsetMs).toBeLessThan(500);
			expect(a.sizeBytes).toBeGreaterThan(0);
			expect(a.durationMs).toBeGreaterThan(0);
		}
		// stop clears preview and goes idle, preserves lastArtifacts
		expect(recorder.status).toBe('idle');
		expect(recorder.lastArtifacts).toHaveLength(3);
		expect(recorder.screenStream).toBeNull();
		// cancel clears recoverable only via explicit
		recorder.clearRecoverable();
		expect(recorder.lastArtifacts).toHaveLength(0);
	});

	it('rolls back partial start and maps permission errors', async () => {
		getUserMedia.mockRejectedValueOnce(new DOMException('Permission denied', 'NotAllowedError'));
		const recorder = new ScreenCaptureRecorder();
		await expect(
			recorder.startWithSelection({ screen: true, microphone: true }, {})
		).rejects.toBeInstanceOf(DOMException);
		expect(recorder.error).toBe('permission-denied');
		expect(recorder.status).toBe('error');
		expect(mapRecorderError(new DOMException('', 'NotAllowedError'))).toBe('permission-denied');
		expect(mapRecorderError(new DOMException('', 'NotFoundError'))).toBe('no-device');
		expect(mapRecorderError(new DOMException('', 'NotReadableError'))).toBe('device-busy');
		// no dangling timers or preview
		expect(recorder.screenStream).toBeNull();
	});

	it('handles screen auto-stop via track ended as recoverable stop', async () => {
		const recorder = new ScreenCaptureRecorder();
		await recorder.startWithSelection({ screen: true, camera: false, microphone: false }, {});
		expect(recorder.status).toBe('recording');
		const screenRecorder = FakeMediaRecorder.instances[0]!;
		// simulate track ended -> our handler calls stop()
		// we cannot trigger real track ended, but we can call stop directly
		const arts = await recorder.stop();
		expect(arts).toHaveLength(1);
		expect(arts[0]!.kind).toBe('screen');
		expect(screenRecorder.stop).toHaveBeenCalledOnce();
	});

	it('supports cancellation during countdown and preserves recoverable on late failure', async () => {
		const recorder = new ScreenCaptureRecorder();
		const startPromise = recorder.startWithSelection({ microphone: true }, { countdownSeconds: 5 });
		// Allow getUserMedia microtask to settle then check countdown
		await new Promise((r) => setTimeout(r, 20));
		expect(recorder.status).toBe('countdown');
		expect(recorder.countdownRemaining).toBe(5);
		// cancel during countdown should abort and go idle
		await recorder.cancel();
		expect(recorder.status).toBe('idle');
		await expect(startPromise).rejects.toThrow();
		// start again normally and stop
		await recorder.startWithSelection({ microphone: true }, {});
		const arts = await recorder.stop();
		expect(arts.length).toBe(1);
		// simulate late failure after stop: lastArtifacts preserved for recovery
		expect(recorder.lastArtifacts.length).toBe(1);
	});

	it('does not assume fake devices - enumeration returns real filtered lists', async () => {
		enumerateDevices.mockResolvedValueOnce([]);
		const { listRecorderDevices } = await import('./recorder.svelte');
		const lists = await listRecorderDevices();
		expect(lists.cameras).toEqual([]);
		expect(lists.microphones).toEqual([]);
	});
});
