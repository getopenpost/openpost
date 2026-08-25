/**
 * Real-time meter service that taps the shared preview AudioContext.
 * Uses a master Gain -> Analyser chain; per-track analysers branch off
 * track gains when available. Falls back to silence when context missing.
 * Updates DOM imperatively at rAF cadence to avoid Svelte churn.
 */

import { getSharedPreviewAudioContext } from './preview-audio-graph';

export interface MeterLevels {
	left: number;
	right: number;
	peakLeft: number;
	peakRight: number;
	clipping: boolean;
}

const ANALYSER_FFT = 2048;
const HOLD_MS = 350;
const DECAY_PER_S = 0.85;
const ATTACK_S = 0.02;

let masterGain: GainNode | null = null;
let masterAnalyser: AnalyserNode | null = null;
let masterData: Float32Array | null = null;

const trackNodes = new Map<string, { gain: GainNode; analyser: AnalyserNode; data: Float32Array }>();

function ensureMaster(): { gain: GainNode; analyser: AnalyserNode; data: Float32Array } | null {
	const ctx = getSharedPreviewAudioContext();
	if (!ctx) return null;
	if (masterGain && masterAnalyser && masterData && masterGain.context === ctx) {
		return { gain: masterGain, analyser: masterAnalyser, data: masterData };
	}
	try {
		masterGain = ctx.createGain();
		masterAnalyser = ctx.createAnalyser();
		masterAnalyser.fftSize = ANALYSER_FFT;
		masterAnalyser.smoothingTimeConstant = 0;
		masterData = new Float32Array(masterAnalyser.frequencyBinCount);
		masterGain.connect(masterAnalyser);
		masterAnalyser.connect(ctx.destination);
		return { gain: masterGain, analyser: masterAnalyser, data: masterData };
	} catch {
		return null;
	}
}

export function getMasterMeterNode(): GainNode | null {
	const nodes = ensureMaster();
	return nodes?.gain ?? null;
}

export function ensureTrackMeter(
	trackId: string
): { gain: GainNode; analyser: AnalyserNode; data: Float32Array } | null {
	const ctx = getSharedPreviewAudioContext();
	if (!ctx) return null;
	const existing = trackNodes.get(trackId);
	if (existing && existing.gain.context === ctx) return existing;
	try {
		const gain = ctx.createGain();
		const analyser = ctx.createAnalyser();
		analyser.fftSize = ANALYSER_FFT;
		analyser.smoothingTimeConstant = 0;
		const data = new Float32Array(analyser.frequencyBinCount);
		gain.connect(analyser);
		const master = ensureMaster();
		if (master) analyser.connect(master.gain);
		trackNodes.set(trackId, { gain, analyser, data });
		return { gain, analyser, data };
	} catch {
		return null;
	}
}

export function removeTrackMeter(trackId: string): void {
	const entry = trackNodes.get(trackId);
	if (!entry) return;
	try {
		entry.gain.disconnect();
		entry.analyser.disconnect();
	} catch {
		// ignore
	}
	trackNodes.delete(trackId);
}

export function clearAllTrackMeters(): void {
	for (const id of [...trackNodes.keys()]) removeTrackMeter(id);
}

function computeLevelsFromAnalyser(analyser: AnalyserNode, data: Float32Array): { level: number; peak: number } {
	try {
		analyser.getFloatTimeDomainData(data);
	} catch {
		return { level: 0, peak: 0 };
	}
	let peak = 0;
	let sum = 0;
	for (let i = 0; i < data.length; i++) {
		const v = Math.abs(data[i] ?? 0);
		if (v > peak) peak = v;
		sum += v * v;
	}
	const rms = Math.sqrt(sum / Math.max(1, data.length));
	// Use peak as primary, blended with RMS for musicality.
	const level = Math.max(rms * 1.2, peak * 0.9);
	return { level, peak };
}

export interface MeterState {
	displayLeft: number;
	displayRight: number;
	peakLeft: number;
	peakRight: number;
	peakHoldLeftMs: number;
	peakHoldRightMs: number;
	clipping: boolean;
	clipHoldMs: number;
	lastTs: number;
}

export function createMeterState(): MeterState {
	return {
		displayLeft: 0,
		displayRight: 0,
		peakLeft: 0,
		peakRight: 0,
		peakHoldLeftMs: 0,
		peakHoldRightMs: 0,
		clipping: false,
		clipHoldMs: 0,
		lastTs: 0
	};
}

function updateChannel(
	channel: { display: number; peak: number; holdMs: number },
	target: number,
	dt: number
): void {
	if (target >= channel.display) {
		const attack = 1 - Math.exp(-dt / ATTACK_S);
		channel.display += (target - channel.display) * attack;
	} else {
		// decay
		const decay = DECAY_PER_S;
		channel.display = Math.max(target, channel.display - decay * dt * 1.5);
		if (channel.display < 0.0005) channel.display = target;
	}
	if (channel.display >= channel.peak) {
		channel.peak = channel.display;
		channel.holdMs = HOLD_MS;
	} else if (channel.holdMs > 0) {
		channel.holdMs = Math.max(0, channel.holdMs - dt * 1000);
	} else {
		channel.peak = Math.max(channel.display, channel.peak - decay * dt * 0.9);
	}
}

export function tickMeterState(
	state: MeterState,
	targetLeft: number,
	targetRight: number,
	now: number
): void {
	const dt = state.lastTs > 0 ? Math.min(0.05, (now - state.lastTs) / 1000) : 1 / 60;
	state.lastTs = now;

	const left = { display: state.displayLeft, peak: state.peakLeft, holdMs: state.peakHoldLeftMs };
	const right = { display: state.displayRight, peak: state.peakRight, holdMs: state.peakHoldRightMs };

	updateChannel(left, targetLeft, dt);
	updateChannel(right, targetRight, dt);

	state.displayLeft = left.display;
	state.displayRight = left.display === 0 ? 0 : left.display; // placeholder keep
	state.displayLeft = left.display;
	state.displayRight = right.display;
	state.peakLeft = left.peak;
	state.peakRight = right.peak;
	state.peakHoldLeftMs = left.holdMs;
	state.peakHoldRightMs = right.holdMs;

	const isClipping = targetLeft > 0.99 || targetRight > 0.99 || left.peak > 0.99 || right.peak > 0.99;
	if (isClipping) {
		state.clipping = true;
		state.clipHoldMs = 900;
	} else if (state.clipHoldMs > 0) {
		state.clipHoldMs = Math.max(0, state.clipHoldMs - dt * 1000);
		if (state.clipHoldMs === 0) state.clipping = false;
	} else {
		state.clipping = false;
	}
}

export function readMasterLevels(): { left: number; right: number } {
	const master = ensureMaster();
	if (!master) return { left: 0, right: 0 };
	const { analyser, data } = master;
	const { level } = computeLevelsFromAnalyser(analyser, data);
	// Stereo: we only have one analyser (mono mix), duplicate to both.
	return { left: level, right: level };
}

export function readTrackLevels(trackId: string): { left: number; right: number } {
	const track = trackNodes.get(trackId);
	if (!track) return { left: 0, right: 0 };
	const { level } = computeLevelsFromAnalyser(track.analyser, track.data);
	return { left: level, right: level };
}

export function disconnectMeterService(): void {
	try {
		masterGain?.disconnect();
		masterAnalyser?.disconnect();
	} catch {
		// ignore
	}
	masterGain = null;
	masterAnalyser = null;
	masterData = null;
	clearAllTrackMeters();
}
