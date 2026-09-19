import type { AudioSilenceDetectionOptions, AudioSilenceRange } from './audio-silence';

export interface AudioAnalysisOptions extends AudioSilenceDetectionOptions {
	mode: 'signal' | 'speech';
	audioTrackIndices?: number[];
	signal?: AbortSignal;
	onProgress?: (progress: number) => void;
}
export type AudioAnalysisRequest = {
	blob: Blob;
	options: Omit<AudioAnalysisOptions, 'signal' | 'onProgress'>;
};
export type AudioAnalysisResponse =
	| { type: 'progress'; progress: number }
	| { type: 'result'; ranges: AudioSilenceRange[] }
	| { type: 'error'; message: string };
