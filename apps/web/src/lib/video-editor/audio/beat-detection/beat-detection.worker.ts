import { BeatAnalyzer } from './analyzer';
import { mixChannelsSync } from '../channel-mix';

export interface BeatWorkerRequest {
	id: string;
	samples?: Float32Array;
	channels?: Float32Array[];
	sampleRate: number;
	duration: number;
	config?: Partial<import('./types').BeatDetectionConfig>;
}

export interface BeatWorkerResponse {
	id: string;
	ok: true;
	result: import('./types').BeatAnalysisResult;
}

export interface BeatWorkerError {
	id: string;
	ok: false;
	error: string;
}

self.onmessage = async (event: MessageEvent<BeatWorkerRequest>) => {
	const { id, samples, channels, sampleRate, duration, config } = event.data;
	try {
		let mono: Float32Array;
		if (channels && channels.length > 0) mono = mixChannelsSync(channels);
		else if (samples) mono = samples;
		else mono = new Float32Array(0);
		const analyzer = new BeatAnalyzer(config);
		const result = await analyzer.analyzeChannelData(mono, sampleRate, duration);
		const response: BeatWorkerResponse = { id, ok: true, result };
		self.postMessage(response);
	} catch (error) {
		const response: BeatWorkerError = {
			id,
			ok: false,
			error: error instanceof Error ? error.message : String(error)
		};
		self.postMessage(response);
	}
};
