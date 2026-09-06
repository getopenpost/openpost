/** Return a plain deep snapshot when timeline data may be a Svelte state proxy. */
export function snapshotTimelineState<T>(value: T): T {
	// SAFETY: timeline state contains plain project data, so Svelte's Snapshot<T>
	// has the same runtime shape as T after reactive proxies are removed.
	return $state.snapshot(value) as T;
}
