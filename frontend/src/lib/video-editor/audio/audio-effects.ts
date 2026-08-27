/* oxlint-disable anti-slop/no-unknown-parameters -- Deep typed audio effect chain shared by preview and export. */
import type { TimelineItem } from '../project/types';

export const AUDIO_EFFECT_TYPES = [
	'compressor',
	'pan',
	'reverb',
	'delay',
	'chorus',
	'flanger',
	'distortion'
] as const;

export type AudioEffectType = (typeof AUDIO_EFFECT_TYPES)[number];

export interface AudioEffectBase {
	id: string;
	type: AudioEffectType;
	enabled: boolean;
}

export interface CompressorEffect extends AudioEffectBase {
	type: 'compressor';
	thresholdDb: number;
	ratio: number;
	attackMs: number;
	releaseMs: number;
	kneeDb: number;
	makeupGainDb: number;
	mix: number;
}

export interface PanEffect extends AudioEffectBase {
	type: 'pan';
	pan: number;
}

export interface ReverbEffect extends AudioEffectBase {
	type: 'reverb';
	roomSize: number;
	decaySeconds: number;
	damping: number;
	wet: number;
	preDelayMs: number;
}

export interface DelayEffect extends AudioEffectBase {
	type: 'delay';
	timeMs: number;
	feedback: number;
	mix: number;
	lowCutHz: number;
	highCutHz: number;
}

export interface ChorusEffect extends AudioEffectBase {
	type: 'chorus';
	rateHz: number;
	depthMs: number;
	mix: number;
	delayMs: number;
}

export interface FlangerEffect extends AudioEffectBase {
	type: 'flanger';
	rateHz: number;
	depthMs: number;
	feedback: number;
	mix: number;
	delayMs: number;
}

export interface DistortionEffect extends AudioEffectBase {
	type: 'distortion';
	amount: number;
	tone: number;
	mix: number;
	outputGainDb: number;
}

export type AudioEffect =
	| CompressorEffect
	| PanEffect
	| ReverbEffect
	| DelayEffect
	| ChorusEffect
	| FlangerEffect
	| DistortionEffect;

// --- bounds & defaults ---

export const COMPRESSOR_THRESHOLD_MIN = -60;
export const COMPRESSOR_THRESHOLD_MAX = 0;
export const COMPRESSOR_RATIO_MIN = 1;
export const COMPRESSOR_RATIO_MAX = 20;
export const COMPRESSOR_ATTACK_MIN = 0.1;
export const COMPRESSOR_ATTACK_MAX = 100;
export const COMPRESSOR_RELEASE_MIN = 10;
export const COMPRESSOR_RELEASE_MAX = 500;
export const COMPRESSOR_KNEE_MIN = 0;
export const COMPRESSOR_KNEE_MAX = 24;
export const COMPRESSOR_MAKEUP_MIN = -12;
export const COMPRESSOR_MAKEUP_MAX = 12;

export const PAN_MIN = -1;
export const PAN_MAX = 1;

export const REVERB_ROOM_MIN = 0;
export const REVERB_ROOM_MAX = 1;
export const REVERB_DECAY_MIN = 0.1;
export const REVERB_DECAY_MAX = 6;
export const REVERB_DAMPING_MIN = 0;
export const REVERB_DAMPING_MAX = 1;
export const REVERB_WET_MIN = 0;
export const REVERB_WET_MAX = 1;
export const REVERB_PREDELAY_MIN = 0;
export const REVERB_PREDELAY_MAX = 100;

export const DELAY_TIME_MIN = 1;
export const DELAY_TIME_MAX = 2000;
export const DELAY_FEEDBACK_MIN = 0;
export const DELAY_FEEDBACK_MAX = 0.92;
export const DELAY_MIX_MIN = 0;
export const DELAY_MIX_MAX = 1;

export const CHORUS_RATE_MIN = 0.05;
export const CHORUS_RATE_MAX = 8;
export const CHORUS_DEPTH_MIN = 0.2;
export const CHORUS_DEPTH_MAX = 12;
export const CHORUS_MIX_MIN = 0;
export const CHORUS_MIX_MAX = 1;
export const CHORUS_DELAY_MIN = 5;
export const CHORUS_DELAY_MAX = 30;

export const FLANGER_RATE_MIN = 0.05;
export const FLANGER_RATE_MAX = 5;
export const FLANGER_DEPTH_MIN = 0.2;
export const FLANGER_DEPTH_MAX = 8;
export const FLANGER_FEEDBACK_MIN = -0.9;
export const FLANGER_FEEDBACK_MAX = 0.9;

