import { afterEach, describe, expect, it } from 'vitest';
import {
	LOCAL_MODEL_CACHE_DEFINITIONS,
	clearLocalModelCache,
	inspectLocalModelCache,
	type LocalModelCacheDefinition
} from './model-cache';
import { localAiRuntimeRegistry } from './runtime-registry';

function requestUrl(request: RequestInfo | URL): string {
	return request instanceof Request ? request.url : String(request);
}

class MemoryCache implements Cache {
	constructor(
		private readonly responses: Map<string, Response>,
		private readonly failedDeletes = new Set<string>()
	) {}

	async add(): Promise<void> {}
	async addAll(): Promise<void> {}
	async put(request: RequestInfo | URL, response: Response): Promise<void> {
		this.responses.set(requestUrl(request), response);
	}
	async match(request: RequestInfo | URL): Promise<Response | undefined> {
		return this.responses.get(requestUrl(request))?.clone();
	}
	async matchAll(request?: RequestInfo | URL): Promise<Response[]> {
		if (request !== undefined) {
			const response = await this.match(request);
			return response ? [response] : [];
		}
		return Array.from(this.responses.values(), (response) => response.clone());
	}
	async delete(request: RequestInfo | URL): Promise<boolean> {
		const url = requestUrl(request);
		if (this.failedDeletes.has(url)) throw new Error(`Could not delete ${url}`);
		return this.responses.delete(url);
	}
	async keys(): Promise<Request[]> {
		return Array.from(this.responses.keys(), (url) => new Request(url));
	}
}

class MemoryCacheStorage implements CacheStorage {
	constructor(private readonly cache: Cache) {}

	async delete(): Promise<boolean> {
		return false;
	}
	async has(): Promise<boolean> {
		return true;
	}
	async match(request: RequestInfo | URL): Promise<Response | undefined> {
		return this.cache.match(request);
	}
	async keys(): Promise<string[]> {
		return ['transformers-cache', 'openpost-onnx-models-v1'];
	}
	async open(): Promise<Cache> {
		return this.cache;
	}
}

function createCacheStorage(
	entries: Array<{ url: string; bytes?: number }>,
	failedDeletes = new Set<string>()
): CacheStorage {
	const responses = new Map(
		entries.map((entry) => [
			entry.url,
			new Response(new Uint8Array(entry.bytes ?? 0), {
				headers: entry.bytes == null ? {} : { 'content-length': String(entry.bytes) }
			})
		])
	);
	return new MemoryCacheStorage(new MemoryCache(responses, failedDeletes));
}

const originalCaches = Object.getOwnPropertyDescriptor(globalThis, 'caches');
const runtimeCleanups: Array<() => void> = [];

function setCaches(storage: CacheStorage): void {
	Object.defineProperty(globalThis, 'caches', { configurable: true, value: storage });
}

afterEach(() => {
	for (const cleanup of runtimeCleanups.splice(0)) cleanup();
	if (originalCaches) Object.defineProperty(globalThis, 'caches', originalCaches);
	else Reflect.deleteProperty(globalThis, 'caches');
});

describe('local model cache', () => {
	it('does not claim an absent model is downloaded', async () => {
		setCaches(createCacheStorage([]));
		const parakeet = LOCAL_MODEL_CACHE_DEFINITIONS.find((entry) => entry.id === 'parakeet')!;
		await expect(inspectLocalModelCache(parakeet)).resolves.toMatchObject({
			downloaded: false,
			entryCount: 0
		});
	});

	it('clears matching model entries without deleting other models', async () => {
		const storage = createCacheStorage([
			{ url: 'https://huggingface.co/onnx-community/whisper-base/resolve/main/a.onnx', bytes: 40 },
			{ url: 'https://huggingface.co/LiquidAI/LFM2.5-VL-450M-ONNX/a.onnx', bytes: 90 }
		]);
		setCaches(storage);
		const whisper = LOCAL_MODEL_CACHE_DEFINITIONS.find((entry) => entry.id === 'whisper')!;
		await expect(clearLocalModelCache(whisper)).resolves.toBe(true);
		const cache = await storage.open('transformers-cache');
		expect((await cache.keys()).map((request) => request.url)).toEqual([
			'https://huggingface.co/LiquidAI/LFM2.5-VL-450M-ONNX/a.onnx'
		]);
	});

	it('unloads a resident runtime before removing its cached model', async () => {
		let unloads = 0;
		runtimeCleanups.push(
			localAiRuntimeRegistry.register({
				id: 'test-runtime',
				label: 'Test runtime',
				isLoaded: () => unloads === 0,
				unload: () => {
					unloads += 1;
				}
			})
		);
		setCaches(
			createCacheStorage([
				{ url: 'https://huggingface.co/openpost/test-runtime/model.onnx', bytes: 64 }
			])
		);
		const definition = {
			id: 'test-runtime',
			label: 'Test runtime',
			description: 'Test runtime cache.',
			cacheName: 'transformers-cache',
			matchPathFragments: ['/openpost/test-runtime/']
		} satisfies LocalModelCacheDefinition;

		await expect(
			Promise.all([clearLocalModelCache(definition), clearLocalModelCache(definition)])
		).resolves.toEqual([true, true]);
		expect(unloads).toBe(1);
	});

	it('settles every cache deletion before reporting a partial failure', async () => {
		const failedUrl = 'https://huggingface.co/openpost/partial-runtime/a.onnx';
		const removedUrl = 'https://huggingface.co/openpost/partial-runtime/b.onnx';
		const storage = createCacheStorage(
			[
				{ url: failedUrl, bytes: 32 },
				{ url: removedUrl, bytes: 32 }
			],
			new Set([failedUrl])
		);
		setCaches(storage);
		const definition = {
			id: 'partial-runtime',
			label: 'Partial runtime',
			description: 'Partial delete test.',
			cacheName: 'transformers-cache',
			matchPathFragments: ['/openpost/partial-runtime/']
		} satisfies LocalModelCacheDefinition;

		await expect(clearLocalModelCache(definition)).rejects.toBeInstanceOf(AggregateError);
		expect(
			(await (await storage.open('transformers-cache')).keys()).map((request) => request.url)
		).toEqual([failedUrl]);
	});
});
