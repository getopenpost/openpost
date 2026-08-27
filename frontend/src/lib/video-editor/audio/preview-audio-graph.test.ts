/* oxlint-disable anti-slop/require-safety-comment-for-type-assertion, anti-slop/no-chained-type-assertions, anti-slop/no-unknown-parameters -- Web Audio graph tests use narrow mocks for browser-owned node contracts. */
import { beforeAll, describe, expect, it } from 'vitest';
import {
	AUDIO_EQ_HIGH_FREQUENCY_HZ,
	AUDIO_EQ_HIGH_MID_FREQUENCY_HZ,
	AUDIO_EQ_HIGH_MID_Q,
	AUDIO_EQ_LOW_FREQUENCY_HZ,
	AUDIO_EQ_LOW_MID_FREQUENCY_HZ,
	AUDIO_EQ_LOW_MID_Q,
	AUDIO_EQ_MID_FREQUENCY_HZ,
	AUDIO_EQ_MID_Q,
	resolveAudioEqSettings
} from './audio-eq';
import {
	createPreviewClipAudioGraph,
	rampPreviewClipEq,
	setPreviewClipEq,
	setPreviewAudioEffects
} from './preview-audio-graph';
import { createDefaultAudioEffect } from './audio-effects';

class AudioParamMock {
	value = 0;
	readonly cancelledAt: number[] = [];
	readonly setCalls: Array<{ value: number; time: number }> = [];
	readonly rampCalls: Array<{ value: number; time: number }> = [];

	cancelScheduledValues(time: number) {
		this.cancelledAt.push(time);
	}

	setValueAtTime(value: number, time: number) {
		this.value = value;
		this.setCalls.push({ value, time });
	}

	linearRampToValueAtTime(value: number, time: number) {
		this.value = value;
		this.rampCalls.push({ value, time });
	}
}

class ConnectableNodeMock {
	readonly connections: unknown[] = [];
	disconnected = false;
	disconnectAllCalls = 0;
	disconnectTargetCalls = 0;

	connect(target: unknown) {
		this.connections.push(target);
	}

	disconnect(target?: unknown) {
		this.disconnected = true;
		if (target === undefined) {
			this.disconnectAllCalls += 1;
			this.connections.length = 0;
			return;
		}

		this.disconnectTargetCalls += 1;
		let index = this.connections.indexOf(target);
		while (index !== -1) {
			this.connections.splice(index, 1);
			index = this.connections.indexOf(target);
		}
	}
}

class GainNodeMock extends ConnectableNodeMock {
	gain = new AudioParamMock();
}

class BiquadFilterNodeMock extends ConnectableNodeMock {
	type: BiquadFilterType = 'peaking';
	frequency = new AudioParamMock();
	gain = new AudioParamMock();
	Q = new AudioParamMock();
}

class IIRFilterNodeMock extends ConnectableNodeMock {
	constructor(
		readonly feedforward: number[],
		readonly feedback: number[]
	) {
		super();
	}
}

class StereoPannerMock extends ConnectableNodeMock {
	pan = new AudioParamMock();
}
class ConvolverMock extends ConnectableNodeMock {
	buffer: AudioBuffer | null = null;
	normalize = true;
}
class DelayMock extends ConnectableNodeMock {
	delayTime = new AudioParamMock();
}
class WaveShaperMock extends ConnectableNodeMock {
	curve: Float32Array | null = null;
	oversample: OverSampleType = 'none';
}
class OscillatorMock extends ConnectableNodeMock {
	frequency = new AudioParamMock();
	connect(target: unknown) {
		super.connect(target);
	}
	start() {}
	stop() {}
}
class AudioContextMock {
	currentTime = 1.5;
	state: AudioContextState = 'running';
	sampleRate = 48000;
	destination = { kind: 'destination' };

	createGain() {
		return new GainNodeMock();
	}

	createBiquadFilter() {
		return new BiquadFilterNodeMock();
	}

	createIIRFilter(feedforward: number[], feedback: number[]) {
		return new IIRFilterNodeMock(feedforward, feedback);
	}

	createStereoPanner() {
		return new StereoPannerMock();
	}

	createConvolver() {
		return new ConvolverMock();
	}

	createDelay() {
		return new DelayMock();
	}

	createWaveShaper() {
		return new WaveShaperMock();
	}

	createOscillator() {
		return new OscillatorMock();
	}

