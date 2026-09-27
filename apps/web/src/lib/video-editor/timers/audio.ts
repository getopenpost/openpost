import { timerTiming } from './timer';
import type { MixEntry } from '../media/render-plan';
import type { TimelineItem, TimelineTrack } from '../project/types';
const TONE_SECONDS = 0.12;
const TONE_FREQUENCY = 880;

export function timerAudioEntries(
	item: TimelineItem,
	track: TimelineTrack,
	fps: number
): MixEntry[] {
	if (!item.timer?.warningSound) return [];
	const duration = timerTiming(item.timer, item.durationInFrames, fps).activeFrames / fps;
	const cues = (item.timer.finishHoldSeconds ?? 0) > 0 ? [3, 2, 1, 0] : [3, 2, 1];
	return cues
		.filter((seconds) => seconds <= duration)
		.map((seconds) => {
			const whenSeconds = item.from / fps + duration - seconds;
			return {
				itemId: `${item.id}/timer-${seconds}`,
				mediaId: '',
				toneFrequency: seconds === 0 ? 1320 : TONE_FREQUENCY,
				trackId: item.trackId,
				whenSeconds,
				sourceOffsetSeconds: 0,
				durationSeconds: Math.min(TONE_SECONDS, item.durationInFrames / fps - duration + seconds),
				playbackRate: 1,
				pitchShiftSemitones: 0,
				reversed: false,
				audioEqStages: [],
				audioEffects: [],
				transitionGainSpans: [],
				gainPoints: [{ whenSeconds, value: track.volume ?? 1 }],
				previewGainPoints: [{ whenSeconds, value: 1 }],
				mixerTrackGain: track.volume ?? 1
			};
		});
}

export function timerToneSample(seconds: number, frequency: number): number {
	if (seconds < 0 || seconds >= TONE_SECONDS) return 0;
	const envelope = Math.min(1, seconds / 0.005, (TONE_SECONDS - seconds) / 0.025);
	return Math.sin(seconds * Math.PI * 2 * frequency) * envelope * 0.2;
}

export function timerToneBlob(frequency: number): Blob {
	const rate = 48000;
	const samples = Math.ceil(TONE_SECONDS * rate);
	const data = new ArrayBuffer(44 + samples * 2);
	const view = new DataView(data);
	const write = (offset: number, text: string) => {
		for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
	};
	write(0, 'RIFF');
	view.setUint32(4, data.byteLength - 8, true);
	write(8, 'WAVE');
	write(12, 'fmt ');
	view.setUint32(16, 16, true);
	view.setUint16(20, 1, true);
	view.setUint16(22, 1, true);
	view.setUint32(24, rate, true);
	view.setUint32(28, rate * 2, true);
	view.setUint16(32, 2, true);
	view.setUint16(34, 16, true);
	write(36, 'data');
	view.setUint32(40, samples * 2, true);
	for (let i = 0; i < samples; i++)
		view.setInt16(44 + i * 2, Math.round(timerToneSample(i / rate, frequency) * 32767), true);
	return new Blob([data], { type: 'audio/wav' });
}
