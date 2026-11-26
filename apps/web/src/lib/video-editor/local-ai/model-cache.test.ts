import { afterEach, describe, expect, it } from 'vitest';
import { clearLocalModelCache, type LocalModelCacheDefinition } from './model-cache';
import { localAiRuntimeRegistry } from './runtime-registry';

function requestUrl(request: RequestInfo | URL): string {
	return request instanceof Request ? request.url : String(request);
}

class MemoryCache implements Cache {
	constructor(
		private readonly responses: Map<string, Response>,
		private readonly failedDeletes = new Set<string>(),
		private readonly beforeDelete?: () => void
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
		this.beforeDelete?.();
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
		return ['transformers-cache'];
	}
	async open(name: string): Promise<Cache> {
		if (name !== 'transformers-cache') throw new Error('Unknown cache');
		return this.cache;
	}
}

function createCacheStorage(
	entries: Array<{ url: string; bytes?: number }>,
	failedDeletes = new Set<string>(),
	beforeDelete?: () => void
): CacheStorage {
	const responses = new Map(
		entries.map((entry) => [
			entry.url,
			new Response(new Uint8Array(entry.bytes ?? 0), {
				headers: entry.bytes == null ? {} : { 'content-length': String(entry.bytes) }
			})
		])
	);
	return new MemoryCacheStorage(new MemoryCache(responses, failedDeletes, beforeDelete));
}

const originalCaches = Object.getOwnPropertyDescriptor(globalThis, 'caches');
const runtimeCleanups: Array<() => void> = [];

function setCaches(storage: CacheStorage): void {
	Object.defineProperty(globalThis, 'caches', {
		configurable: true,
		value: storage
	});
}

afterEach(() => {
	for (const cleanup of runtimeCleanups.splice(0)) cleanup();
	if (originalCaches) Object.defineProperty(globalThis, 'caches', originalCaches);
	else Reflect.deleteProperty(globalThis, 'caches');
});

describe('local model cache', () => {
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
			createCacheStorage(
				[
					{
						url: 'https://huggingface.co/openpost/test-runtime/model.onnx',
						bytes: 64
					}
				],
				new Set(),
				() => expect(unloads).toBe(1)
			)
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
});
