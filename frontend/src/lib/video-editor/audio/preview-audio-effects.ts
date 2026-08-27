import type { AudioEffect } from './audio-effects';
import { normalizeAudioEffects } from './audio-effects';

export interface PreviewAudioEffectNodes {
	id: string;
	type: AudioEffect['type'];
	enabled: boolean;
	input: GainNode;
	output: GainNode;
	bypass: GainNode;
	nodes: AudioNode[];
	update(effect: AudioEffect): void;
	dispose(): void;
}

function createCompressorNodes(
	context: AudioContext,
	effect: AudioEffect
): PreviewAudioEffectNodes {
	const compressor = context.createDynamicsCompressor();
	const makeup = context.createGain();
	const dry = context.createGain();
	const wet = context.createGain();
	const input = context.createGain();
	const output = context.createGain();
	const bypass = context.createGain();
	const c = effect as import('./audio-effects').CompressorEffect;
	compressor.threshold.value = c.thresholdDb;
	compressor.ratio.value = c.ratio;
	compressor.attack.value = c.attackMs / 1000;
	compressor.release.value = c.releaseMs / 1000;
	compressor.knee.value = c.kneeDb;
	makeup.gain.value = Math.pow(10, c.makeupGainDb / 20);
	dry.gain.value = 1 - c.mix;
	wet.gain.value = c.mix;
	input.connect(compressor);
	compressor.connect(makeup);
	makeup.connect(wet);
	input.connect(dry);
	dry.connect(output);
	wet.connect(output);
	return {
		id: effect.id,
		type: effect.type,
		enabled: effect.enabled,
		input,
		output,
		bypass,
		nodes: [compressor, makeup, dry, wet, input, output, bypass],
		update(next: AudioEffect) {
			const n = next as import('./audio-effects').CompressorEffect;
			compressor.threshold.value = n.thresholdDb;
			compressor.ratio.value = n.ratio;
			compressor.attack.value = n.attackMs / 1000;
			compressor.release.value = n.releaseMs / 1000;
			compressor.knee.value = n.kneeDb;
			makeup.gain.value = Math.pow(10, n.makeupGainDb / 20);
			dry.gain.value = 1 - n.mix;
			wet.gain.value = n.mix;
			this.enabled = n.enabled;
		},
		dispose() {
			for (const node of [compressor, makeup, dry, wet, input, output, bypass]) node.disconnect();
		}
	};
}

function createPanNodes(context: AudioContext, effect: AudioEffect): PreviewAudioEffectNodes {
	const panner = context.createStereoPanner();
	const input = context.createGain();
	const output = context.createGain();
	const bypass = context.createGain();
	const p = effect as import('./audio-effects').PanEffect;
	panner.pan.value = p.pan;
	input.connect(panner);
	panner.connect(output);
	return {
		id: effect.id,
		type: effect.type,
		enabled: effect.enabled,
		input,
		output,
		bypass,
		nodes: [panner, input, output, bypass],
		update(next: AudioEffect) {
			const n = next as import('./audio-effects').PanEffect;
			(panner.pan as AudioParam).value = n.pan;
			this.enabled = n.enabled;
		},
		dispose() {
			for (const node of [panner, input, output, bypass]) node.disconnect();
		}
	};
}

function seededRandom(seed: number): () => number {
	let s = seed >>> 0;
	return () => {
		s = (s * 1664525 + 1013904223) >>> 0;
		return s / 0xffffffff;
	};
}

function hashParams(decay: number, roomSize: number, damping: number): number {
	return (
		Math.floor(decay * 7919) ^ Math.floor(roomSize * 5009) ^ Math.floor(damping * 3001) ^ 0x9e3779b1
	);
}

function generateReverbImpulse(
	context: AudioContext,
	decay: number,
	roomSize: number,
	damping: number
): AudioBuffer {
	const sampleRate = context.sampleRate;
	const length = Math.max(1, Math.round(decay * sampleRate * 0.6));
	const impulse = context.createBuffer(2, length, sampleRate);
	const rand = seededRandom(hashParams(decay, roomSize, damping));
	for (let ch = 0; ch < 2; ch++) {
		const data = impulse.getChannelData(ch);
		for (let i = 0; i < length; i++) {
			const t = i / sampleRate;
			const env = Math.exp(-t * (3 / Math.max(0.1, decay))) * (0.5 + roomSize * 0.5);
			const damp = 1 - damping * 0.6 * (i / length);
			data[i] = (rand() * 2 - 1) * env * damp * 0.35;
		}
		data[0] = 0.9;
	}
	return impulse;
}

