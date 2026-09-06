export function initialEditorAccountId(
	selectedAccountIds: string[],
	variantAccountIds: Iterable<string>
): string | null {
	const variants = new Set(variantAccountIds);
	if (selectedAccountIds.some((id) => !variants.has(id))) return null;
	return selectedAccountIds.find((id) => variants.has(id)) ?? null;
}

export function editorAccountIdAfterVariantLoad(
	activeAccountId: string | null,
	selectedAccountIds: string[],
	variantAccountIds: Iterable<string>
): string | null {
	const variants = new Set(variantAccountIds);
	if (
		activeAccountId &&
		selectedAccountIds.includes(activeAccountId) &&
		variants.has(activeAccountId)
	) {
		return activeAccountId;
	}
	return initialEditorAccountId(selectedAccountIds, variants);
}
