export type TranscriptionModel =
	| 'parakeet-tdt-v3'
	| 'whisper-tiny'
	| 'whisper-base'
	| 'whisper-small'
	| 'whisper-large';

export type TranscriptionQuantization = 'hybrid' | 'fp32' | 'fp16' | 'q8' | 'q4';
export type TranscriptionEngine = 'whisper' | 'parakeet';

export interface TranscriptionSelection {
	model: TranscriptionModel;
	language?: string;
	quantization: TranscriptionQuantization;
}

export interface EngineTranscriptWord {
	text: string;
	start: number;
	end: number;
	confidence?: number;
}

export interface TranscriptSegment {
	text: string;
	start: number;
	end: number;
	words?: EngineTranscriptWord[];
}

export interface TranscribeProgress {
	stage: 'downloading' | 'preparing' | 'decoding' | 'transcribing';
	progress: number;
	receivedBytes?: number;
	totalBytes?: number;
	fromCache?: boolean;
	indeterminate?: boolean;
	restarted?: boolean;
}

export interface TranscribeRuntimeInfo {
	backend?: 'webgpu' | 'wasm';
	estimatedBytes?: number;
}

export interface TranscribeOptions {
	model?: TranscriptionModel;
	language?: string;
	quantization?: TranscriptionQuantization;
	/** Optional source window. The decoder skips media outside this range. */
	sourceStartSeconds?: number;
	sourceEndSeconds?: number;
	signal?: AbortSignal;
	onSegment?: (segment: TranscriptSegment) => void;
	onProgress?: (event: TranscribeProgress) => void;
	onRuntimeInfo?: (info: TranscribeRuntimeInfo) => void;
	onFallback?: (fallback: ResolvedTranscriptionEngine) => void;
}

export interface PCMChunk {
	samples: Float32Array;
	timestamp: number;
	final: boolean;
	totalDuration: number;
}

export type MainThreadMessage =
	| { type: 'ready' }
	| { type: 'done' }
	| { type: 'segment'; segment: TranscriptSegment }
	| { type: 'progress'; event: TranscribeProgress }
	| { type: 'runtime'; info: TranscribeRuntimeInfo }
	| { type: 'error'; message: string };

export type TranscriptionWorkerMessage =
	| { type: 'port'; port: MessagePort }
	| {
			type: 'init';
			modelId: string;
			language?: string;
			quantization?: TranscriptionQuantization;
	  }
	| { type: 'pause' }
	| { type: 'resume' };

export interface ResolvedTranscriptionEngine {
	engine: TranscriptionEngine;
	model: TranscriptionModel;
	fallbackReason?: 'language' | 'no-webgpu' | 'out-of-memory';
}

export const MODEL_IDS = {
	'parakeet-tdt-v3': 'Olicorne/parakeet-tdt-0.6b-v3-smoothquant-onnx',
	'whisper-tiny': 'onnx-community/whisper-tiny_timestamped',
	'whisper-base': 'onnx-community/whisper-base_timestamped',
	'whisper-small': 'onnx-community/whisper-small_timestamped',
	'whisper-large': 'onnx-community/whisper-large-v3-turbo_timestamped'
} satisfies Record<TranscriptionModel, string>;
