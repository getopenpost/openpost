import { AudioMixerRouting, type StereoMeterLevels } from './audio-mixer-routing';
import { getSharedPreviewAudioContext } from './preview-audio-graph';

let routing: AudioMixerRouting | null = null;
const desiredTrackGains = new Map<string, number>();

function ensureRouting(): AudioMixerRouting | null {
	const context = getSharedPreviewAudioContext();
	if (!context) return null;
	if (routing?.context === context) return routing;
	routing?.dispose();
	routing = new AudioMixerRouting(context);
	return routing;
}

export function attachAudioSourceToMixer(source: AudioNode, trackId: string): () => void {
	const current = ensureRouting();
	if (!current) return () => undefined;
	const detach = current.attach(source, trackId);
	current.setTrackPreviewGain(trackId, desiredTrackGains.get(trackId) ?? 1);
	return detach;
}

export function setMixerMaster(db: number, muted: boolean): void {
	ensureRouting()?.setMaster(db, muted);
}

export function setMixerTrackPreviewGain(trackId: string, gain: number): void {
	const safeGain = Math.max(0, Number.isFinite(gain) ? gain : 1);
	desiredTrackGains.set(trackId, safeGain);
	routing?.setTrackPreviewGain(trackId, safeGain);
}

const SILENCE: StereoMeterLevels = { left: 0, right: 0, peakLeft: 0, peakRight: 0 };

export function readMixerMasterLevels(): StereoMeterLevels {
	return routing?.readMasterLevels() ?? SILENCE;
}

export function readMixerTrackLevels(trackId: string): StereoMeterLevels {
	return routing?.readTrackLevels(trackId) ?? SILENCE;
}

export function activeMixerTrackIds(): string[] {
	return routing?.activeTrackIds() ?? [];
}

export function disposeAudioMixer(): void {
	routing?.dispose();
	routing = null;
	desiredTrackGains.clear();
}