	createBuffer(channels: number, length: number, sampleRate: number) {
		return {
			numberOfChannels: channels,
			length,
			sampleRate,
			getChannelData: () => new Float32Array(length)
		} as unknown as AudioBuffer;
	}

	createDynamicsCompressor() {
		return {
			threshold: new AudioParamMock(),
			ratio: new AudioParamMock(),
			attack: new AudioParamMock(),
			release: new AudioParamMock(),
			knee: new AudioParamMock(),
			connect(target: unknown) {
				(this as unknown as ConnectableNodeMock).connections.push(target);
			},
			disconnect() {},
			connections: [] as unknown[]
		} as unknown as DynamicsCompressorNode;
	}
}

function getConnections(node: unknown): unknown[] {
	return (node as ConnectableNodeMock).connections;
}

function getRampCalls(param: unknown): Array<{ value: number; time: number }> {
	return (param as AudioParamMock).rampCalls;
}

describe('preview-audio-graph', () => {
	beforeAll(() => {
		Object.defineProperty(globalThis, 'window', {
			configurable: true,
			value: { AudioContext: AudioContextMock }
		});
		Object.defineProperty(globalThis, 'AudioContext', {
			configurable: true,
			value: AudioContextMock
		});
	});

	it('creates a stage chain with default shelf and bell nodes', () => {
		const graph = createPreviewClipAudioGraph({ eqStageCount: 2 });

		expect(graph).not.toBeNull();
		expect(graph?.eqStageNodes).toHaveLength(2);

		const firstStage = graph!.eqStageNodes[0]!;
		const secondStage = graph!.eqStageNodes[1]!;

		expect(firstStage.band1PassNodes).toHaveLength(0);
		expect(firstStage.lowNode.type).toBe('lowshelf');
		expect(firstStage.lowNode.frequency.value).toBe(AUDIO_EQ_LOW_FREQUENCY_HZ);
		expect(firstStage.lowMidNode.type).toBe('peaking');
		expect(firstStage.lowMidNode.frequency.value).toBe(AUDIO_EQ_LOW_MID_FREQUENCY_HZ);
		expect(firstStage.lowMidNode.Q.value).toBe(AUDIO_EQ_LOW_MID_Q);
		expect(firstStage.midPeakingNode.frequency.value).toBe(AUDIO_EQ_MID_FREQUENCY_HZ);
		expect(firstStage.midPeakingNode.Q.value).toBe(AUDIO_EQ_MID_Q);
		expect(firstStage.highMidNode.frequency.value).toBe(AUDIO_EQ_HIGH_MID_FREQUENCY_HZ);
		expect(firstStage.highMidNode.Q.value).toBe(AUDIO_EQ_HIGH_MID_Q);
		expect(firstStage.highNode.type).toBe('highshelf');
		expect(firstStage.highNode.frequency.value).toBe(AUDIO_EQ_HIGH_FREQUENCY_HZ);
		expect(firstStage.band6PassNodes).toHaveLength(0);

		expect(getConnections(graph!.sourceInputNode)).toEqual([firstStage.band1BypassNode]);
		expect(getConnections(firstStage.band1BypassNode)).toEqual([firstStage.lowNode]);
		expect(getConnections(firstStage.lowNode)).toEqual([firstStage.lowMidNode]);
		expect(getConnections(firstStage.lowMidNode)).toEqual([firstStage.midPeakingNode]);
		expect(getConnections(firstStage.midPeakingNode)).toEqual([firstStage.highMidNode]);
		expect(getConnections(firstStage.highMidNode)).toEqual([firstStage.highNode]);
		expect(getConnections(firstStage.highNode)).toEqual([firstStage.band6BypassNode]);
		expect(getConnections(firstStage.band6BypassNode)).toEqual([firstStage.outputGainNode]);
		expect(getConnections(firstStage.outputGainNode)).toEqual([secondStage.band1BypassNode]);
		expect(getConnections(secondStage.band1BypassNode)).toEqual([secondStage.lowNode]);
		expect(getConnections(secondStage.highNode)).toEqual([secondStage.band6BypassNode]);
		expect(getConnections(secondStage.band6BypassNode)).toEqual([secondStage.outputGainNode]);
		expect(getConnections(secondStage.outputGainNode)).toEqual([graph!.outputGainNode]);
	});

	it('creates cut nodes when needed and ramps frequency, gain, and Q parameters', () => {
		const graph = createPreviewClipAudioGraph({ eqStageCount: 1 });
		expect(graph).not.toBeNull();

		setPreviewClipEq(graph!, [
			resolveAudioEqSettings({
				lowCutEnabled: true,
				lowCutFrequencyHz: 90,
				lowCutSlopeDbPerOct: 18,
				lowGainDb: 1,
				lowFrequencyHz: 150,
				lowMidGainDb: 2,
				lowMidFrequencyHz: 500,
				lowMidQ: 1.4,
				midGainDb: 3,
				highMidGainDb: 4,
				highMidFrequencyHz: 2600,
				highMidQ: 1.3,
				highGainDb: 5,
				highFrequencyHz: 7000,
				outputGainDb: 6,
				highCutEnabled: true,
				highCutFrequencyHz: 6000,
				highCutSlopeDbPerOct: 24
			})
		]);

		const stage = graph!.eqStageNodes[0]!;
		expect(stage.band1PassNodes).toHaveLength(3);
		expect(stage.band6PassNodes).toHaveLength(4);
		expect(getConnections(graph!.sourceInputNode)[0]).toBe(stage.band1PassNodes[0]);
		expect(getConnections(stage.band1PassNodes.at(-1)!)[0]).toBe(stage.lowNode);
		expect(getConnections(stage.highNode)[0]).toBe(stage.band6PassNodes[0]);
		expect(getConnections(stage.band6PassNodes.at(-1)!)[0]).toBe(stage.outputGainNode);
		expect(getConnections(stage.outputGainNode)[0]).toBe(graph!.outputGainNode);

		expect(stage.lowNode.frequency.value).toBe(150);
		expect(stage.lowNode.gain.value).toBe(1);
		expect(stage.lowMidNode.frequency.value).toBe(500);
		expect(stage.lowMidNode.Q.value).toBe(1.4);
		expect(stage.lowMidNode.gain.value).toBe(2);
		expect(stage.midPeakingNode.gain.value).toBe(3);
		expect(stage.highMidNode.frequency.value).toBe(2600);
		expect(stage.highMidNode.Q.value).toBe(1.3);
		expect(stage.highMidNode.gain.value).toBe(4);
		expect(stage.highNode.frequency.value).toBe(7000);
		expect(stage.highNode.gain.value).toBe(5);
		expect(stage.outputGainNode.gain.value).toBeCloseTo(Math.pow(10, 6 / 20), 5);

		rampPreviewClipEq(
			graph!,
			[
				resolveAudioEqSettings({
					lowCutEnabled: true,
					lowCutFrequencyHz: 90,
					lowCutSlopeDbPerOct: 18,
					lowGainDb: -1,
					lowFrequencyHz: 130,
					lowMidGainDb: -2,
					lowMidFrequencyHz: 450,
					lowMidQ: 1.1,
					midGainDb: -3,
					highMidGainDb: -4,
					highMidFrequencyHz: 2400,
					highMidQ: 1.05,
					highGainDb: -5,
					highFrequencyHz: 6500,
					outputGainDb: -3,
					highCutEnabled: true,
					highCutFrequencyHz: 6000,
					highCutSlopeDbPerOct: 24
				})
			],
			2,
			0.25
		);

		expect(getRampCalls(stage.lowNode.frequency).at(-1)).toEqual({ value: 130, time: 2.25 });
		expect(getRampCalls(stage.lowNode.gain).at(-1)).toEqual({ value: -1, time: 2.25 });
		expect(getRampCalls(stage.lowMidNode.frequency).at(-1)).toEqual({ value: 450, time: 2.25 });
		expect(getRampCalls(stage.lowMidNode.Q).at(-1)).toEqual({ value: 1.1, time: 2.25 });
		expect(getRampCalls(stage.lowMidNode.gain).at(-1)).toEqual({ value: -2, time: 2.25 });
		expect(getRampCalls(stage.midPeakingNode.gain).at(-1)).toEqual({ value: -3, time: 2.25 });
		expect(getRampCalls(stage.highMidNode.frequency).at(-1)).toEqual({ value: 2400, time: 2.25 });
		expect(getRampCalls(stage.highMidNode.Q).at(-1)).toEqual({ value: 1.05, time: 2.25 });
		expect(getRampCalls(stage.highMidNode.gain).at(-1)).toEqual({ value: -4, time: 2.25 });
		expect(getRampCalls(stage.highNode.frequency).at(-1)).toEqual({ value: 6500, time: 2.25 });
		expect(getRampCalls(stage.highNode.gain).at(-1)).toEqual({ value: -5, time: 2.25 });
		expect(getRampCalls(stage.outputGainNode.gain).at(-1)).toEqual({
			value: Math.pow(10, -3 / 20),
			time: 2.25
		});
	});

	it('clamps biquad frequency automation to the audio context sample rate', () => {
		const graph = createPreviewClipAudioGraph({ eqStageCount: 1 });
		expect(graph).not.toBeNull();

		const mockContext = graph!.context as unknown as AudioContextMock;
		mockContext.sampleRate = 16000;

		setPreviewClipEq(graph!, [
			resolveAudioEqSettings({
				highGainDb: 3,
				highFrequencyHz: 22000
			})
		]);

		const stage = graph!.eqStageNodes[0]!;
		expect(stage.highNode.frequency.value).toBe(7200);

		rampPreviewClipEq(
			graph!,
			[
				resolveAudioEqSettings({
					highGainDb: -3,
					highFrequencyHz: 22000
				})
			],
			2,
			0.25
		);

		expect(getRampCalls(stage.highNode.frequency).at(-1)).toEqual({ value: 7200, time: 2.25 });
	});

	it('maintains effect chain topology on bypass and reorder without duplicate routing', () => {
		const graph = createPreviewClipAudioGraph({
			eqStageCount: 1,
			effects: [createDefaultAudioEffect('delay'), createDefaultAudioEffect('pan')]
		});
		expect(graph).not.toBeNull();
		expect(graph!.effectNodes).toHaveLength(2);
		const firstOut = graph!.effectNodes[0]!.output;
		expect(getConnections(firstOut)).toEqual([graph!.effectNodes[1]!.input]);
		const bypassed = [
			graph!.resolvedEffects[0]!,
			{ ...graph!.resolvedEffects[1]!, enabled: false }
		];
		setPreviewAudioEffects(graph!, bypassed);
		expect(graph!.effectNodes).toHaveLength(2);
		expect(graph!.effectNodes[1]!.enabled).toBe(false);
		expect(getConnections(graph!.effectNodes[0]!.output)).toEqual([graph!.effectNodes[1]!.bypass]);
		expect(getConnections(graph!.effectNodes[1]!.bypass)).toEqual([graph!.outputGainNode]);
		const reordered = [bypassed[1]!, bypassed[0]!];
		setPreviewAudioEffects(graph!, reordered);
		expect(graph!.effectNodes[0]!.id).toBe(reordered[0]!.id);
		expect(graph!.effectNodes).toHaveLength(2);
		// No duplicate routing after reorder: each output/bypass has at most one outgoing
		for (const fx of graph!.effectNodes) {
			expect(getConnections(fx.output).length).toBeLessThanOrEqual(1);
			expect(getConnections(fx.bypass).length).toBeLessThanOrEqual(1);
		}
		expect(getConnections(graph!.eqStageNodes[0]!.outputGainNode).length).toBe(1);
	});

	it('hot-swaps topology-changing EQ updates without disconnecting the source input node again', () => {
		const graph = createPreviewClipAudioGraph({ eqStageCount: 1 });
		expect(graph).not.toBeNull();

		const sourceInputNode = graph!.sourceInputNode as unknown as ConnectableNodeMock;
		const disconnectAllCallsBefore = sourceInputNode.disconnectAllCalls;

		setPreviewClipEq(graph!, [
			resolveAudioEqSettings({
				lowCutEnabled: true,
				lowCutFrequencyHz: 90,
				lowCutSlopeDbPerOct: 18,
				highCutEnabled: true,
				highCutFrequencyHz: 6000,
				highCutSlopeDbPerOct: 24
			})
		]);

		const stage = graph!.eqStageNodes[0]!;
		expect(sourceInputNode.disconnectAllCalls).toBe(disconnectAllCallsBefore);
		expect(sourceInputNode.disconnectTargetCalls).toBeGreaterThan(0);
		expect(stage.band1PassNodes).toHaveLength(3);
		expect(stage.band6PassNodes).toHaveLength(4);
		expect(getConnections(graph!.sourceInputNode)).toEqual([stage.band1PassNodes[0]]);
		expect(getConnections(stage.outputGainNode)).toEqual([graph!.outputGainNode]);
	});
});