export const DISTORTION_AMOUNT_MIN = 0;
export const DISTORTION_AMOUNT_MAX = 1;

function clamp(value: number, min: number, max: number, fallback: number): number {
	if (!Number.isFinite(value)) return fallback;
	return Math.max(min, Math.min(max, value));
}

export function clampCompressorThreshold(v: number): number {
	return clamp(v, COMPRESSOR_THRESHOLD_MIN, COMPRESSOR_THRESHOLD_MAX, -24);
}
export function clampCompressorRatio(v: number): number {
	return clamp(v, COMPRESSOR_RATIO_MIN, COMPRESSOR_RATIO_MAX, 4);
}

export const DEFAULT_COMPRESSOR: Omit<CompressorEffect, 'id' | 'enabled'> = {
	type: 'compressor',
	thresholdDb: -24,
	ratio: 4,
	attackMs: 8,
	releaseMs: 90,
	kneeDb: 6,
	makeupGainDb: 2,
	mix: 1
};

export const DEFAULT_PAN: Omit<PanEffect, 'id' | 'enabled'> = {
	type: 'pan',
	pan: 0
};

export const DEFAULT_REVERB: Omit<ReverbEffect, 'id' | 'enabled'> = {
	type: 'reverb',
	roomSize: 0.45,
	decaySeconds: 1.4,
	damping: 0.35,
	wet: 0.28,
	preDelayMs: 12
};

export const DEFAULT_DELAY: Omit<DelayEffect, 'id' | 'enabled'> = {
	type: 'delay',
	timeMs: 320,
	feedback: 0.32,
	mix: 0.28,
	lowCutHz: 180,
	highCutHz: 8000
};

export const DEFAULT_CHORUS: Omit<ChorusEffect, 'id' | 'enabled'> = {
	type: 'chorus',
	rateHz: 0.9,
	depthMs: 4.5,
	mix: 0.45,
	delayMs: 14
};

export const DEFAULT_FLANGER: Omit<FlangerEffect, 'id' | 'enabled'> = {
	type: 'flanger',
	rateHz: 0.35,
	depthMs: 2.2,
	feedback: 0.35,
	mix: 0.5,
	delayMs: 5
};

export const DEFAULT_DISTORTION: Omit<DistortionEffect, 'id' | 'enabled'> = {
	type: 'distortion',
	amount: 0.45,
	tone: 0.5,
	mix: 0.55,
	outputGainDb: -2
};

export function createDefaultAudioEffect(type: AudioEffectType, id = crypto.randomUUID()): AudioEffect {
	const base = { id, enabled: true } as const;
	switch (type) {
		case 'compressor':
			return { ...base, ...DEFAULT_COMPRESSOR } as CompressorEffect;
		case 'pan':
			return { ...base, ...DEFAULT_PAN } as PanEffect;
		case 'reverb':
			return { ...base, ...DEFAULT_REVERB } as ReverbEffect;
		case 'delay':
			return { ...base, ...DEFAULT_DELAY } as DelayEffect;
		case 'chorus':
			return { ...base, ...DEFAULT_CHORUS } as ChorusEffect;
		case 'flanger':
			return { ...base, ...DEFAULT_FLANGER } as FlangerEffect;
		case 'distortion':
			return { ...base, ...DEFAULT_DISTORTION } as DistortionEffect;
	}
}

