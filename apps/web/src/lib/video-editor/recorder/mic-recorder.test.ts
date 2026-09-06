import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	MicRecorder,
	createBestEffortAudioContext,
	micRecordingExtension,
	microphoneConstraints,
	pickMicRecorderMimeType,
	startMicLevelMeter
} from './mic-recorder';

class FakeMediaRecorder extends EventTarget {
	static instances: FakeMediaRecorder[] = [];
	static failStart = false;
	static failStop = false;
	static isTypeSupported(type: string): boolean {
		return type === 'audio/webm;codecs=opus';
	}

	readonly mimeType: string;
	state: RecordingState = 'inactive';
	readonly start = vi.fn((timeslice?: number) => {
		this.state = 'recording';
		this.timeslice = timeslice;
		if (FakeMediaRecorder.failStart) {
			const event = Object.assign(new Event('error'), {
				error: new DOMException('Microphone disconnected', 'NotReadableError')
			});
			this.dispatchEvent(event);
			return;
		}
		this.dispatchEvent(new Event('start'));
	});
	readonly pause = vi.fn(() => {
		this.state = 'paused';
	});
	readonly resume = vi.fn(() => {
		this.state = 'recording';
	});
	readonly stop = vi.fn(() => {
		if (FakeMediaRecorder.failStop) {
			this.dispatchEvent(
				Object.assign(new Event('error'), {
					error: new DOMException('Microphone disconnected', 'NotReadableError')
				})
			);
			return;
		}
		this.state = 'inactive';
		this.dispatchEvent(
			Object.assign(new Event('dataavailable'), {
				data: new Blob(['recorded-audio'], { type: this.mimeType })
			})
		);
		this.dispatchEvent(new Event('stop'));
	});
	timeslice: number | undefined;

	constructor(_stream: MediaStream, options?: MediaRecorderOptions) {
		super();
		this.mimeType = options?.mimeType ?? 'audio/webm';
		FakeMediaRecorder.instances.push(this);
	}
}

describe('MicRecorder', () => {
	let now = 0;
	let stopTrack: ReturnType<typeof vi.fn>;
	let getUserMedia: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		now = 1_000;
		stopTrack = vi.fn();
		getUserMedia = vi.fn(async () => ({
			getTracks: () => [{ stop: stopTrack }]
		}));
		FakeMediaRecorder.instances = [];
		FakeMediaRecorder.failStart = false;
		FakeMediaRecorder.failStop = false;
		vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
		vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
		vi.spyOn(performance, 'now').mockImplementation(() => now);
	});

	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
	});

	it('excludes paused time and keeps the final data event before releasing the input', async () => {
		const recorder = new MicRecorder();
		await recorder.start();
		now += 125;
		recorder.pause();
		now += 2_000;
		recorder.resume();
		now += 375;

		const result = await recorder.stop();

		expect(result.durationMs).toBe(500);
		expect(result.mimeType).toBe('audio/webm;codecs=opus');
		expect(result.blob.size).toBeGreaterThan(0);
		expect(await result.blob.text()).toBe('recorded-audio');
		expect(stopTrack).toHaveBeenCalledOnce();
		expect(recorder.currentState).toBe('idle');
	});

	it('releases the input when MediaRecorder fails during startup', async () => {
		FakeMediaRecorder.failStart = true;
		const recorder = new MicRecorder();

		await expect(recorder.start()).rejects.toMatchObject({ name: 'NotReadableError' });
		expect(stopTrack).toHaveBeenCalledOnce();
		expect(recorder.currentState).toBe('idle');
	});

	it('uses stable MIME and constraint fallbacks', () => {
		expect(pickMicRecorderMimeType()).toBe('audio/webm;codecs=opus');
		expect(micRecordingExtension('audio/ogg;codecs=opus')).toBe('ogg');
		expect(micRecordingExtension('audio/mp4')).toBe('m4a');
		expect(micRecordingExtension('')).toBe('webm');
		expect(microphoneConstraints({})).toEqual({
			echoCancellation: true,
			noiseSuppression: true,
			autoGainControl: false
		});
	});
});
