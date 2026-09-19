import {
	detectSilentRanges,
	type AudioSilenceDetectionOptions,
	type AudioSilenceRange
} from './audio-silence';

export const SPEECH_FRAME_SAMPLES = 512;
export const SPEECH_SAMPLE_RATE = 16_000;

/** Apply the same gap length, hysteresis and breathing room to voice probabilities. */
export function nonSpeechRanges(
	probabilities: Float32Array,
	duration: number,
	options: AudioSilenceDetectionOptions = {}
): AudioSilenceRange[] {
	const sampleRate = SPEECH_SAMPLE_RATE / SPEECH_FRAME_SAMPLES;
	return detectSilentRanges(
		{
			length: probabilities.length,
			duration,
			sampleRate,
			numberOfChannels: 1,
			getChannelData: () => probabilities
		},
		{
			minSilenceMs: options.minSilenceMs,
			minAudioMs: 80,
			paddingStartMs: options.paddingStartMs,
			paddingEndMs: options.paddingEndMs,
			paddingMs: options.paddingMs,
			windowMs: 1000 / sampleRate,
			silenceThresholdDb: 20 * Math.log10(0.35),
			audioThresholdDb: 20 * Math.log10(0.5)
		}
	)
		.map((range) => ({
			start: range.start,
			end: Math.min(duration, range.end)
		}))
		.filter((range) => range.end > range.start);
}

/** Keep speech from any channel, including opposite-phase stereo. */
export function intersectQuietRanges(
	left: AudioSilenceRange[],
	right: AudioSilenceRange[]
): AudioSilenceRange[] {
	const result: AudioSilenceRange[] = [];
	let a = 0;
	let b = 0;
	while (a < left.length && b < right.length) {
		const start = Math.max(left[a]!.start, right[b]!.start);
		const end = Math.min(left[a]!.end, right[b]!.end);
		if (end > start) result.push({ start, end });
		if (left[a]!.end < right[b]!.end) a += 1;
		else b += 1;
	}
	return result;
}
