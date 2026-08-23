const composerSearchParameters = [
	'date',
	'time',
	'workspace_id',
	'account_ids',
	'builder_media',
	'image_editor_return',
	'editor_handoff_cancelled'
] as const;

export interface ComposerIntentState {
	activeDraftId?: string | null;
	hasPendingPrompt?: boolean;
}

export function hasComposerIntent(url: URL, state: ComposerIntentState = {}): boolean {
	if (state.activeDraftId?.trim() || state.hasPendingPrompt) return true;
	return composerSearchParameters.some((parameter) => url.searchParams.has(parameter));
}
