export type LlmRole = 'system' | 'user' | 'assistant';

export interface LlmMessage {
	role: LlmRole;
	content: string;
}

export interface LlmLoadProgress {
	stage: string;
	percent: number;
}

export interface LlmGenerateOptions {
	maxTokens?: number;
	temperature?: number;
	topP?: number;
	signal?: AbortSignal;
	onToken?: (delta: string, text: string) => void;
}

export interface LlmAdapter {
	readonly id: string;
	readonly label: string;
	isSupported(): boolean;
	load(onProgress?: (progress: LlmLoadProgress) => void): Promise<void>;
	generate(messages: LlmMessage[], options?: LlmGenerateOptions): Promise<string>;
	dispose(): void;
}