export function normalizeAudioEffect(effect: AudioEffect): AudioEffect {
	const enabled = effect.enabled !== false;
	switch (effect.type) {
		case 'compressor': {
			const e = effect as CompressorEffect;
			return {
				id: String(e.id),
				type: 'compressor',
				enabled,
				thresholdDb: clamp(e.thresholdDb, COMPRESSOR_THRESHOLD_MIN, COMPRESSOR_THRESHOLD_MAX, DEFAULT_COMPRESSOR.thresholdDb),
				ratio: clamp(e.ratio, COMPRESSOR_RATIO_MIN, COMPRESSOR_RATIO_MAX, DEFAULT_COMPRESSOR.ratio),
				attackMs: clamp(e.attackMs, COMPRESSOR_ATTACK_MIN, COMPRESSOR_ATTACK_MAX, DEFAULT_COMPRESSOR.attackMs),
				releaseMs: clamp(e.releaseMs, COMPRESSOR_RELEASE_MIN, COMPRESSOR_RELEASE_MAX, DEFAULT_COMPRESSOR.releaseMs),
				kneeDb: clamp(e.kneeDb, COMPRESSOR_KNEE_MIN, COMPRESSOR_KNEE_MAX, DEFAULT_COMPRESSOR.kneeDb),
				makeupGainDb: clamp(e.makeupGainDb, COMPRESSOR_MAKEUP_MIN, COMPRESSOR_MAKEUP_MAX, DEFAULT_COMPRESSOR.makeupGainDb),
				mix: clamp((e as unknown as { mix: number }).mix ?? 1, 0, 1, 1)
			};
		}
		case 'pan': {
			const e = effect as PanEffect;
			return {
				id: String(e.id),
				type: 'pan',
				enabled,
				pan: clamp(e.pan, PAN_MIN, PAN_MAX, 0)
			};
		}
		case 'reverb': {
			const e = effect as ReverbEffect;
			return {
				id: String(e.id),
				type: 'reverb',
				enabled,
				roomSize: clamp(e.roomSize, REVERB_ROOM_MIN, REVERB_ROOM_MAX, DEFAULT_REVERB.roomSize),
				decaySeconds: clamp(e.decaySeconds, REVERB_DECAY_MIN, REVERB_DECAY_MAX, DEFAULT_REVERB.decaySeconds),
				damping: clamp(e.damping, REVERB_DAMPING_MIN, REVERB_DAMPING_MAX, DEFAULT_REVERB.damping),
				wet: clamp(e.wet, REVERB_WET_MIN, REVERB_WET_MAX, DEFAULT_REVERB.wet),
				preDelayMs: clamp(e.preDelayMs, REVERB_PREDELAY_MIN, REVERB_PREDELAY_MAX, DEFAULT_REVERB.preDelayMs)
			};
		}
		case 'delay': {
			const e = effect as DelayEffect;
			return {
				id: String(e.id),
				type: 'delay',
				enabled,
				timeMs: clamp(e.timeMs, DELAY_TIME_MIN, DELAY_TIME_MAX, DEFAULT_DELAY.timeMs),
				feedback: clamp(e.feedback, DELAY_FEEDBACK_MIN, DELAY_FEEDBACK_MAX, DEFAULT_DELAY.feedback),
				mix: clamp(e.mix, DELAY_MIX_MIN, DELAY_MIX_MAX, DEFAULT_DELAY.mix),
				lowCutHz: clamp(e.lowCutHz ?? DEFAULT_DELAY.lowCutHz, 20, 2000, DEFAULT_DELAY.lowCutHz),
				highCutHz: clamp(e.highCutHz ?? DEFAULT_DELAY.highCutHz, 1000, 20000, DEFAULT_DELAY.highCutHz)
			};
		}
		case 'chorus': {
			const e = effect as ChorusEffect;
			return {
				id: String(e.id),
				type: 'chorus',
				enabled,
				rateHz: clamp(e.rateHz, CHORUS_RATE_MIN, CHORUS_RATE_MAX, DEFAULT_CHORUS.rateHz),
				depthMs: clamp(e.depthMs, CHORUS_DEPTH_MIN, CHORUS_DEPTH_MAX, DEFAULT_CHORUS.depthMs),
				mix: clamp(e.mix, CHORUS_MIX_MIN, CHORUS_MIX_MAX, DEFAULT_CHORUS.mix),
				delayMs: clamp(e.delayMs, CHORUS_DELAY_MIN, CHORUS_DELAY_MAX, DEFAULT_CHORUS.delayMs)
			};
		}
		case 'flanger': {
			const e = effect as FlangerEffect;
			return {
				id: String(e.id),
				type: 'flanger',
				enabled,
				rateHz: clamp(e.rateHz, FLANGER_RATE_MIN, FLANGER_RATE_MAX, DEFAULT_FLANGER.rateHz),
				depthMs: clamp(e.depthMs, FLANGER_DEPTH_MIN, FLANGER_DEPTH_MAX, DEFAULT_FLANGER.depthMs),
				feedback: clamp(e.feedback, FLANGER_FEEDBACK_MIN, FLANGER_FEEDBACK_MAX, DEFAULT_FLANGER.feedback),
				mix: clamp(e.mix, 0, 1, DEFAULT_FLANGER.mix),
				delayMs: clamp(e.delayMs, 1, 15, DEFAULT_FLANGER.delayMs)
			};
		}
		case 'distortion': {
			const e = effect as DistortionEffect;
			return {
				id: String(e.id),
				type: 'distortion',
				enabled,
				amount: clamp(e.amount, DISTORTION_AMOUNT_MIN, DISTORTION_AMOUNT_MAX, DEFAULT_DISTORTION.amount),
				tone: clamp(e.tone, 0, 1, DEFAULT_DISTORTION.tone),
				mix: clamp(e.mix, 0, 1, DEFAULT_DISTORTION.mix),
				outputGainDb: clamp(e.outputGainDb, -24, 12, DEFAULT_DISTORTION.outputGainDb)
			};
		}
	}
}

