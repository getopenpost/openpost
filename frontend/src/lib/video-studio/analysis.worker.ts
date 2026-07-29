/// <reference lib="webworker" />

import { env, pipeline } from '@huggingface/transformers';
import * as ort from 'onnxruntime-web';

interface TranscriptChunk {
	text: string;
	timestamp: [number | null, number | null];
}

interface TranscriptOutput {
	text?: string;
	chunks?: TranscriptChunk[];
}

type Transcriber = (
	audio: Float32Array,
	options: Record<string, unknown>
) => Promise<TranscriptOutput>;

interface SpeechRegion {
	start_sample: number;
	end_sample: number;
}

let transcriber: Transcriber | undefined;
let transcriberKey = '';
let vadSession: ort.InferenceSession | undefined;
let vadState = new ort.Tensor('float32', new Float32Array(2 * 128), [2, 1, 128]);
let vadSampleOffset = 0;
let vadSpeechStart: number | undefined;
let vadRegions: SpeechRegion[] = [];
let vadSilenceSamples = 0;

self.onmessage = (event: MessageEvent<Record<string, unknown>>) => {
	void handleMessage(event.data).catch((cause) => {
		self.postMessage({
			id: event.data.id,
			type: 'error',
			message: cause instanceof Error ? cause.message : 'Local analysis failed.'
		});
	});
};

async function handleMessage(message: Record<string, unknown>): Promise<void> {
	const id = String(message.id ?? '');
	switch (message.type) {
		case 'transcribe': {
			const audio = message.audio;
			if (!(audio instanceof Float32Array)) throw new Error('Transcription audio is invalid.');
			const pipe = await loadTranscriber(
				String(message.model_base_url ?? ''),
				String(message.model_path ?? ''),
				message.device === 'webgpu' ? 'webgpu' : 'wasm',
				id
			);
			const output = await pipe(audio, {
				return_timestamps: 'word',
				language: message.language === 'auto' ? undefined : String(message.language ?? ''),
				task: 'transcribe'
			});
			self.postMessage({ id, type: 'transcript', output });
			break;
		}
		case 'vad-start': {
			vadSession = await ort.InferenceSession.create(String(message.model_url ?? ''), {
				executionProviders: ['wasm'],
				graphOptimizationLevel: 'all'
			});
			vadState = new ort.Tensor('float32', new Float32Array(2 * 128), [2, 1, 128]);
			vadSampleOffset = 0;
			vadSpeechStart = undefined;
			vadRegions = [];
			vadSilenceSamples = 0;
			self.postMessage({ id, type: 'vad-ready' });
			break;
		}
		case 'vad-chunk': {
			const audio = message.audio;
			if (!(audio instanceof Float32Array) || !vadSession) {
				throw new Error('Voice analysis is not ready.');
			}
			await runVAD(audio);
			self.postMessage({ id, type: 'vad-progress', processed_samples: vadSampleOffset });
			break;
		}
		case 'vad-end': {
			if (vadSpeechStart !== undefined) {
				vadRegions.push({ start_sample: vadSpeechStart, end_sample: vadSampleOffset });
			}
			self.postMessage({ id, type: 'vad-result', regions: vadRegions });
			vadSession = undefined;
			break;
		}
	}
}

async function loadTranscriber(
	modelBaseURL: string,
	modelPath: string,
	device: 'webgpu' | 'wasm',
	requestID: string
): Promise<Transcriber> {
	const key = `${modelBaseURL}:${modelPath}:${device}`;
	if (transcriber && transcriberKey === key) return transcriber;
	env.allowLocalModels = true;
	env.allowRemoteModels = false;
	env.useBrowserCache = true;
	env.localModelPath = `${modelBaseURL.replace(/\/$/u, '')}/`;
	try {
		transcriber = (await pipeline('automatic-speech-recognition', modelPath, {
			device,
			dtype: 'q4',
			progress_callback: (progress: unknown) =>
				self.postMessage({ id: requestID, type: 'model-progress', progress })
		})) as unknown as Transcriber;
	} catch (cause) {
		if (device !== 'webgpu') throw cause;
		transcriber = (await pipeline('automatic-speech-recognition', modelPath, {
			device: 'wasm',
			dtype: 'q4',
			progress_callback: (progress: unknown) =>
				self.postMessage({ id: requestID, type: 'model-progress', progress })
		})) as unknown as Transcriber;
		self.postMessage({ id: requestID, type: 'device-fallback', device: 'wasm' });
	}
	transcriberKey = key;
	return transcriber;
}

async function runVAD(audio: Float32Array): Promise<void> {
	if (!vadSession) return;
	const windowSize = 512;
	const releaseSamples = Math.round(0.25 * 16_000);
	for (let offset = 0; offset < audio.length; offset += windowSize) {
		const window = new Float32Array(windowSize);
		window.set(audio.subarray(offset, Math.min(audio.length, offset + windowSize)));
		const result = await vadSession.run({
			input: new ort.Tensor('float32', window, [1, windowSize]),
			state: vadState,
			sr: new ort.Tensor('int64', BigInt64Array.from([16_000n]), [1])
		});
		const probability = Number(result.output?.data[0] ?? 0);
		const nextState = result.stateN;
		if (nextState) vadState = nextState;
		if (probability >= 0.5) {
			vadSpeechStart ??= vadSampleOffset;
			vadSilenceSamples = 0;
		} else if (vadSpeechStart !== undefined) {
			vadSilenceSamples += windowSize;
			if (vadSilenceSamples >= releaseSamples) {
				vadRegions.push({
					start_sample: vadSpeechStart,
					end_sample: Math.max(vadSpeechStart, vadSampleOffset - vadSilenceSamples + windowSize)
				});
				vadSpeechStart = undefined;
				vadSilenceSamples = 0;
			}
		}
		vadSampleOffset += Math.min(windowSize, audio.length - offset);
	}
}

export {};
