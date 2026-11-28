// Live server previews for publishing renderers (screenshot templates, text
// cards, memes). The server owns the pixels; this keeps them feeling local:
// - the last good image stays on screen while the next one renders,
// - at most one request is in flight, and each finished render is shown even
//   when newer input is waiting, so typing streams updates at server speed,
// - recent results are cached by key, so undo and toggles are instant.

export interface LivePreviewOptions {
	/** Coalesce bursts of input that arrive within this window. */
	debounceMs?: number;
	/** Minimum time between request starts, to stay under server rate limits. */
	minIntervalMs?: number;
	/** Number of recent results kept for instant reuse. */
	cacheSize?: number;
	/**
	 * Wait before the first render while nothing is on screen, so a caller
	 * that is about to supply a saved result does not trigger a request.
	 */
	initialDelayMs?: number;
}

export class LivePreviewError extends Error {
	constructor(
		message: string,
		public readonly status = 0
	) {
		super(message);
	}
}

export class LivePreview<T> {
	/** The newest rendered result, possibly for older input than `key`. */
	current = $state<T | null>(null);
	/** Key of `current`. */
	currentKey = $state('');
	/** True while the wanted key has not rendered yet. */
	pending = $state(false);
	/** Last failure for the wanted key; `current` stays visible. */
	error = $state<LivePreviewError | null>(null);

	#render: (key: string, signal: AbortSignal) => Promise<T>;
	#debounceMs: number;
	#minIntervalMs: number;
	#cacheSize: number;
	#initialDelayMs: number;
	#cache = new Map<string, T>();
	#wanted: string | null = null;
	#inflight: string | null = null;
	#controller: AbortController | null = null;
	#timer: ReturnType<typeof setTimeout> | null = null;
	#lastStart = 0;
	#disposed = false;

	constructor(
		render: (key: string, signal: AbortSignal) => Promise<T>,
		{
			debounceMs = 60,
			minIntervalMs = 100,
			cacheSize = 24,
			initialDelayMs = 0
		}: LivePreviewOptions = {}
	) {
		this.#render = render;
		this.#debounceMs = debounceMs;
		this.#minIntervalMs = minIntervalMs;
		this.#cacheSize = cacheSize;
		this.#initialDelayMs = initialDelayMs;
	}

	/** Ask for the preview of `key`. Pass null when there is nothing to render. */
	request(key: string | null): void {
		if (this.#disposed) return;
		this.#wanted = key;
		this.error = null;
		if (key === null) {
			this.#cancel();
			this.current = null;
			this.currentKey = '';
			this.pending = false;
			return;
		}
		const cached = this.#cache.get(key);
		if (cached !== undefined) {
			this.#touch(key, cached);
			this.#show(key, cached);
			this.pending = false;
			return;
		}
		if (key === this.#inflight) {
			this.pending = true;
			return;
		}
		this.pending = true;
		this.#schedule();
	}

	/** Render the wanted key again after a failure. */
	retry(): void {
		const key = this.#wanted;
		if (key === null) return;
		this.#cache.delete(key);
		this.request(key);
	}

	/** Stop waiting for a render and keep the current result on screen. */
	cancel(): void {
		this.#wanted = null;
		this.#cancel();
		this.pending = false;
		this.error = null;
	}

	/** Forget cached results, for example after referenced media changed. */
	invalidate(): void {
		this.#cache.clear();
		this.retry();
	}

	dispose(): void {
		this.#disposed = true;
		this.#cancel();
	}

	#schedule(): void {
		if (this.#inflight !== null || this.#timer !== null) return;
		const sinceLast = performance.now() - this.#lastStart;
		// The first change after a pause renders at once; bursts coalesce.
		const delay =
			this.current === null
				? this.#initialDelayMs
				: sinceLast > this.#minIntervalMs + this.#debounceMs
					? 0
					: Math.max(this.#debounceMs, this.#minIntervalMs - sinceLast);
		this.#timer = setTimeout(() => {
			this.#timer = null;
			void this.#pump();
		}, delay);
	}

	async #pump(): Promise<void> {
		const key = this.#wanted;
		if (key === null || this.#disposed || this.#inflight !== null) return;
		if (this.#cache.has(key)) {
			this.request(key);
			return;
		}
		const controller = new AbortController();
		this.#controller = controller;
		this.#inflight = key;
		this.#lastStart = performance.now();
		try {
			const result = await this.#render(key, controller.signal);
			if (controller.signal.aborted) return;
			this.#touch(key, result);
			// Show every finished render: it is newer than what is on screen.
			this.#show(key, result);
			if (key === this.#wanted) this.pending = false;
		} catch (cause) {
			if (controller.signal.aborted || isAbort(cause)) return;
			if (key === this.#wanted) {
				this.error =
					cause instanceof LivePreviewError
						? cause
						: new LivePreviewError(cause instanceof Error ? cause.message : String(cause));
				this.pending = false;
			}
		} finally {
			if (this.#controller === controller) this.#controller = null;
			if (this.#inflight === key) this.#inflight = null;
		}
		const next = this.#wanted;
		if (next !== null && next !== key && !this.#cache.has(next) && !this.#disposed)
			this.#schedule();
	}

	#show(key: string, result: T): void {
		this.current = result;
		this.currentKey = key;
	}

	#touch(key: string, result: T): void {
		this.#cache.delete(key);
		this.#cache.set(key, result);
		while (this.#cache.size > this.#cacheSize) {
			const oldest = this.#cache.keys().next().value;
			if (oldest === undefined) break;
			this.#cache.delete(oldest);
		}
	}

	#cancel(): void {
		if (this.#timer !== null) clearTimeout(this.#timer);
		this.#timer = null;
		this.#controller?.abort();
		this.#controller = null;
		this.#inflight = null;
	}
}

function isAbort(cause: unknown): boolean {
	return cause instanceof DOMException && cause.name === 'AbortError';
}
