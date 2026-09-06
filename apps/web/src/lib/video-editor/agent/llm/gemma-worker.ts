import {
	AutoTokenizer,
	Gemma4ForConditionalGeneration,
	TextStreamer,
	InterruptableStoppingCriteria,
	StoppingCriteriaList,
	env
} from '@huggingface/transformers';
import { z } from 'zod';
import { parseLlmWorkerRequest, type LlmWorkerRequest } from './worker-protocol';
import type { JsonValue } from '../types';

const MODEL_ID = 'onnx-community/gemma-4-E4B-it-ONNX';

env.useBrowserCache = true;
env.allowLocalModels = false;

let tokenizer: Awaited<ReturnType<typeof AutoTokenizer.from_pretrained>> | null = null;
let model: Awaited<ReturnType<typeof Gemma4ForConditionalGeneration.from_pretrained>> | null = null;
let loading: Promise<void> | null = null;
let disposed = false;

const activeStops = new Map<number, InterruptableStoppingCriteria>();

function post(message: JsonValue): void {
	self.postMessage(message);
}

const errorSchema = z.instanceof(Error);

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
			loadedModel.dispose?.();
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
		const parsedError = errorSchema.safeParse(error);
		const message = parsedError.success ? parsedError.data.message : 'Unknown model load error';
		post({ type: 'error', message: `Model load failed: ${message}` });
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
		const generationOptions = {
			...inputs,
			max_new_tokens: request.maxTokens,
			do_sample: sample,
			streamer,
			stopping_criteria: stoppingCriteria
		};
		if (sample) {
			Object.assign(generationOptions, {
				temperature: request.temperature,
				top_p: request.topP
			});
		}
		const outputs = await model.generate(generationOptions);
		const promptLength = inputs.input_ids.dims.at(-1);
		const decoded = tokenizer.batch_decode(outputs.slice(null, [promptLength, null]), {
			skip_special_tokens: true
		});
		post({ type: 'result', id: request.id, text: (decoded[0] ?? '').trim() });
	} catch (error) {
		const parsedError = errorSchema.safeParse(error);
		post({
			type: 'error',
			id: request.id,
			message: parsedError.success ? parsedError.data.message : 'Unknown generation error'
		});
	} finally {
		activeStops.delete(request.id);
	}
}

function dispose(): void {
	disposed = true;
	for (const stop of activeStops.values()) stop.interrupt();
	activeStops.clear();
	model?.dispose?.();
	model = null;
	tokenizer = null;
	loading = null;
	post({ type: 'disposed' });
}

self.addEventListener('message', (event: MessageEvent<JsonValue>) => {
	const message = parseLlmWorkerRequest(event.data);
	if (!message) {
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
