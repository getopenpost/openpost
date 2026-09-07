/**
 * Per-tab timeline selection memory.
 *
 * FreeCut's sequence view state carries `selectedItemIds` alongside playhead,
 * zoom, and scroll so returning to a tab restores the working selection.
 * Playhead/zoom/scroll already round-trip through `sequence-store.svelte.ts`
 * (`flushActive` / `switchTo`); selection lives in page-level component state,
 * so it is stashed here keyed by tab and restored on switch.
 */

export const ROOT_TAB_SELECTION_KEY = '__root__';

export function tabSelectionKey(sequenceId: string | null): string {
	return sequenceId ?? ROOT_TAB_SELECTION_KEY;
}

/** Remember the outgoing tab's selection before it is cleared. */
export function stashTabSelection(
	memory: Map<string, string[]>,
	key: string,
	selectedIds: readonly string[]
): void {
	memory.set(key, [...selectedIds]);
}

/**
 * Recall a tab's selection, dropping ids that no longer exist on the timeline
 * (deleted clips must never resurrect as phantom selections).
 */
export function restoreTabSelection(
	memory: Map<string, string[]>,
	key: string,
	validIds: ReadonlySet<string>
): string[] {
	const saved = memory.get(key);
	if (!saved) return [];
	return saved.filter((id) => validIds.has(id));
}
