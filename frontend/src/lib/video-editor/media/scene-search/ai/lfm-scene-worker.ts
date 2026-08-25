// Ported from FreeCut (MIT).
/**
 * Web Worker for LFM-2.5-VL scene cut verification.
 *
 * Loads LFM2.5-VL-450M-ONNX via @huggingface/transformers (bundled by Vite).
 * Runs inside a Worker so that model loading and inference don't block the
 * main thread.
 *
 * Messages:
 *   → { type: 'init' }                         - preload model
 *   → { type: 'verify', id, before, after }     - verify a candidate cut
 *   → { type: 'describe', id, image }           - describe an image with tags
 *   ← { type: 'ready' }                         - model loaded
 *   ← { type: 'progress', stage, percent }       - loading progress
 *   ← { type: 'result', id, isSceneCut, reason } - verification result
 *   ← { type: 'caption', id, caption }             - image caption
 *   ← { type: 'error', message }                 - error
 */

import {
	AutoProcessor,
	AutoModelForImageTextToText,
	RawImage,
	env
} from '@huggingface/transformers';
import { LFM_SCENE_CAPTION_PROMPT, parseSceneCaptionResponse } from './scene-caption-format';

const MODEL_ID = 'LiquidAI/LFM2.5-VL-450M-ONNX';