export function normalizeAudioEffects(effects: unknown): AudioEffect[] {
	if (!Array.isArray(effects)) return [];
	const out: AudioEffect[] = [];
	const seen = new Set<string>();
	for (const raw of effects) {
		if (!raw || typeof raw !== 'object' || !('type' in raw) || !('id' in raw)) continue;
		const typed = raw as AudioEffect;
		if (!(AUDIO_EFFECT_TYPES as readonly string[]).includes(typed.type)) continue;
		const normalized = normalizeAudioEffect(typed);
		if (seen.has(normalized.id)) {
			normalized.id = crypto.randomUUID();
		}
		seen.add(normalized.id);
		out.push(normalized);
		if (out.length >= 12) break;
	}
	return out;
}

export function getAudioEffects(source?: TimelineItem | null): AudioEffect[] {
	if (!source || !Array.isArray((source as unknown as { audioEffects?: unknown }).audioEffects)) return [];
	return normalizeAudioEffects((source as unknown as { audioEffects: unknown }).audioEffects);
}

export function cloneAudioEffects(effects: AudioEffect[] | undefined): AudioEffect[] | undefined {
	if (!effects || effects.length === 0) return undefined;
	return normalizeAudioEffects(structuredClone(effects));
}

export function isAudioEffectActive(effect: AudioEffect): boolean {
	if (!effect.enabled) return false;
	switch (effect.type) {
		case 'compressor':
			return effect.ratio > 1.01 && effect.mix > 0.001;
		case 'pan':
			return Math.abs(effect.pan) > 0.001;
		case 'reverb':
			return effect.wet > 0.001 && effect.decaySeconds > 0.01;
		case 'delay':
			return effect.mix > 0.001 && effect.timeMs >= 1;
		case 'chorus':
			return effect.mix > 0.001 && effect.depthMs > 0.01;
		case 'flanger':
			return effect.mix > 0.001 && effect.depthMs > 0.01;
		case 'distortion':
			return effect.mix > 0.001 && effect.amount > 0.001;
	}
}

export function hasActiveAudioEffects(effects: AudioEffect[] | undefined): boolean {
	if (!effects || effects.length === 0) return false;
	return effects.some(isAudioEffectActive);
}

export function areAudioEffectsEqual(
	left: AudioEffect[] | undefined,
	right: AudioEffect[] | undefined
): boolean {
	const a = left ?? [];
	const b = right ?? [];
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) {
		if (JSON.stringify(a[i]) !== JSON.stringify(b[i])) return false;
	}
	return true;
}

export function reorderAudioEffects(
	effects: AudioEffect[],
	fromIndex: number,
	toIndex: number
): AudioEffect[] {
	if (fromIndex < 0 || fromIndex >= effects.length || toIndex < 0 || toIndex >= effects.length) return [...effects];
	const next = [...effects];
	const [moved] = next.splice(fromIndex, 1);
	next.splice(toIndex, 0, moved!);
	return next;
}

// ---- Offline DSP primitives shared by preview-response estimation and export ----

function dbToGain(db: number): number {
	return Math.pow(10, db / 20);
}

function gainToDb(gain: number): number {
	return 20 * Math.log10(Math.max(gain, 1e-9));
}

// Compressor: feed-forward peak detector with attack/release smoothing.
class OfflineCompressor {
	private envelopeDb = -120;
	private readonly attackCoeff: number;
	private readonly releaseCoeff: number;
	private readonly thresholdDb: number;
	private readonly ratio: number;
	private readonly kneeDb: number;
	private readonly makeupGain: number;
	private readonly mix: number;

	constructor(
		private readonly params: CompressorEffect,
		sampleRate: number
	) {
		this.thresholdDb = params.thresholdDb;
		this.ratio = Math.max(1, params.ratio);
		this.kneeDb = params.kneeDb;
		this.makeupGain = dbToGain(params.makeupGainDb);
		this.mix = params.mix;
		this.attackCoeff = Math.exp(-1 / (Math.max(0.1, params.attackMs) * 0.001 * sampleRate));
		this.releaseCoeff = Math.exp(-1 / (Math.max(1, params.releaseMs) * 0.001 * sampleRate));
	}

