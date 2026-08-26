import type { LlmWorkerRequest } from './worker-protocol';

const MODEL_ID = 'onnx-community/gemma-3n-E2B-it-ONNX';

type TransformersModule = typeof import('@huggingface/transformers');

let transformersPromise: Promise<TransformersModule> | null = null;
function loadTransformers(): Promise<TransformersModule> {
	if (!transformersPromise) transformersPromise = import('@huggingface/transformers');
	return transformersPromise;
}

let tokenizer: unknown = null;
let model: unknown = null;
let loading: Promise<void> | null = null;
let disposed = false;

const activeStops = new Map<number, { interrupt: () => void }>();

function post(message: Record<string, unknown>): void {
	(self as unknown as Worker).postMessage(message);
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
		const transformers = await loadTransformers();
		transformers.env.useBrowserCache = true;
		transformers.env.allowLocalModels = false;

		const loadedTokenizer = await transformers.AutoTokenizer.from_pretrained(MODEL_ID);
		if (disposed) return;

		const loadedModel = await transformers.Gemma3nForConditionalGeneration.from_pretrained(
			MODEL_ID,
			{
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
			} as unknown as Record<string, unknown>
		);
		if (disposed) {
			const maybeDispose = loadedModel as { dispose?: () => void };
			maybeDispose.dispose?.();
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
		const message = error instanceof Error ? error.message : String(error);
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
	const transformers = await loadTransformers();
	const typedTokenizer = tokenizer as {
		apply_chat_template: (
			messages: unknown,
			opts: Record<string, unknown>
		) => { input_ids: { dims: number[] } } & Record<string, unknown>;
		batch_decode: (ids: unknown, opts: Record<string, unknown>) => string[];
	};
	const typedModel = model as {
		generate: (inputs: Record<string, unknown>) => Promise<unknown>;
	};
	const stop = new transformers.InterruptableStoppingCriteria();
	activeStops.set(request.id, stop);
	try {
		const inputs = typedTokenizer.apply_chat_template(request.messages, {
			add_generation_prompt: true,
			return_dict: true
		}) as Record<string, unknown> & { input_ids: { dims: number[] } };
		const streamer = new transformers.TextStreamer(typedTokenizer as never, {
			skip_prompt: true,
			skip_special_tokens: true,
			callback_function: (delta: string) => {
				if (delta) post({ type: 'token', id: request.id, delta });
			}
		});
		const stoppingCriteria = new transformers.StoppingCriteriaList();
		stoppingCriteria.push(stop);
		const sample = request.temperature > 0;
		const outputs = (await typedModel.generate({
			...inputs,
			max_new_tokens: request.maxTokens,
			do_sample: sample,
			...(sample ? { temperature: request.temperature, top_p: request.topP } : {}),
			streamer,
			stopping_criteria: stoppingCriteria
		})) as { slice: (a: unknown, b: unknown) => unknown };
		const promptLength = (inputs.input_ids as { dims: number[] }).dims.at(-1) ?? 0;
		const decoded = typedTokenizer.batch_decode(outputs.slice(null, [promptLength, null]), {
			skip_special_tokens: true
		});
		post({ type: 'result', id: request.id, text: (decoded[0] ?? '').trim() });
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		post({ type: 'error', id: request.id, message });
	} finally {
		activeStops.delete(request.id);
	}
}

function dispose(): void {
	disposed = true;
	for (const stop of activeStops.values()) stop.interrupt();
	activeStops.clear();
	const maybeDispose = model as { dispose?: () => void } | null;
	maybeDispose?.dispose?.();
	model = null;
	tokenizer = null;
	loading = null;
	post({ type: 'disposed' });
}

function isValidRequest(value: unknown): value is LlmWorkerRequest {
	if (!value || typeof value !== 'object') return false;
	const record = value as Record<string, unknown>;
	if (record.type === 'load' || record.type === 'dispose') return true;
	if (record.type === 'cancel') return typeof record.id === 'number';
	if (record.type === 'generate')
		return (
			typeof record.id === 'number' &&
			Array.isArray(record.messages) &&
			typeof record.maxTokens === 'number'
		);
	return false;
}

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