function createReverbNodes(context: AudioContext, effect: AudioEffect): PreviewAudioEffectNodes {
	const convolver = context.createConvolver();
	const dry = context.createGain();
	const wet = context.createGain();
	const input = context.createGain();
	const output = context.createGain();
	const bypass = context.createGain();
	const delay = context.createDelay(0.12);
	const r = effect as import('./audio-effects').ReverbEffect;
	let currentDecay = r.decaySeconds;
	let currentRoom = r.roomSize;
	let currentDamp = r.damping;
	convolver.buffer = generateReverbImpulse(context, currentDecay, currentRoom, currentDamp);
	convolver.normalize = true;
	delay.delayTime.value = r.preDelayMs / 1000;
	dry.gain.value = 1 - r.wet;
	wet.gain.value = r.wet;
	input.connect(dry);
	dry.connect(output);
	input.connect(delay);
	delay.connect(convolver);
	convolver.connect(wet);
	wet.connect(output);
	return {
		id: effect.id,
		type: effect.type,
		enabled: effect.enabled,
		input,
		output,
		bypass,
		nodes: [convolver, dry, wet, input, output, bypass, delay],
		update(next: AudioEffect) {
			const n = next as import('./audio-effects').ReverbEffect;
			if (
				n.decaySeconds !== currentDecay ||
				n.roomSize !== currentRoom ||
				n.damping !== currentDamp
			) {
				convolver.buffer = generateReverbImpulse(context, n.decaySeconds, n.roomSize, n.damping);
				currentDecay = n.decaySeconds;
				currentRoom = n.roomSize;
				currentDamp = n.damping;
			}
			delay.delayTime.value = n.preDelayMs / 1000;
			dry.gain.value = 1 - n.wet;
			wet.gain.value = n.wet;
			this.enabled = n.enabled;
		},
		dispose() {
			for (const node of [convolver, dry, wet, input, output, bypass, delay]) node.disconnect();
		}
	};
}

function createDelayNodes(context: AudioContext, effect: AudioEffect): PreviewAudioEffectNodes {
	const d = effect as import('./audio-effects').DelayEffect;
	const delay = context.createDelay(2.05);
	const feedback = context.createGain();
	const dry = context.createGain();
	const wet = context.createGain();
	const input = context.createGain();
	const output = context.createGain();
	const bypass = context.createGain();
	const filterLow = context.createBiquadFilter();
	const filterHigh = context.createBiquadFilter();
	delay.delayTime.value = d.timeMs / 1000;
	feedback.gain.value = d.feedback;
	dry.gain.value = 1 - d.mix;
	wet.gain.value = d.mix;
	filterLow.type = 'highpass';
	filterLow.frequency.value = d.lowCutHz;
	filterHigh.type = 'lowpass';
	filterHigh.frequency.value = d.highCutHz;
	input.connect(dry);
	dry.connect(output);
	input.connect(delay);
	delay.connect(filterLow);
	filterLow.connect(filterHigh);
	filterHigh.connect(feedback);
	feedback.connect(delay);
	filterHigh.connect(wet);
	wet.connect(output);
	return {
		id: effect.id,
		type: effect.type,
		enabled: effect.enabled,
		input,
		output,
		bypass,
		nodes: [delay, feedback, dry, wet, input, output, bypass, filterLow, filterHigh],
		update(next: AudioEffect) {
			const n = next as import('./audio-effects').DelayEffect;
			delay.delayTime.value = n.timeMs / 1000;
			feedback.gain.value = n.feedback;
			dry.gain.value = 1 - n.mix;
			wet.gain.value = n.mix;
			filterLow.frequency.value = n.lowCutHz;
			filterHigh.frequency.value = n.highCutHz;
			this.enabled = n.enabled;
		},
		dispose() {
			for (const node of [delay, feedback, dry, wet, input, output, bypass, filterLow, filterHigh])
				node.disconnect();
		}
	};
}

