import { browser } from '$app/environment';
import { z } from 'zod';

const positionsSchema = z.record(
	z.string(),
	z.object({ x: z.number().finite(), y: z.number().finite() })
);
export type CanvasPositions = z.infer<typeof positionsSchema>;

function storageKey(workspaceID: string, workflowID: string): string {
	return `openpost-workflow-canvas-v1:${JSON.stringify([workspaceID, workflowID])}`;
}

export function readCanvasPositions(workspaceID: string, workflowID: string): CanvasPositions {
	if (!browser || !workspaceID || !workflowID) return {};
	try {
		const value = localStorage.getItem(storageKey(workspaceID, workflowID));
		if (!value) return {};
		const parsed = positionsSchema.safeParse(JSON.parse(value));
		return parsed.success ? parsed.data : {};
	} catch {
		return {};
	}
}

export function writeCanvasPositions(
	workspaceID: string,
	workflowID: string,
	positions: CanvasPositions
): boolean {
	if (!browser || !workspaceID || !workflowID) return false;
	try {
		localStorage.setItem(storageKey(workspaceID, workflowID), JSON.stringify(positions));
		return true;
	} catch {
		// A blocked browser store must not prevent editing or local undo.
		return false;
	}
}
