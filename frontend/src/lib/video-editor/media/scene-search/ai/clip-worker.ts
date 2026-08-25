// Ported from FreeCut (MIT).
/**
 * Web Worker for CLIP image + text embeddings.
 *
 * Loads both halves of `Xenova/clip-vit-base-patch32` (q8 quantized,
 * ~90 MB total) so the same worker can embed:
 *   - scene thumbnails at caption time (image encoder), producing
 *     vectors that get stored in `captions-image-embeddings.bin`, and
 *   - search queries at query time (text encoder), producing a vector
 *     in the *same* 512-dim space so cosine similarity against image
 *     embeddings is meaningful.
 *
 * Kept separate from the all-MiniLM text worker because the models are
 * large and users who never switch to semantic search shouldn't pay the
 * CLIP download cost.
 *
 * Messages:
 *   → { type: 'init' }
 *   → { type: 'embed-images', id, blobs: Blob[] }
 *   → { type: 'embed-text',   id, texts: string[] }
 *   → { type: 'dispose' }
 *   ← { type: 'ready', dim: number }
 *   ← { type: 'progress', percent: number }
 *   ← { type: 'vectors', id, vectors: Float32Array[] }
 *   ← { type: 'error', id?, message }
 */

import {
	AutoProcessor,
	AutoTokenizer,
	CLIPTextModelWithProjection,
	CLIPVisionModelWithProjection,
	RawImage,
	env,
	type PreTrainedTokenizer,
	type Processor,
	type PreTrainedModel
} from '@huggingface/transformers';

const MODEL_ID = 'Xenova/clip-vit-base-patch32';

env.useBrowserCache = true;
env.allowLocalModels = false;
if (!globalThis.crossOriginIsolated && env.backends.onnx.wasm) {
	env.backends.onnx.wasm.numThreads = 1;
}

/* eslint-disable @typescript-eslint/no-explicit-any -- transformers.js
   tensor types vary by version; the worker stays schema-stable. */
let tokenizer: PreTrainedTokenizer | null = null;
let processor: Processor | null = null;
let textModel: PreTrainedModel | null = null;
let visionModel: PreTrainedModel | null = null;
let loading = false;
let disposed = false;
let loadGeneration = 0;
let embeddingDim = 512;

type ClipWorkerReadyMessage = { type: 'ready'; dim: number };
type ClipWorkerProgressMessage = { type: 'progress'; percent: number };
type ClipWorkerVectorsMessage = { type: 'vectors'; id: number; vectors: Float32Array[] };
type ClipWorkerErrorMessage = { type: 'error'; id?: number; message: string };
type ClipWorkerOutboundMessage =
	| ClipWorkerReadyMessage
	| ClipWorkerProgressMessage
	| ClipWorkerVectorsMessage
	| ClipWorkerErrorMessage;

type ClipWorkerInboundMessage =
	| { type: 'init' }
	| { type: 'embed-images'; id: number; blobs: Blob[] }
	| { type: 'embed-text'; id: number; texts: string[] }
	| { type: 'dispose' };

type ClipWorkerRawRecord = Record<
	string,
	string | number | boolean | Blob[] | string[] | undefined
>;

function isString(value: unknown): value is string {
	return typeof value === 'string';
}

function isNumber(value: unknown): value is number {
	return typeof value === 'number';
}

function isRecord(value: unknown): value is ClipWorkerRawRecord {
	return typeof value === 'object' && value !== null;
}

function parseMessageId(value: unknown): number {
	return isNumber(value) ? value : 0;
}

function parseBlobArray(value: unknown): Blob[] {
	if (!Array.isArray(value)) return [];
	return value.filter((entry): entry is Blob => entry instanceof Blob);
}

function parseStringArray(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	// SAFETY: Array.isArray guard above ensures `value` is an array, so `unknown[]` is the safe narrow.
	return (value as unknown[]).filter(isString);
}

function parseInboundMessage(data: unknown): ClipWorkerInboundMessage | null {
	if (!isRecord(data) || !isString(data.type)) return null;
	switch (data.type) {
		case 'init':
			return { type: 'init' };
		case 'embed-images':
			return {
				type: 'embed-images',
				id: parseMessageId(data.id),
				blobs: parseBlobArray(data.blobs)
			};
		case 'embed-text':
			return {
				type: 'embed-text',
				id: parseMessageId(data.id),
				texts: parseStringArray(data.texts)
			};
		case 'dispose':
			return { type: 'dispose' };
		default:
			return null;
	}
}

function post(msg: ClipWorkerOutboundMessage): void {
	self.postMessage(msg);
}