function createDistortionNodes(
	context: AudioContext,
	effect: AudioEffect
): PreviewAudioEffectNodes {
	const shaper = context.createWaveShaper();
	const dry = context.createGain();
	const wet = context.createGain();
	const input = context.createGain();
	const output = context.createGain();
	const bypass = context.createGain();
	const toneFilter = context.createBiquadFilter();
	const outGain = context.createGain();
	const d = effect as import('./audio-effects').DistortionEffect;
	const drive = 1 + d.amount * 18;
	const curve = new Float32Array(441);
	for (let i = 0; i < curve.length; i++) {
		const x = (i / (curve.length - 1)) * 2 - 1;
		curve[i] = Math.tanh(x * drive) / Math.tanh(drive * 0.6 + 0.4);
	}
	shaper.curve = curve;
	shaper.oversample = '4x';
	dry.gain.value = 1 - d.mix;
	wet.gain.value = d.mix;
	toneFilter.type = 'lowpass';
	toneFilter.frequency.value = 600 + d.tone * 8000;
	outGain.gain.value = Math.pow(10, d.outputGainDb / 20);
	input.connect(dry);
	dry.connect(output);
	input.connect(shaper);
	shaper.connect(toneFilter);
	toneFilter.connect(outGain);
	outGain.connect(wet);
	wet.connect(output);
	return {
		id: effect.id,
		type: effect.type,
		enabled: effect.enabled,
		input,
		output,
		bypass,
		nodes: [shaper, dry, wet, input, output, bypass, toneFilter, outGain],
		update(next: AudioEffect) {
			const n = next as import('./audio-effects').DistortionEffect;
			const nd = 1 + n.amount * 18;
			const nc = new Float32Array(441);
			for (let i = 0; i < nc.length; i++) {
				const x = (i / (nc.length - 1)) * 2 - 1;
				nc[i] = Math.tanh(x * nd) / Math.tanh(nd * 0.6 + 0.4);
			}
			shaper.curve = nc;
			dry.gain.value = 1 - n.mix;
			wet.gain.value = n.mix;
			toneFilter.frequency.value = 600 + n.tone * 8000;
			outGain.gain.value = Math.pow(10, n.outputGainDb / 20);
			this.enabled = n.enabled;
		},
		dispose() {
			for (const node of [shaper, dry, wet, input, output, bypass, toneFilter, outGain])
				node.disconnect();
		}
	};
}

function createModulatedDelayNodes(
	context: AudioContext,
	effect: AudioEffect
): PreviewAudioEffectNodes {
	const isChorus = effect.type === 'chorus';
	const params = effect as
		| import('./audio-effects').ChorusEffect
		| import('./audio-effects').FlangerEffect;
	const delay = context.createDelay(isChorus ? 0.05 : 0.02);
	const dry = context.createGain();
	const wet = context.createGain();
	const input = context.createGain();
	const output = context.createGain();
	const bypass = context.createGain();
	const feedback = context.createGain();
	const lfo = context.createOscillator();
	const lfoGain = context.createGain();
	delay.delayTime.value = params.delayMs / 1000;
	dry.gain.value = 1 - params.mix;
	wet.gain.value = params.mix;
	feedback.gain.value = (params as import('./audio-effects').FlangerEffect).feedback ?? 0;
	lfo.frequency.value = params.rateHz;
	lfoGain.gain.value = params.depthMs / 1000;
	lfo.connect(lfoGain);
	lfoGain.connect(delay.delayTime as unknown as AudioParam);
	try {
		lfo.start();
	} catch {}
	input.connect(dry);
	dry.connect(output);
	input.connect(delay);
	delay.connect(wet);
	wet.connect(output);
	if (!isChorus) {
		delay.connect(feedback);
		feedback.connect(delay);
	}
	return {
		id: effect.id,
		type: effect.type,
		enabled: effect.enabled,
		input,
		output,
		bypass,
		nodes: [delay, dry, wet, input, output, bypass, feedback, lfo, lfoGain],
		update(next: AudioEffect) {
			const n = next as
				| import('./audio-effects').ChorusEffect
				| import('./audio-effects').FlangerEffect;
			delay.delayTime.value = n.delayMs / 1000;
			dry.gain.value = 1 - n.mix;
			wet.gain.value = n.mix;
			lfo.frequency.value = n.rateHz;
			lfoGain.gain.value = n.depthMs / 1000;
			if ('feedback' in n)
				feedback.gain.value = (n as import('./audio-effects').FlangerEffect).feedback ?? 0;
			this.enabled = n.enabled;
		},
		dispose() {
			try {
				lfo.stop();
			} catch {}
			for (const node of [delay, dry, wet, input, output, bypass, feedback, lfo, lfoGain])
				node.disconnect();
		}
	};
}

export function createPreviewAudioEffectNode(
	context: AudioContext,
	effect: AudioEffect
): PreviewAudioEffectNodes | null {
	switch (effect.type) {
		case 'compressor':
			return createCompressorNodes(context, effect);
		case 'pan':
			return createPanNodes(context, effect);
		case 'reverb':
			return createReverbNodes(context, effect);
		case 'delay':
			return createDelayNodes(context, effect);
		case 'chorus':
		case 'flanger':
			return createModulatedDelayNodes(context, effect);
		case 'distortion':
			return createDistortionNodes(context, effect);
		default:
			return null;
	}
}

export function normalizeEffectChainForPreview(effects: AudioEffect[] | undefined): AudioEffect[] {
	return normalizeAudioEffects(effects).filter((e) => e.enabled);
}
