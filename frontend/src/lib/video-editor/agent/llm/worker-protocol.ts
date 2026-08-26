export interface LlmWorkerLoadRequest {
	type: 'load';
}

export interface LlmWorkerGenerateRequest {
	type: 'generate';
	id: number;
	messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
	maxTokens: number;
	temperature: number;
	topP: number;
}

export interface LlmWorkerCancelRequest {
	type: 'cancel';
	id: number;
}

export interface LlmWorkerDisposeRequest {
	type: 'dispose';
}

export type LlmWorkerRequest =
	| LlmWorkerLoadRequest
	| LlmWorkerGenerateRequest
	| LlmWorkerCancelRequest
	| LlmWorkerDisposeRequest;

export interface LlmWorkerProgressMessage {
	type: 'progress';
	stage: string;
	percent: number;
}

export interface LlmWorkerReadyMessage {
	type: 'ready';
}

export interface LlmWorkerTokenMessage {
	type: 'token';
	id: number;
	delta: string;
}

export interface LlmWorkerResultMessage {
	type: 'result';
	id: number;
	text: string;
}

export interface LlmWorkerErrorMessage {
	type: 'error';
	id?: number;
	message: string;
}

export interface LlmWorkerDisposedMessage {
	type: 'disposed';
}

export type LlmWorkerResponse =
	| LlmWorkerProgressMessage
	| LlmWorkerReadyMessage
	| LlmWorkerTokenMessage
	| LlmWorkerResultMessage
	| LlmWorkerErrorMessage
	| LlmWorkerDisposedMessage;
