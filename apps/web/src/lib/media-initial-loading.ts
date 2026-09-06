export interface MediaInitialLoadingState {
	workspaceLoading: boolean;
	hasWorkspace: boolean;
	mediaReady: boolean;
	mediaSettled: boolean;
	hubReady: boolean;
	hubSettled: boolean;
}

export function mediaInitialLoading(state: MediaInitialLoadingState): boolean {
	if (state.workspaceLoading) return true;
	if (!state.hasWorkspace) return false;
	return (!state.mediaReady && !state.mediaSettled) || (!state.hubReady && !state.hubSettled);
}