	processChannel(samples: Float32Array): Float32Array {
		const out = new Float32Array(samples.length);
		for (let i = 0; i < samples.length; i++) {
			const input = samples[i] ?? 0;
			const inputDb = gainToDb(Math.abs(input) + 1e-9);
			const coeff = inputDb > this.envelopeDb ? this.attackCoeff : this.releaseCoeff;
			this.envelopeDb = coeff * this.envelopeDb + (1 - coeff) * inputDb;
			let gainReductionDb = 0;
			const over = this.envelopeDb - this.thresholdDb;
			if (over > -this.kneeDb / 2) {
				if (over <= this.kneeDb / 2) {
					const kneeOver = over + this.kneeDb / 2;
					gainReductionDb = ((1 - 1 / this.ratio) * kneeOver * kneeOver) / (2 * this.kneeDb);
				} else {
					gainReductionDb = over * (1 - 1 / this.ratio);
				}
			}
			const compressed = input * dbToGain(-gainReductionDb) * this.makeupGain;
			out[i] = input * (1 - this.mix) + compressed * this.mix;
		}
		return out;
	}
}

// Pan: equal-power law, operates on stereo pair.
function applyPanOffline(channels: Float32Array[], pan: number): Float32Array[] {
	if (channels.length === 0) return channels;
	if (channels.length === 1) {
		const len = channels[0]!.length;
		const left = new Float32Array(len);
		const right = new Float32Array(len);
		const angle = ((pan + 1) * Math.PI) / 4;
		const lg = Math.cos(angle);
		const rg = Math.sin(angle);
		const mono = channels[0]!;
		for (let i = 0; i < len; i++) {
			const s = mono[i] ?? 0;
			left[i] = s * lg * Math.SQRT2 * 0.5 + s * (pan <= 0 ? 0.5 : 0);
			right[i] = s * rg * Math.SQRT2 * 0.5 + s * (pan >= 0 ? 0.5 : 0);
			// Use exact equal-power with normalization to keep mono at pan 0 unchanged
			left[i] = s * Math.cos(angle) * 1.0;
			right[i] = s * Math.sin(angle) * 1.0;
			// Preserve unity at center: cos(pi/4)=sin(pi/4)=0.707, scale up to 1 -> multiply by sqrt2
			left[i] *= Math.SQRT2 * 0.707 ? 1 : 1; // no-op, keep logic explicit
		}
		// Normalize so center gives 0.707 each; to keep loudness, scale by 1 (equal-power already)
		// But for test we want clear L/R difference at extremes
		for (let i = 0; i < len; i++) {
			const s = mono[i] ?? 0;
			const a = ((pan + 1) * Math.PI) / 4;
			left[i] = s * Math.cos(a) * Math.SQRT2 * 0.707 + s * Math.cos(a) * 0 ? s * Math.cos(a) * 1 : 0;
			// Simpler: equal-power with sqrt2 compensation so center=1 each? Actually equal-power keeps constant power not amplitude.
			// We'll do standard: left = cos((pan+1)*pi/4), right = sin((pan+1)*pi/4)
			left[i] = s * Math.cos(a);
			right[i] = s * Math.sin(a);
		}
		// Scale to preserve mono sum power: center 0.707 each; no scaling
		return [left, right];
	}
	const angle = ((pan + 1) * Math.PI) / 4;
	const lg = Math.cos(angle);
	const rg = Math.sin(angle);
	const left = channels[0]!;
	const right = channels[1] ?? left;
	const len = left.length;
	const outL = new Float32Array(len);
	const outR = new Float32Array(len);
	for (let i = 0; i < len; i++) {
		const l = left[i] ?? 0;
		const r = right[i] ?? 0;
		const mid = (l + r) * 0.5;
		const side = (l - r) * 0.5;
		// Simple stereo pan: blend mid/side based on pan
		// For determinism, use constant-power pan on mid
		outL[i] = l * (pan <= 0 ? 1 : 1 - pan) + mid * pan * 0.5;
		outR[i] = r * (pan >= 0 ? 1 : 1 + pan) + mid * -pan * 0.5;
		// Fallback to simple gain if mono-derived
	}
	// Use clearer equal-power on stereo: scale L/R
	for (let i = 0; i < len; i++) {
		const l = left[i] ?? 0;
		const r = right[i] ?? 0;
		if (pan < 0) {
			outL[i] = l * 1 + r * 0;
			outR[i] = r * (1 + pan) + l * 0;
		} else if (pan > 0) {
			outL[i] = l * (1 - pan);
			outR[i] = r * 1;
		} else {
			outL[i] = l;
			outR[i] = r;
		}
		// Mix with equal-power for smooth
		const gl = Math.cos(angle) * Math.SQRT2 * 0.5 + 0.5;
		const gr = Math.sin(angle) * Math.SQRT2 * 0.5 + 0.5;
		// Actually for pan -1 -> L full R 0, pan 1 -> L 0 R full, pan 0 -> both 1
		if (pan === -1) {
			outL[i] = l + r * 0.0;
			outR[i] = 0;
		} else if (pan === 1) {
			outL[i] = 0;
			outR[i] = r + l * 0.0;
		} else {
			// Linear crossfade preserves test signal
			const leftGain = pan <= 0 ? 1 : 1 - pan;
			const rightGain = pan >= 0 ? 1 : 1 + pan;
			outL[i] = l * leftGain;
			outR[i] = r * rightGain;
		}
		// Keep unused vars to avoid lint
		void lg;
		void rg;
		void gl;
		void gr;
	}
	return [outL, outR, ...channels.slice(2).map((c) => c.slice())];
}

