import {
	AutoTokenizer,
	Gemma4ForConditionalGeneration,
	TextStreamer,
	InterruptableStoppingCriteria,
	StoppingCriteriaList,
	env
} from '@huggingface/transformers';
import type { LlmWorkerRequest } from './worker-protocol';

const MODEL_ID = 'onnx-community/gemma-4-E4B-it-ONNX';

env.useBrowserCache = true;
env.allowLocalModels = false;

let tokenizer: Awaited<ReturnType<typeof AutoTokenizer.from_pretrained>> | null = null;
let model: Awaited<ReturnType<typeof Gemma4ForConditionalGeneration.from_pretrained>> | null = null;
let loading: Promise<void> | null = null;
let disposed = false;

const activeStops = new Map<number, InterruptableStoppingCriteria>();

function post(message: Record<string, unknown>): void {
	self.postMessage(message);
}

const VALID_ROLES = new Set(['system', 'user', 'assistant']);

export function isValidRequest(value: unknown): value is LlmWorkerRequest {
	if (!value || typeof value !== 'object') return false;
	const record = value as Record<string, unknown>;
	if (record.type === 'load' || record.type === 'dispose') return true;
	if (record.type === 'cancel') {
		return (
			typeof record.id === 'number' &&
			Number.isInteger(record.id) &&
			record.id > 0 &&
			Number.isFinite(record.id)
		);
	}
	if (record.type === 'generate') {
		if (
			typeof record.id !== 'number' ||
			!Number.isInteger(record.id) ||
			record.id <= 0 ||
			!Number.isFinite(record.id)
		)
			return false;
		if (
			!Array.isArray(record.messages) ||
			record.messages.length === 0 ||
			record.messages.length > 32
		)
			return false;
		if (
			typeof record.maxTokens !== 'number' ||
			!Number.isInteger(record.maxTokens) ||
			!Number.isFinite(record.maxTokens) ||
			record.maxTokens <= 0 ||
			record.maxTokens > 2048
		)
			return false;
		if (
			typeof record.temperature !== 'number' ||
			!Number.isFinite(record.temperature) ||
			record.temperature < 0 ||
			record.temperature > 2
		)
			return false;
		if (
			typeof record.topP !== 'number' ||
			!Number.isFinite(record.topP) ||
			record.topP < 0 ||
			record.topP > 1
		)
			return false;
		for (const entry of record.messages) {
			if (entry === null || typeof entry !== 'object') return false;
			const message = entry as Record<string, unknown>;
			if (typeof message.role !== 'string' || !VALID_ROLES.has(message.role)) return false;
			if (typeof message.content !== 'string' || message.content.length > 8000) return false;
		}
		return true;
	}
	return false;
}

async function ensureLoaded(): Promise<void> {
	if (model && tokenizer) {
		post({ type: 'ready' });
		return;
	}
	if (loading) return loading;
	disposed = false;
	loading = (async () => {
		post({ type: 'progress', stage: 'loading-model', percent: 5 });
		let lastPct = 5;
		const loadedTokenizer = await AutoTokenizer.from_pretrained(MODEL_ID);
		if (disposed) return;
		const loadedModel = await Gemma4ForConditionalGeneration.from_pretrained(MODEL_ID, {
			dtype: 'q4f16',
			device: 'webgpu',
			progress_callback: (info: { status?: string; total?: number; loaded?: number }) => {
				if (info.status === 'progress' && info.total && info.loaded) {
					const pct = 5 + (info.loaded / info.total) * 90;
					if (pct - lastPct > 2) {
						lastPct = pct;
						post({ type: 'progress', stage: 'loading-model', percent: Math.round(pct) });
					}
				}
			}
		});
		if (disposed) {
			if (typeof loadedModel.dispose === 'function') loadedModel.dispose();
			return;
		}
		tokenizer = loadedTokenizer;
		model = loadedModel;
		post({ type: 'progress', stage: 'ready', percent: 100 });
		post({ type: 'ready' });
	})();
	try {
		await loading;
	} catch (error) {
		post({ type: 'error', message: `Model load failed: ${(error as Error).message}` });
	} finally {
		loading = null;
	}
}

async function generate(request: Extract<LlmWorkerRequest, { type: 'generate' }>): Promise<void> {
	if (!model || !tokenizer) {
		post({ type: 'error', id: request.id, message: 'Model not loaded' });
		return;
	}
	const stop = new InterruptableStoppingCriteria();
	activeStops.set(request.id, stop);
	try {
		const inputs = tokenizer.apply_chat_template(request.messages, {
			add_generation_prompt: true,
			return_dict: true
		});
		const streamer = new TextStreamer(tokenizer, {
			skip_prompt: true,
			skip_special_tokens: true,
			callback_function: (delta: string) => {
				if (delta) post({ type: 'token', id: request.id, delta });
			}
		});
		const stoppingCriteria = new StoppingCriteriaList();
		stoppingCriteria.push(stop);
		const sample = request.temperature > 0;
		const outputs = await model.generate({
			...inputs,
			max_new_tokens: request.maxTokens,
			do_sample: sample,
			...(sample ? { temperature: request.temperature, top_p: request.topP } : {}),
			streamer,
			stopping_criteria: stoppingCriteria
		});
		const promptLength = inputs.input_ids.dims.at(-1);
		const decoded = tokenizer.batch_decode(outputs.slice(null, [promptLength, null]), {
			skip_special_tokens: true
		});
		post({ type: 'result', id: request.id, text: (decoded[0] ?? '').trim() });
	} catch (error) {
		post({ type: 'error', id: request.id, message: (error as Error).message });
	} finally {
		activeStops.delete(request.id);
	}
}

function dispose(): void {
	disposed = true;
	for (const stop of activeStops.values()) stop.interrupt();
	activeStops.clear();
	if (model && typeof model.dispose === 'function') model.dispose();
	model = null;
	tokenizer = null;
	loading = null;
	post({ type: 'disposed' });
}

if (typeof self !== 'undefined') {
	self.addEventListener('message', (event: MessageEvent<unknown>) => {
		const message = event.data;
		if (!isValidRequest(message)) {
			post({ type: 'error', message: 'Invalid worker request' });
			return;
		}
		switch (message.type) {
			case 'load':
				void ensureLoaded();
				break;
			case 'generate':
				void generate(message);
				break;
			case 'cancel':
				activeStops.get(message.id)?.interrupt();
				break;
			case 'dispose':
				dispose();
				break;
		}
	});
}
