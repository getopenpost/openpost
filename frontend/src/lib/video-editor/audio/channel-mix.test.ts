import { describe, expect, it } from 'vitest';
import { mixAudioBufferCooperative, mixChannelsCooperative } from './channel-mix';

function createStereoBuffer(length: number): AudioBuffer {
	const left = new Float32Array(length);
	const right = new Float32Array(length);
	for (let index = 0; index < length; index++) {
		left[index] = Math.sin((2 * Math.PI * 440 * index) / 48_000) * 0.5;
		right[index] = (index % 1000 < 500 ? 0.3 : -0.3) + Math.random() * 0.01;
	}
	// SAFETY: test-only AudioBuffer mock - only numberOfChannels, length, sampleRate, duration and getChannelData are used
	const buffer = {
		numberOfChannels: 2,
		length,
		sampleRate: 48_000,
		duration: length / 48_000,
		getChannelData(channel: number) {
			return channel === 0 ? left : right;
		}
	} as AudioBuffer;
	return buffer;
}

describe('channel mix - cooperative and cancellable', () => {
	it('mixes a long stereo buffer cooperatively and yields to a timer', async () => {
		const buffer = createStereoBuffer(48_000 * 20);
		let timerFired = false;
		const timer = setTimeout(() => {
			timerFired = true;
		}, 0);
		const mono = await mixAudioBufferCooperative(buffer);
		clearTimeout(timer);
		expect(mono.length).toBe(buffer.length);
		expect(timerFired).toBe(true);
		expect(mono[0]).toBeCloseTo(
			(buffer.getChannelData(0)[0] ?? 0) / 2 + (buffer.getChannelData(1)[0] ?? 0) / 2,
			5
		);
	});

	it('cancels during cooperative mixing of a long stereo buffer', async () => {
		const buffer = createStereoBuffer(48_000 * 40);
		const controller = new AbortController();
		const promise = mixAudioBufferCooperative(buffer, controller.signal);
		setTimeout(() => controller.abort(), 5);
		await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
	});

	it('mixes per-channel copies cooperatively', async () => {
		const length = 48_000 * 10;
		const left = new Float32Array(length);
		const right = new Float32Array(length);
		for (let index = 0; index < length; index++) left[index] = 0.5;
		for (let index = 0; index < length; index++) right[index] = -0.5;
		const mono = await mixChannelsCooperative([left, right]);
		expect(mono.length).toBe(length);
		for (let index = 0; index < 100; index++) expect(mono[index]).toBeCloseTo(0, 5);
	});
});