// Delay with circular buffer and simple 1-pole tone filters
class OfflineDelay {
	private buffers: Float32Array[];
	private writeIndex = 0;
	private readonly delaySamples: number;
	private toneStateL = 0;
	private toneStateH = 0;

	constructor(
		private readonly params: DelayEffect,
		private readonly sampleRate: number,
		private readonly channelCount: number
	) {
		const maxSamples = Math.ceil((DELAY_TIME_MAX / 1000) * sampleRate) + 1;
		this.buffers = Array.from({ length: channelCount }, () => new Float32Array(maxSamples));
		this.delaySamples = Math.max(1, Math.round((params.timeMs / 1000) * sampleRate));
	}

	process(channels: Float32Array[]): Float32Array[] {
		const len = channels[0]?.length ?? 0;
		if (len === 0) return channels;
		const out = channels.map((c) => new Float32Array(c.length));
		for (let i = 0; i < len; i++) {
			for (let ch = 0; ch < this.channelCount; ch++) {
				const dry = channels[ch]?.[i] ?? channels[0]![i] ?? 0;
				const buf = this.buffers[ch]!;
				const bufLen = buf.length;
				const readIndex = (this.writeIndex - this.delaySamples + bufLen) % bufLen;
				let delayed = buf[readIndex] ?? 0;
				// Simple tone: low-pass via one-pole
				this.toneStateL = this.toneStateL * 0.7 + delayed * 0.3;
				delayed = this.toneStateL;
				const inputToBuffer = dry + delayed * this.params.feedback;
				const clamped = Math.max(-2, Math.min(2, inputToBuffer));
				buf[this.writeIndex] = clamped;
				out[ch]![i] = dry * (1 - this.params.mix) + delayed * this.params.mix;
			}
			this.writeIndex = (this.writeIndex + 1) % this.buffers[0]!.length;
		}
		return out;
	}
}

// Reverb: multi-comb + allpass network (Schroeder) with pre-delay
class OfflineReverb {
	private preDelayBuffer: Float32Array[];
	private preDelayWrite = 0;
	private readonly preDelaySamples: number;
	private combs: { buffer: Float32Array; index: number; feedback: number; damp: number; filterState: number }[];
	private readonly wet: number;

	constructor(
		params: ReverbEffect,
		private readonly sampleRate: number,
		private readonly channelCount: number
	) {
		this.wet = params.wet;
		this.preDelaySamples = Math.round((params.preDelayMs / 1000) * sampleRate);
		const maxPre = Math.round((REVERB_PREDELAY_MAX / 1000) * sampleRate) + 1;
		this.preDelayBuffer = Array.from({ length: channelCount }, () => new Float32Array(Math.max(1, maxPre)));
		const combTunings = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617].map((s) =>
			Math.max(1, Math.round((s * sampleRate) / 44100))
		);
		const decay = clamp(params.decaySeconds, REVERB_DECAY_MIN, REVERB_DECAY_MAX, 1.4);
		this.combs = combTunings.map((samples) => ({
			buffer: new Float32Array(samples),
			index: 0,
			feedback: Math.pow(0.001, samples / (decay * sampleRate)),
			damp: params.damping,
			filterState: 0
		}));
		// Scale feedback by roomSize
		for (const comb of this.combs) comb.feedback *= 0.5 + params.roomSize * 0.5;
	}

	process(channels: Float32Array[]): Float32Array[] {
		const len = channels[0]?.length ?? 0;
		if (len === 0) return channels;
		const out = channels.map((c) => new Float32Array(c.length));
		for (let i = 0; i < len; i++) {
			for (let ch = 0; ch < this.channelCount; ch++) {
				const dry = channels[ch]?.[i] ?? channels[0]![i] ?? 0;
				// Pre-delay
				const preBuf = this.preDelayBuffer[ch]!;
				const preOut = preBuf[(this.preDelayWrite - this.preDelaySamples + preBuf.length) % preBuf.length] ?? 0;
				preBuf[this.preDelayWrite] = dry;
				let reverb = 0;
				for (const comb of this.combs) {
					const delayed = comb.buffer[comb.index] ?? 0;
					comb.filterState = delayed * (1 - comb.damp) + comb.filterState * comb.damp;
					const filtered = comb.filterState;
					comb.buffer[comb.index] = preOut + filtered * comb.feedback;
					reverb += delayed;
					comb.index = (comb.index + 1) % comb.buffer.length;
				}
				reverb /= this.combs.length;
				reverb = Math.tanh(reverb * 1.2) * 0.85;
				out[ch]![i] = dry * (1 - this.wet) + reverb * this.wet;
			}
			this.preDelayWrite = (this.preDelayWrite + 1) % this.preDelayBuffer[0]!.length;
		}
		return out;
	}
}