// Configure transformers.js for browser worker context
env.useBrowserCache = true;
env.allowLocalModels = false;
if (!globalThis.crossOriginIsolated && env.backends.onnx.wasm) {
	env.backends.onnx.wasm.numThreads = 1;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
let processor: any = null;
let model: any = null;
/* eslint-enable @typescript-eslint/no-explicit-any */
let loading = false;
let disposed = false;
let loadGeneration = 0;
const DESCRIBE_MAX_NEW_TOKENS = 160;

type LfmReadyMessage = { type: 'ready' };
type LfmProgressMessage = { type: 'progress'; stage: string; percent: number };
type LfmResultMessage = { type: 'result'; id: number; isSceneCut: boolean; reason: string };
type LfmCaptionMessage = {
	type: 'caption';
	id: number;
	caption: string;
	sceneData?: import('../types').SceneCaptionData;
	error?: string;
};
type LfmErrorMessage = { type: 'error'; message: string };
type LfmDebugMessage = {
	type: 'debug';
	id: number;
	stitchedSize?: string;
	prompt?: string;
	inputIds?: string;
	pixelValues?: string;
};
type LfmDisposedMessage = { type: 'disposed' };
type LfmOutboundMessage =
	| LfmReadyMessage
	| LfmProgressMessage
	| LfmResultMessage
	| LfmCaptionMessage
	| LfmErrorMessage
	| LfmDebugMessage
	| LfmDisposedMessage;

type LfmModelDtype = {
	vision_encoder: string;
	embed_tokens: string;
	decoder_model_merged: string;
};

type LfmModelOptions = {
	device: 'webgpu';
	dtype: LfmModelDtype;
	progress_callback?: (info: { status?: string; total?: number; loaded?: number }) => void;
};

function isString(value: unknown): value is string {
	return typeof value === 'string';
}

function isFunction(value: unknown): value is (...args: never[]) => void {
	return typeof value === 'function';
}

type LfmRawRecord = Record<string, string | number | boolean | undefined>;

function isRecord(value: unknown): value is LfmRawRecord {
	return typeof value === 'object' && value !== null;
}

function hasDispose(target: unknown): target is { dispose: () => void } {
	// SAFETY: isRecord guard ensures target is an object, so property access is safe.
	return isRecord(target) && isFunction((target as LfmRawRecord).dispose);
}

function parseErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function post(msg: LfmOutboundMessage): void {
	self.postMessage(msg);
}

async function loadModel(): Promise<void> {
	if (model && processor) {
		post({ type: 'ready' });
		return;
	}
	if (loading) return;
	loading = true;
	disposed = false;
	const thisGen = ++loadGeneration;

	try {
		post({ type: 'progress', stage: 'loading-transformers', percent: 0 });
		post({ type: 'progress', stage: 'loading-model', percent: 5 });

		let lastPct = 5;
		const loadedProcessor = await AutoProcessor.from_pretrained(MODEL_ID);

		if (disposed || thisGen !== loadGeneration) return;

		const adapter = await navigator.gpu?.requestAdapter();
		if (!adapter) throw new Error('Scene captions require WebGPU');
		const supportsFloat16 = adapter.features.has('shader-f16');
		const modelOptions: LfmModelOptions = {
			device: 'webgpu',
			dtype: supportsFloat16
				? {
						vision_encoder: 'fp16',
						embed_tokens: 'fp16',
						decoder_model_merged: 'q4'
					}
				: {
						vision_encoder: 'fp32',
						embed_tokens: 'fp32',
						decoder_model_merged: 'q4'
					},
			progress_callback: disposed
				? undefined
				: (info: { status?: string; total?: number; loaded?: number }) => {
						if (info.status === 'progress' && info.total && info.loaded) {
							const pct = 5 + (info.loaded / info.total) * 90;
							if (pct - lastPct > 2) {
								lastPct = pct;
								post({ type: 'progress', stage: 'loading-model', percent: Math.round(pct) });
							}
						}
					}
		};
		// SAFETY: transformers.js model options are untyped in this build; runtime validates device and dtype fields.
		const loadedModel = await AutoModelForImageTextToText.from_pretrained(
			MODEL_ID,
			modelOptions as any
		);

		if (disposed || thisGen !== loadGeneration) {
			// SAFETY: isRecord guard in hasDispose ensures property read is valid.
			if (isFunction((loadedModel as LfmRawRecord).dispose)) {
				// SAFETY: guarded by isFunction above, so dispose is callable.
				(loadedModel as { dispose: () => void }).dispose();
			}
			return;
		}

		processor = loadedProcessor;
		model = loadedModel;
		post({ type: 'progress', stage: 'ready', percent: 100 });
		post({ type: 'ready' });
	} catch (err) {
		if (!disposed) {
			post({ type: 'error', message: `Model load failed: ${parseErrorMessage(err)}` });
		}
	} finally {
		loading = false;
	}
}

const VERIFY_PROMPT =
	'This image shows two video frames side by side: the left frame is ~1 second before, the right frame is at the potential cut point. Is there an editorial cut between them?\n\n' +
	'NOT a cut - answer SAME:\n' +
	'- Camera movement: pan, tilt, zoom, dolly, tracking, crane, or handheld shake\n' +
	'- Whip pan or motion blur (fast continuous camera move)\n' +
	'- Subject or object motion within the same scene\n' +
	'- Lighting, exposure, or focus change in the same scene\n' +
	'- Gradual transition: dissolve, fade, crossfade\n\n' +
	'IS a cut - answer CUT:\n' +
	'- Completely different scene, location, or subject with no continuous motion\n' +
	'- Abrupt jump to a different camera angle\n\n' +
	'Answer exactly one word: CUT or SAME';

/** Stitch two frame blobs side-by-side into a single image for single-image VLMs. */
async function stitchSideBySide(beforeBlob: Blob, afterBlob: Blob): Promise<RawImage> {
	const [beforeBmp, afterBmp] = await Promise.all([
		createImageBitmap(beforeBlob),
		createImageBitmap(afterBlob)
	]);
	const w = beforeBmp.width + afterBmp.width;
	const h = Math.max(beforeBmp.height, afterBmp.height);
	const canvas = new OffscreenCanvas(w, h);
	const ctx = canvas.getContext('2d')!;
	ctx.drawImage(beforeBmp, 0, 0);
	ctx.drawImage(afterBmp, beforeBmp.width, 0);
	beforeBmp.close();
	afterBmp.close();
	const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 });
	return RawImage.fromBlob(blob);
}

