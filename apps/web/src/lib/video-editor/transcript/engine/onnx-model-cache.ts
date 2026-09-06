export const ONNX_MODEL_CACHE_NAME = 'openpost-onnx-models-v1';

type ProgressCallback = (received: number, total: number, fromCache: boolean) => void;

const inFlight = new Map<
	string,
	{ promise: Promise<ArrayBuffer>; listeners: Set<ProgressCallback> }
>();
const MODEL_FETCH_RETRY_DELAYS_MS = [0, 500] as const;

class PermanentModelFetchError extends Error {}

function canRetryStatus(status: number): boolean {
	return status === 408 || status === 425 || status === 429 || status >= 500;
}

async function retryTransientDownload<T>(operation: () => Promise<T>): Promise<T> {
	let lastError: unknown;
	for (let attempt = 0; attempt <= MODEL_FETCH_RETRY_DELAYS_MS.length; attempt++) {
		try {
			return await operation();
		} catch (error) {
			if (error instanceof PermanentModelFetchError) throw error;
			if (error instanceof DOMException && error.name === 'AbortError') throw error;
			lastError = error;
			const delay = MODEL_FETCH_RETRY_DELAYS_MS[attempt];
			if (delay === undefined) break;
			if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
		}
	}
	const detail = lastError instanceof Error ? lastError.message : String(lastError);
	throw new Error(
		`Model download failed after ${MODEL_FETCH_RETRY_DELAYS_MS.length + 1} attempts: ${detail}`,
		{ cause: lastError }
	);
}

function requireSuccessfulResponse(response: Response): Response {
	if (response.ok) return response;
	const error = new Error(`Failed to fetch model asset (${response.status})`);
	if (canRetryStatus(response.status)) throw error;
	throw new PermanentModelFetchError(error.message);
}

async function openCache(): Promise<Cache | null> {
	if (!('caches' in globalThis)) return null;
	try {
		return await caches.open(ONNX_MODEL_CACHE_NAME);
	} catch {
		return null;
	}
}

async function readBytes(
	response: Response,
	onBytes: ProgressCallback,
	fromCache: boolean
): Promise<ArrayBuffer> {
	const total = Number(response.headers.get('content-length')) || 0;
	if (!response.body) return response.arrayBuffer();
	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let received = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		chunks.push(value);
		received += value.byteLength;
		onBytes(received, total, fromCache);
	}
	const merged = new Uint8Array(received);
	let offset = 0;
	for (const chunk of chunks) {
		merged.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return merged.buffer;
}

async function download(url: string, onBytes: ProgressCallback): Promise<ArrayBuffer> {
	const cache = await openCache();
	const cached = await cache?.match(url).catch(() => undefined);
	if (cached) return readBytes(cached, onBytes, true);
	const { bytes, contentType } = await retryTransientDownload(async () => {
		const response = requireSuccessfulResponse(await fetch(url));
		return {
			bytes: await readBytes(response, onBytes, false),
			contentType: response.headers.get('content-type') ?? 'application/octet-stream'
		};
	});
	await cache
		?.put(
			url,
			new Response(bytes, {
				headers: {
					'content-type': contentType,
					'content-length': String(bytes.byteLength)
				}
			})
		)
		.catch(() => undefined);
	return bytes;
}

export function fetchOnnxModelBytes(url: string, onBytes?: ProgressCallback): Promise<ArrayBuffer> {
	const existing = inFlight.get(url);
	if (existing) {
		if (onBytes) existing.listeners.add(onBytes);
		return existing.promise;
	}
	const listeners = new Set<ProgressCallback>();
	if (onBytes) listeners.add(onBytes);
	const broadcast: ProgressCallback = (...args) => {
		for (const listener of listeners) listener(...args);
	};
	const promise = download(url, broadcast).finally(() => inFlight.delete(url));
	inFlight.set(url, { promise, listeners });
	return promise;
}

export async function fetchOnnxModelText(url: string): Promise<string> {
	const cache = await openCache();
	const cached = await cache?.match(url).catch(() => undefined);
	if (cached) return cached.text();
	const { text, contentType } = await retryTransientDownload(async () => {
		const response = requireSuccessfulResponse(await fetch(url));
		return {
			text: await response.text(),
			contentType: response.headers.get('content-type') ?? 'text/plain'
		};
	});
	await cache
		?.put(url, new Response(text, { headers: { 'content-type': contentType } }))
		.catch(() => undefined);
	return text;
}
