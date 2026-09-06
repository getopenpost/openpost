export type LocalGenerationStage = 'downloading' | 'preparing' | 'generating' | 'finalizing';

export interface LocalGenerationProgress {
	stage: LocalGenerationStage;
	message: string;
	progress: number | null;
	backend?: 'webgpu' | 'wasm';
	receivedBytes?: number;
	totalBytes?: number;
}

/** One explicit request to turn an existing text item into linked speech. */
export interface TextVoiceRequest {
	id: string;
	sourceTextItemId: string;
	text: string;
}

export interface GeneratedAudio {
	blob: Blob;
	file: File;
	duration: number;
	sampleRate: number;
}
