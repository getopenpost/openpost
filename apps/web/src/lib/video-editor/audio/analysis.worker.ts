import { decodeAudioChunksForAnalysis } from './analysis-decoder';
import { detectSilentRanges, applySilenceTiming, type AudioSilenceRange } from './audio-silence';
import { intersectQuietRanges, nonSpeechRanges, SPEECH_FRAME_SAMPLES } from './speech-detection';
import { resampleTo16kHz } from '../transcript/engine/lib/resampler';
import type { AudioAnalysisRequest, AudioAnalysisResponse } from './analysis-types';

function reply(message: AudioAnalysisResponse): void {
	self.postMessage(message);
}
const LEVEL_WINDOW_MS = 20;

async function analyzeTrack(
	blob: Blob,
	options: AudioAnalysisRequest['options'],
	audioTrackIndex: number | undefined,
	onProgress: (progress: number) => void
): Promise<AudioSilenceRange[]> {
	const levels: number[] = [];
	const probabilities: number[][] = [];
	let duration = 0;
	const models: Array<import('@ricky0123/vad-web/dist/models/common').Model> = [];
	let createModel:
		| (() => Promise<import('@ricky0123/vad-web/dist/models/common').Model>)
		| undefined;
	if (options.mode === 'speech') {
		const [{ Silero }, { getOrt }, { default: modelUrl }] = await Promise.all([
			import('@ricky0123/vad-web/dist/models/silero'),
			import('../media/processing/ort-runtime'),
			import('@ricky0123/vad-web/dist/silero_vad_v5.onnx?url')
		]);
		const response = await fetch(modelUrl);
		if (!response.ok) throw new Error(`Speech model download failed (${response.status})`);
		const weights = await response.arrayBuffer();
		const ort = await getOrt();
		createModel = () => Silero.new(ort, async () => weights);
	}
	try {
		for await (const chunk of decodeAudioChunksForAnalysis(blob, audioTrackIndex)) {
			const { audio, start } = chunk;
			duration = chunk.duration;
			const channels = Array.from({ length: audio.numberOfChannels }, (_, index) =>
				audio.getChannelData(index)
			);
			if (createModel) {
				for (let channel = 0; channel < channels.length; channel += 1) {
					const model = models[channel] ?? (models[channel] = await createModel());
					const values = probabilities[channel] ?? (probabilities[channel] = []);
					const samples = resampleTo16kHz(channels[channel]!, audio.sampleRate);
					for (let offset = 0; offset < samples.length; offset += SPEECH_FRAME_SAMPLES) {
						const frame = new Float32Array(SPEECH_FRAME_SAMPLES);
						frame.set(samples.subarray(offset, offset + SPEECH_FRAME_SAMPLES));
						values.push((await model.process(frame)).isSpeech);
					}
				}
			} else {
				const windowSamples = Math.max(1, Math.round((audio.sampleRate * LEVEL_WINDOW_MS) / 1000));
				for (let offset = 0; offset < audio.length; offset += windowSamples) {
					const end = Math.min(audio.length, offset + windowSamples);
					let maxRms = 0;
					for (const channel of channels) {
						let power = 0;
						for (let sample = offset; sample < end; sample += 1)
							power += (channel[sample] ?? 0) ** 2;
						maxRms = Math.max(maxRms, Math.sqrt(power / (end - offset)));
					}
					levels.push(maxRms);
				}
			}
			onProgress(Math.min(0.99, (start + audio.duration) / duration));
		}
		if (createModel) {
			return probabilities.reduce(
				(ranges, values) =>
					intersectQuietRanges(
						ranges,
						nonSpeechRanges(new Float32Array(values), duration, {
							...options,
							minSilenceMs: 1,
							paddingStartMs: 0,
							paddingEndMs: 0
						})
					),
				[{ start: 0, end: duration }]
			);
		}
		const envelope = new Float32Array(levels);
		return detectSilentRanges(
			{
				duration,
				length: envelope.length,
				sampleRate: 1000 / LEVEL_WINDOW_MS,
				numberOfChannels: 1,
				getChannelData: () => envelope
			},
			{ ...options, windowMs: LEVEL_WINDOW_MS, minSilenceMs: 1, paddingStartMs: 0, paddingEndMs: 0 }
		)
			.map((range) => ({ start: range.start, end: Math.min(duration, range.end) }))
			.filter((range) => range.end > range.start);
	} finally {
		await Promise.all(models.map((model) => model.release()));
	}
}

self.onmessage = async (event: MessageEvent<AudioAnalysisRequest>) => {
	try {
		const { blob, options } = event.data;
		reply({ type: 'progress', progress: 0 });
		const tracks = options.audioTrackIndices ?? [undefined];
		let ranges: AudioSilenceRange[] | undefined;
		for (let index = 0; index < tracks.length; index += 1) {
			const detected = await analyzeTrack(blob, options, tracks[index], (progress) =>
				reply({ type: 'progress', progress: (index + progress) / tracks.length })
			);
			ranges = ranges ? intersectQuietRanges(ranges, detected) : detected;
		}
		reply({ type: 'result', ranges: applySilenceTiming(ranges ?? [], options) });
	} catch (error) {
		reply({ type: 'error', message: error instanceof Error ? error.message : String(error) });
	}
};
