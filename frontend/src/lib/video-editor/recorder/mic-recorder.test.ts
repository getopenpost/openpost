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

	it('requests the selected input with narration processing and records in chunks', async () => {
		const recorder = new MicRecorder();

		await recorder.start({
			deviceId: 'studio-mic',
			noiseSuppression: false,
			autoGainControl: true
		});

		expect(getUserMedia).toHaveBeenCalledWith({
			audio: {
				deviceId: { exact: 'studio-mic' },
				echoCancellation: true,
				noiseSuppression: false,
				autoGainControl: true
			},
			video: false
		});
		expect(FakeMediaRecorder.instances[0]?.start).toHaveBeenCalledWith(1_000);
		expect(recorder.currentState).toBe('recording');
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

	it('releases the input when MediaRecorder fails while stopping', async () => {
		const recorder = new MicRecorder();
		await recorder.start();
		FakeMediaRecorder.failStop = true;

		await expect(recorder.stop()).rejects.toMatchObject({ name: 'NotReadableError' });
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

	it('degrades cleanly when the browser cannot create another audio context', () => {
		vi.stubGlobal(
			'AudioContext',
			class {
				constructor() {
					throw new DOMException('Context limit reached', 'NotSupportedError');
				}
			}
		);

		expect(createBestEffortAudioContext()).toBeNull();
	});

	it('reports RMS input level and releases every meter resource', () => {
		const disconnectSource = vi.fn();
		const disconnectAnalyser = vi.fn();
		const close = vi.fn(async () => undefined);
		const cancelAnimationFrame = vi.fn();
		vi.stubGlobal(
			'requestAnimationFrame',
			vi.fn(() => 17)
		);
		vi.stubGlobal('cancelAnimationFrame', cancelAnimationFrame);
		vi.stubGlobal(
			'AudioContext',
			class {
				createMediaStreamSource() {
					return { connect: vi.fn(), disconnect: disconnectSource };
				}
				createAnalyser() {
					return {
						fftSize: 0,
						smoothingTimeConstant: 0,
						getFloatTimeDomainData: (samples: Float32Array) => samples.fill(0.25),
						disconnect: disconnectAnalyser
					};
				}
				close = close;
			}
		);
		const levels: number[] = [];
		// SAFETY: The fake audio context never reads MediaStream fields in this meter lifecycle test.
		const stop = startMicLevelMeter({} as MediaStream, (level) => levels.push(level));

		expect(levels[0]).toBeCloseTo(0.75);
		stop();

		expect(levels.at(-1)).toBe(0);
		expect(cancelAnimationFrame).toHaveBeenCalledWith(17);
		expect(disconnectSource).toHaveBeenCalledOnce();
		expect(disconnectAnalyser).toHaveBeenCalledOnce();
		expect(close).toHaveBeenCalledOnce();
	});
});
