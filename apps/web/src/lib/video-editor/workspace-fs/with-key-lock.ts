/**
 * Per-key async serialization — a lightweight mutex keyed by string.
 *
 * Read-modify-write against a workspace JSON file is otherwise a classic
 * lost-update race. `withKeyLock(key, fn)` chains `fn` after any in-flight
 * work on the same key, so the read → mutate → write sequence is serialized
 * within this tab. Cross-tab collisions are rare and self-heal on next access.
 *
 * Ported from FreeCut (MIT).
 */

const chains = new Map<string, Promise<unknown>>();

/** Hold a key until the returned idempotent release function runs. */
export async function acquireKeyLock(key: string): Promise<() => void> {
	const previous = chains.get(key) ?? Promise.resolve();
	let resolveCurrent = (): void => undefined;
	const current = new Promise<void>((resolve) => {
		resolveCurrent = resolve;
	});
	chains.set(key, current);
	await previous.catch(() => undefined);
	let released = false;
	return () => {
		if (released) return;
		released = true;
		resolveCurrent();
		if (chains.get(key) === current) chains.delete(key);
	};
}

export async function withKeyLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
	const prev = chains.get(key) ?? Promise.resolve();
	// Silence prev's rejection for chaining purposes — we still want our own
	// work to run even if the previous caller failed.
	const silencedPrev = prev.catch(() => {});
	const result = silencedPrev.then(fn);
	const silencedResult = result.catch(() => {});
	chains.set(key, silencedResult);
	try {
		return await result;
	} finally {
		if (chains.get(key) === silencedResult) {
			chains.delete(key);
		}
	}
}

/** Test-only: drop all chains so tests start from a clean slate. */
export function __resetKeyLocksForTesting(): void {
	chains.clear();
}