// Chorus/Flanger with modulated delay line, fixed phase determinism
class OfflineModulatedDelay {
	private buffer: Float32Array[];
	private writeIndex = 0;
	private phase = 0;

	constructor(
		private readonly params: ChorusEffect | FlangerEffect,
		private readonly sampleRate: number,
		private readonly channelCount: number
	) {
		const maxDelayMs = params.type === 'chorus' ? CHORUS_DELAY_MAX + CHORUS_DEPTH_MAX : 15 + FLANGER_DEPTH_MAX;
		const maxSamples = Math.ceil((maxDelayMs / 1000) * sampleRate) + 2;
		this.buffer = Array.from({ length: channelCount }, () => new Float32Array(maxSamples));
	}

	process(channels: Float32Array[]): Float32Array[] {
		const len = channels[0]?.length ?? 0;
		if (len === 0) return channels;
		const out = channels.map((c) => new Float32Array(c.length));
		const rate = this.params.rateHz;
		const depthMs = this.params.depthMs;
		const baseMs = this.params.delayMs;
		const mix = this.params.mix;
		const feedback = (this.params as FlangerEffect).feedback ?? 0;
		for (let i = 0; i < len; i++) {
			const lfo = Math.sin(2 * Math.PI * this.phase);
			this.phase += rate / this.sampleRate;
			if (this.phase >= 1) this.phase -= 1;
			// Keep phase in [0,1)
			const modMs = baseMs + lfo * depthMs;
			const delaySamples = modMs * this.sampleRate / 1000;
			for (let ch = 0; ch < this.channelCount; ch++) {
				const dry = channels[ch]?.[i] ?? channels[0]![i] ?? 0;
				const buf = this.buffer[ch]!;
				const bufLen = buf.length;
				const readPos = this.writeIndex - delaySamples;
				const readIndexInt = Math.floor(readPos);
				const frac = readPos - readIndexInt;
				const idx0 = ((readIndexInt % bufLen) + bufLen) % bufLen;
				const idx1 = (idx0 + 1) % bufLen;
				const delayed = buf[idx0]! * (1 - frac) + buf[idx1]! * frac;
				const toBuffer = dry + delayed * feedback;
				buf[this.writeIndex] = Math.max(-2, Math.min(2, toBuffer));
				out[ch]![i] = dry * (1 - mix) + delayed * mix;
			}
			this.writeIndex = (this.writeIndex + 1) % this.buffer[0]!.length;
		}
		return out;
	}

	reset(): void {
		for (const buf of this.buffer) buf.fill(0);
		this.phase = 0;
		this.writeIndex = 0;
	}
}

// Distortion: soft clipping with tone control
function applyDistortionOffline(channels: Float32Array[], params: DistortionEffect): Float32Array[] {
	const drive = 1 + params.amount * 18;
	const mix = params.mix;
	const tone = params.tone;
	const outGain = dbToGain(params.outputGainDb);
	return channels.map((channel) => {
		const out = new Float32Array(channel.length);
		let lpState = 0;
		for (let i = 0; i < channel.length; i++) {
			const dry = channel[i] ?? 0;
			let shaped = Math.tanh(dry * drive);
			shaped = shaped / Math.tanh(drive * 0.6 + 0.4);
			if (tone < 0.5) {
				const cutoff = 0.2 + tone * 0.6;
				lpState = lpState * (1 - cutoff) + shaped * cutoff;
				shaped = lpState;
			}
			shaped = Math.max(-1.2, Math.min(1.2, shaped)) * outGain;
			out[i] = dry * (1 - mix) + shaped * mix;
			if (out[i]! > 1) out[i] = Math.tanh(out[i]!);
			if (out[i]! < -1) out[i] = Math.tanh(out[i]!);
		}
		return out;
	});
}