async function loadModel(): Promise<void> {
	if (tokenizer && processor && textModel && visionModel) {
		post({ type: 'ready', dim: embeddingDim });
		return;
	}
	if (loading) return;
	loading = true;
	disposed = false;
	const thisGen = ++loadGeneration;

	try {
		let lastPct = 0;
		const onProgress = (info: { status?: string; total?: number; loaded?: number }) => {
			if (info.status === 'progress' && info.total && info.loaded) {
				const pct = (info.loaded / info.total) * 100;
				if (pct - lastPct > 2) {
					lastPct = pct;
					post({ type: 'progress', percent: Math.round(pct) });
				}
			}
		};

		const [loadedTokenizer, loadedProcessor, loadedTextModel, loadedVisionModel] =
			await Promise.all([
				AutoTokenizer.from_pretrained(MODEL_ID),
				AutoProcessor.from_pretrained(MODEL_ID),
				CLIPTextModelWithProjection.from_pretrained(MODEL_ID, {
					dtype: 'q8',
					// SAFETY: transformers.js progress_callback is untyped in this build; runtime validates it as a function.
					progress_callback: onProgress as any
				}),
				CLIPVisionModelWithProjection.from_pretrained(MODEL_ID, {
					dtype: 'q8',
					// SAFETY: transformers.js progress_callback is untyped in this build; runtime validates it as a function.
					progress_callback: onProgress as any
				})
			]);

		if (disposed || thisGen !== loadGeneration) return;

		tokenizer = loadedTokenizer;
		processor = loadedProcessor;
		textModel = loadedTextModel;
		visionModel = loadedVisionModel;

		// Probe the projection dim with a tiny warmup; different CLIP
		// variants project to 512, 768, or 1024 dims and we want to be sure
		// before callers start packing bins.
		try {
			// SAFETY: tokenizer is a callable instance in transformers.js; the type build omits the call signature.
			const tokens = (tokenizer as any)(['probe'], { padding: true, truncation: true });
			// SAFETY: textModel is callable and returns projection tensors; runtime guarantees dims on success.
			const output = (await (textModel as any)(tokens)) as {
				text_embeds?: { dims?: number[] };
			};
			const dims: number[] | undefined = output?.text_embeds?.dims;
			if (Array.isArray(dims) && dims.length > 0) {
				embeddingDim = Number(dims[dims.length - 1]);
			}
		} catch {
			// Stick with the default dim if the probe fails - the real embed
			// calls will surface a more specific error if the model is bad.
		}

		post({ type: 'ready', dim: embeddingDim });
	} catch (error) {
		post({ type: 'error', message: error instanceof Error ? error.message : String(error) });
	} finally {
		loading = false;
	}
}

function normalize(vector: Float32Array): Float32Array {
	let sum = 0;
	for (let i = 0; i < vector.length; i += 1) sum += vector[i]! * vector[i]!;
	const norm = Math.sqrt(sum) || 1;
	const out = new Float32Array(vector.length);
	for (let i = 0; i < vector.length; i += 1) out[i] = vector[i]! / norm;
	return out;
}

function splitPacked(packed: Float32Array, count: number, dim: number): Float32Array[] {
	const vectors: Float32Array[] = [];
	for (let i = 0; i < count; i += 1) {
		vectors.push(normalize(packed.slice(i * dim, (i + 1) * dim)));
	}
	return vectors;
}

async function embedImages(id: number, blobs: Blob[]): Promise<void> {
	if (!processor || !visionModel) {
		post({ type: 'error', id, message: 'CLIP worker not ready (vision)' });
		return;
	}
	if (blobs.length === 0) {
		post({ type: 'vectors', id, vectors: [] });
		return;
	}
	try {
		const images = await Promise.all(blobs.map((blob) => RawImage.fromBlob(blob)));
		// SAFETY: processor is callable with RawImage[] in transformers.js; build types omit the overload.
		const inputs = await (processor as any)(images);
		// SAFETY: vision model is callable with processor outputs and returns image_embeds tensor; guard validates `data` below.
		const output = (await (visionModel as any)(inputs)) as {
			image_embeds?: { data?: Float32Array };
		};
		// SAFETY: validated that image_embeds.data exists as Float32Array before use.
		const data = output?.image_embeds?.data as Float32Array | undefined;
		if (!data) throw new Error('CLIP vision model returned no image_embeds');
		post({ type: 'vectors', id, vectors: splitPacked(data, blobs.length, embeddingDim) });
	} catch (error) {
		post({ type: 'error', id, message: error instanceof Error ? error.message : String(error) });
	}
}

async function embedTexts(id: number, texts: string[]): Promise<void> {
	if (!tokenizer || !textModel) {
		post({ type: 'error', id, message: 'CLIP worker not ready (text)' });
		return;
	}
	if (texts.length === 0) {
		post({ type: 'vectors', id, vectors: [] });
		return;
	}
	try {
		// SAFETY: tokenizer is callable with string[] in transformers.js; build types omit the call signature.
		const tokens = (tokenizer as any)(texts, { padding: true, truncation: true });
		// SAFETY: text model is callable with token output and returns text_embeds; guard validates `data` below.
		const output = (await (textModel as any)(tokens)) as {
			text_embeds?: { data?: Float32Array };
		};
		// SAFETY: validated that text_embeds.data exists as Float32Array before use.
		const data = output?.text_embeds?.data as Float32Array | undefined;
		if (!data) throw new Error('CLIP text model returned no text_embeds');
		post({ type: 'vectors', id, vectors: splitPacked(data, texts.length, embeddingDim) });
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

	if (parsed.type === 'embed-images') {
		void embedImages(parsed.id, parsed.blobs);
		return;
	}

	if (parsed.type === 'embed-text') {
		void embedTexts(parsed.id, parsed.texts);
		return;
	}

	if (parsed.type === 'dispose') {
		disposed = true;
		tokenizer = null;
		processor = null;
		textModel = null;
		visionModel = null;
		loading = false;
		return;
	}
});
/* eslint-enable @typescript-eslint/no-explicit-any */
