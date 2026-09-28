import { browser } from '$app/environment';
import { z } from 'zod';

function storageKey(projectId: string, workspaceId: string): string {
	return `openpost-video-editor-active-sequence-v1:${JSON.stringify([workspaceId, projectId])}`;
}

const sequenceViewSchema = z.object({
	activeSequenceId: z.string().nullable(),
	editSequenceId: z.string().nullable(),
	currentFrame: z.number().finite().nonnegative().optional(),
	zoomLevel: z.number().finite().positive().optional(),
	scrollPosition: z.number().finite().nonnegative().optional(),
	leftPanel: z.string().optional()
});
type SequenceView = z.infer<typeof sequenceViewSchema>;

export function readSequenceView(projectId: string, workspaceId: string): SequenceView | null {
	if (!browser) return null;
	try {
		const value = localStorage.getItem(storageKey(projectId, workspaceId));
		if (!value) return null;
		const parsed = sequenceViewSchema.safeParse(JSON.parse(value));
		return parsed.success ? parsed.data : null;
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