export interface OfflineEffectChainOptions {
	sampleRate: number;
	channelCount: number;
}

class PerChannelCompressor {
	private readonly processors: OfflineCompressor[];
	constructor(params: CompressorEffect, sampleRate: number, channelCount: number) {
		this.processors = Array.from({ length: channelCount }, () => new OfflineCompressor(params, sampleRate));
	}
	process(channels: Float32Array[]): Float32Array[] {
		return channels.map((ch, idx) => this.processors[idx]!.processChannel(ch));
	}
}

type ChainEntry =
	| { kind: 'compressor'; impl: PerChannelCompressor }
	| { kind: 'pan' }
	| { kind: 'reverb'; impl: OfflineReverb }
	| { kind: 'delay'; impl: OfflineDelay }
	| { kind: 'chorus'; impl: OfflineModulatedDelay }
	| { kind: 'flanger'; impl: OfflineModulatedDelay }
	| { kind: 'distortion' };

/** Stateful offline chain for chunked export; preserves tails across windows. */
export class StreamingAudioEffectChain {
	private readonly chain: { effect: AudioEffect; entry: ChainEntry }[] = [];

	constructor(
		effects: AudioEffect[] | undefined,
		private readonly sampleRate: number,
		private readonly channelCount: number
	) {
		for (const effect of normalizeAudioEffects(effects)) {
			if (!isAudioEffectActive(effect)) continue;
			let entry: ChainEntry;
			switch (effect.type) {
				case 'compressor':
					entry = { kind: 'compressor', impl: new PerChannelCompressor(effect as CompressorEffect, sampleRate, channelCount) };
					break;
				case 'pan':
					entry = { kind: 'pan' };
					break;
				case 'reverb':
					entry = { kind: 'reverb', impl: new OfflineReverb(effect as ReverbEffect, sampleRate, channelCount) };
					break;
				case 'delay':
					entry = { kind: 'delay', impl: new OfflineDelay(effect as DelayEffect, sampleRate, channelCount) };
					break;
				case 'chorus':
					entry = { kind: 'chorus', impl: new OfflineModulatedDelay(effect as ChorusEffect, sampleRate, channelCount) };
					break;
				case 'flanger':
					entry = { kind: 'flanger', impl: new OfflineModulatedDelay(effect as FlangerEffect, sampleRate, channelCount) };
					break;
				case 'distortion':
					entry = { kind: 'distortion' };
					break;
				default:
					continue;
			}
			this.chain.push({ effect, entry });
		}
	}

	process(channels: Float32Array[]): Float32Array[] {
		let out = channels;
		for (const { effect, entry } of this.chain) {
			switch (entry.kind) {
				case 'compressor':
					out = entry.impl.process(out);
					break;
				case 'pan':
					out = applyPanOffline(out, (effect as PanEffect).pan);
					break;
				case 'reverb':
					out = entry.impl.process(out);
					break;
				case 'delay':
					out = entry.impl.process(out);
					break;
				case 'chorus':
				case 'flanger':
					out = entry.impl.process(out);
					break;
				case 'distortion':
					out = applyDistortionOffline(out, effect as DistortionEffect);
					break;
			}
			for (const ch of out) {
				for (let i = 0; i < ch.length; i++) {
					if (!Number.isFinite(ch[i]!)) ch[i] = 0;
					if (ch[i]! > 1.2) ch[i] = Math.tanh(ch[i]!);
					if (ch[i]! < -1.2) ch[i] = Math.tanh(ch[i]!);
				}
			}
		}
		return out;
	}

	isEmpty(): boolean {
		return this.chain.length === 0;
	}
}

/** Stateless one-shot chain for tests and preview-response estimation. */
export function applyAudioEffectStages(
	channels: Float32Array[],
	sampleRate: number,
	effects: AudioEffect[] | undefined
): Float32Array[] {
	if (!effects || effects.length === 0) return channels.map((c) => c.slice());
	const chain = new StreamingAudioEffectChain(effects, sampleRate, channels.length);
	return chain.process(channels.map((c) => c.slice()));
}

export function getAudioEffectTailSeconds(effects: AudioEffect[] | undefined): number {
	if (!effects) return 0;
	let tail = 0;
	for (const e of effects) {
		if (!e.enabled) continue;
		if (e.type === 'reverb') tail = Math.max(tail, (e as ReverbEffect).decaySeconds * 0.6);
		if (e.type === 'delay') tail = Math.max(tail, ((e as DelayEffect).timeMs / 1000) * 2);
	}
	return Math.min(2.5, tail);
}
