import { BeatAnalyzer } from './analyzer';

export interface BeatWorkerRequest {
	id: string;
	samples: Float32Array;
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
	const { id, samples, sampleRate, duration, config } = event.data;
	try {
		const analyzer = new BeatAnalyzer(config);
		const result = await analyzer.analyzeChannelData(samples, sampleRate, duration);
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
