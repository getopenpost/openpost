/**
 * Tiny synchronous pub-sub channel backing every timeline store.
 *
 * Stores expose Svelte-store-compatible `subscribe(run)` plus a Zustand-style
 * `getState()`, so they work with `$store` auto-subscription in components and
 * with plain reads in tests and non-component code. Kept dependency-free so
 * the timeline core runs under any test runner without Svelte compilation.
 *
 * Ported from FreeCut (MIT) — adapted from Zustand store plumbing.
 */

export interface StoreChannel {
	subscribe(listener: () => void): () => void;
	emit(): void;
}

export function createStoreChannel(): StoreChannel {
	const listeners = new Set<() => void>();
	return {
		subscribe(listener: () => void): () => void {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		emit(): void {
			for (const listener of [...listeners]) listener();
		}
	};
}