async function verifyCandidate(id: number, beforeBlob: Blob, afterBlob: Blob): Promise<void> {
	if (!model || !processor) {
		post({ type: 'error', message: 'Model not loaded' });
		return;
	}

	try {
		const stitched = await stitchSideBySide(beforeBlob, afterBlob);

		post({
			type: 'debug',
			id,
			stitchedSize: `${stitched.width}x${stitched.height}`
		});

		const messages = [
			{
				role: 'user',
				content: [{ type: 'image' }, { type: 'text', text: VERIFY_PROMPT }]
			}
		];

		const prompt = processor.apply_chat_template(messages, {
			add_generation_prompt: true
		});

		post({
			type: 'debug',
			id,
			prompt: isString(prompt) ? prompt.slice(0, 500) : 'non-string prompt'
		});

		const inputs = await processor(stitched, prompt, { add_special_tokens: false });

		post({
			type: 'debug',
			id,
			inputIds: inputs.input_ids?.dims?.toString(),
			pixelValues: inputs.pixel_values?.dims?.toString()
		});

		const outputs = await model.generate({
			...inputs,
			max_new_tokens: 16,
			do_sample: false
		});

		const decoded = processor.batch_decode(
			outputs.slice(null, [inputs.input_ids.dims.at(-1), null]),
			{ skip_special_tokens: true }
		);

		const raw = (decoded[0] ?? '').trim();
		// Robust keyword detection - handles preamble or explanation from the model.
		// Conservative: default to SAME (not a cut) when ambiguous, since optical
		// flow already flagged this as a candidate.
		const hasCut = /\bCUT\b/i.test(raw);
		const hasSame = /\bSAME\b/i.test(raw);
		const isCut = hasCut && !hasSame;
		post({ type: 'result', id, isSceneCut: isCut, reason: raw });
	} catch (err) {
		post({ type: 'result', id, isSceneCut: false, reason: `error: ${parseErrorMessage(err)}` });
	}
}

async function describeImage(id: number, imageBlob: Blob): Promise<void> {
	if (!model || !processor) {
		post({ type: 'error', message: 'Model not loaded' });
		return;
	}

	try {
		const image = await RawImage.fromBlob(imageBlob);

		const messages = [
			{
				role: 'user',
				content: [{ type: 'image' }, { type: 'text', text: LFM_SCENE_CAPTION_PROMPT }]
			}
		];

		const prompt = processor.apply_chat_template(messages, {
			add_generation_prompt: true
		});

		const inputs = await processor(image, prompt, { add_special_tokens: false });

		const outputs = await model.generate({
			...inputs,
			max_new_tokens: DESCRIBE_MAX_NEW_TOKENS,
			do_sample: false,
			repetition_penalty: 1.05
		});

		const decoded = processor.batch_decode(
			outputs.slice(null, [inputs.input_ids.dims.at(-1), null]),
			{ skip_special_tokens: true }
		);

		const parsed = parseSceneCaptionResponse(decoded[0] ?? '');
		post({
			type: 'caption',
			id,
			caption: parsed.text,
			sceneData: parsed.sceneData
		});
	} catch (err) {
		post({ type: 'caption', id, caption: '', error: parseErrorMessage(err) });
	}
}

/** Release model and processor to free VRAM. */
function dispose(): void {
	disposed = true;
	if (model) {
		// SAFETY: isRecord guard in isFunction branch ensures property read is valid.
		if (isFunction((model as LfmRawRecord).dispose)) {
			// SAFETY: guarded by isFunction above, so dispose is callable.
			(model as { dispose: () => void }).dispose();
		}
		model = null;
	}
	processor = null;
	loading = false;
	post({ type: 'disposed' });
}

// Use addEventListener (not self.onmessage =) so the bootstrap wrapper
// can set onmessage for message buffering without conflicting.
self.addEventListener('message', (event: MessageEvent) => {
	const msg = event.data;
	if (msg.type === 'init') {
		void loadModel();
	} else if (msg.type === 'verify') {
		void verifyCandidate(msg.id, msg.before, msg.after);
	} else if (msg.type === 'describe') {
		void describeImage(msg.id, msg.image);
	} else if (msg.type === 'dispose') {
		dispose();
	}
});
