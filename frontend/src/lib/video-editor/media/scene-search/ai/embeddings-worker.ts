// Ported from FreeCut (MIT).
/**
 * Web Worker for sentence-embedding generation using Xenova/all-MiniLM-L6-v2.
 *
 * The model is quantized (~22 MB) and runs via `pipeline('feature-extraction')`
 * from @huggingface/transformers. Loaded lazily on first init, cached in the
 * browser after download.
 *
 * Messages:
 *   → { type: 'init' }                      - preload model
 *   → { type: 'embed', id, texts: string[] } - batch embed
 *   → { type: 'dispose' }                    - release model
 *   ← { type: 'ready', dim: number }         - model loaded; embedding dimension
 *   ← { type: 'progress', percent: number }  - model download progress
 *   ← { type: 'embeddings', id, vectors: Float32Array[] } - batch result
 *   ← { type: 'error', id?, message }        - error
 */

import { pipeline, env, type FeatureExtractionPipeline } from '@huggingface/transformers';

const MODEL_ID = 'Xenova/all-MiniLM-L6-v2';

env.useBrowserCache = true;
env.allowLocalModels = false;
if (!globalThis.crossOriginIsolated && env.backends.onnx.wasm) {
	env.backends.onnx.wasm.numThreads = 1;
}

let extractor: FeatureExtractionPipeline | null = null;
let loading = false;
let disposed = false;
let loadGeneration = 0;
let embeddingDim = 384;

type EmbeddingsReadyMessage = { type: 'ready'; dim: number };
type EmbeddingsProgressMessage = { type: 'progress'; percent: number };
type EmbeddingsResultMessage = { type: 'embeddings'; id: number; vectors: Float32Array[] };
type EmbeddingsErrorMessage = { type: 'error'; id?: number; message: string };
type EmbeddingsOutboundMessage =
	| EmbeddingsReadyMessage
	| EmbeddingsProgressMessage
	| EmbeddingsResultMessage
	| EmbeddingsErrorMessage;

type EmbeddingsInboundMessage =
	| { type: 'init' }
	| { type: 'embed'; id: number; texts: string[] }
	| { type: 'dispose' };

type EmbeddingsRawRecord = Record<string, string | number | string[] | undefined>;

function isString(value: unknown): value is string {
	return typeof value === 'string';
}

function isNumber(value: unknown): value is number {
	return typeof value === 'number';
}

function isRecord(value: unknown): value is EmbeddingsRawRecord {
	return typeof value === 'object' && value !== null;
}

function parseMessageId(value: unknown): number {
	return isNumber(value) ? value : 0;
}

function parseStringArray(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	// SAFETY: Array.isArray guard above ensures `value` is an array, so `unknown[]` is the safe narrow.
	return (value as unknown[]).filter(isString);
}

function parseInboundMessage(data: unknown): EmbeddingsInboundMessage | null {
	if (!isRecord(data) || !isString(data.type)) return null;
	switch (data.type) {
		case 'init':
			return { type: 'init' };
		case 'embed':
			return {
				type: 'embed',
				id: parseMessageId(data.id),
				texts: parseStringArray(data.texts)
			};
		case 'dispose':
			return { type: 'dispose' };
		default:
			return null;
	}
}

function post(msg: EmbeddingsOutboundMessage): void {
	self.postMessage(msg);
}

async function loadModel(): Promise<void> {
	if (extractor) {
		post({ type: 'ready', dim: embeddingDim });
		return;
	}
	if (loading) return;
	loading = true;
	disposed = false;
	const thisGen = ++loadGeneration;

	try {
		let lastPct = 0;
		const loaded = await pipeline('feature-extraction', MODEL_ID, {
			dtype: 'q8',
			progress_callback: (info: { status?: string; total?: number; loaded?: number }) => {
				if (info.status === 'progress' && info.total && info.loaded) {
					const pct = (info.loaded / info.total) * 100;
					if (pct - lastPct > 2) {
						lastPct = pct;
						post({ type: 'progress', percent: Math.round(pct) });
					}
				}
			}
		});

		if (disposed || thisGen !== loadGeneration) {
			return;
		}

		// SAFETY: transformers.js pipeline returns an untyped feature extractor; runtime validates `feature-extraction` capability.
		extractor = loaded as FeatureExtractionPipeline;
		// Probe dimension with a one-token warmup so the first real query isn't
		// the one that pays the shape-inference cost.
		const warmup = await extractor('probe', { pooling: 'mean', normalize: true });
		embeddingDim = Array.isArray(warmup.dims) ? Number(warmup.dims[warmup.dims.length - 1]) : 384;

		post({ type: 'ready', dim: embeddingDim });
	} catch (error) {
		post({ type: 'error', message: error instanceof Error ? error.message : String(error) });
	} finally {
		loading = false;
	}
}

async function embedBatch(id: number, texts: string[]): Promise<void> {
	if (!extractor) {
		post({ type: 'error', id, message: 'Embeddings worker not ready' });
		return;
	}
	try {
		// Mean-pool + L2-normalize so cosine similarity becomes a dot product
		// at the ranking site - no per-row normalization needed downstream.
		const tensor = await extractor(texts, { pooling: 'mean', normalize: true });
		// SAFETY: transformers.js feature extractor exposes `.data` as a Float32Array buffer; validated via extractor presence.
		const flat = tensor.data as Float32Array;
		const dim = embeddingDim;
		const vectors: Float32Array[] = [];
		for (let i = 0; i < texts.length; i += 1) {
			vectors.push(flat.slice(i * dim, (i + 1) * dim));
		}
		post(
			{ type: 'embeddings', id, vectors }
			// Transfer underlying buffers when possible - avoids a copy for each
			// 384-dim vector across the worker boundary.
		);
	} catch (error) {
		post({ type: 'error', id, message: error instanceof Error ? error.message : String(error) });
	}
}

self.addEventListener('message', (event: MessageEvent) => {
	const parsed = parseInboundMessage(event.data);
	if (!parsed) return;

	if (parsed.type === 'init') {
		void loadModel();
		return;
	}

	if (parsed.type === 'embed') {
		void embedBatch(parsed.id, parsed.texts);
		return;
	}

	if (parsed.type === 'dispose') {
		disposed = true;
		extractor = null;
		loading = false;
		return;
	}
});
