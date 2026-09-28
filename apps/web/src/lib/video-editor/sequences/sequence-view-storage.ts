import { browser } from '$app/environment';

function storageKey(projectId: string, workspaceId: string): string {
	return `openpost-video-editor-active-sequence-v1:${JSON.stringify([workspaceId, projectId])}`;
}

interface SequenceView {
	activeSequenceId: string | null;
	editSequenceId: string | null;
}

export function readSequenceView(projectId: string, workspaceId: string): SequenceView | null {
	if (!browser) return null;
	try {
		const value = localStorage.getItem(storageKey(projectId, workspaceId));
		if (!value) return null;
		const parsed: unknown = JSON.parse(value);
		if (
			!parsed ||
			typeof parsed !== 'object' ||
			!('activeSequenceId' in parsed) ||
			!('editSequenceId' in parsed)
		)
			return null;
		const { activeSequenceId, editSequenceId } = parsed;
		if (
			(activeSequenceId !== null && typeof activeSequenceId !== 'string') ||
			(editSequenceId !== null && typeof editSequenceId !== 'string')
		)
			return null;
		return { activeSequenceId, editSequenceId };
	} catch {
		return null;
	}
}

export function writeSequenceView(
	projectId: string,
	workspaceId: string,
	view: SequenceView
): void {
	if (!browser) return;
	try {
		const key = storageKey(projectId, workspaceId);
		localStorage.setItem(key, JSON.stringify(view));
	} catch {
		// Private browsing or full storage must not prevent sequence navigation.
	}
}
