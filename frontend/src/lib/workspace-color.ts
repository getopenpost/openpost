import type { Workspace } from '$lib/api/client';

export const DEFAULT_WORKSPACE_COLOR = '#f97316';

export function workspaceColor(
	workspace: Pick<Workspace, 'id'> & { color?: string | null }
): string {
	const color = workspace.color?.trim().toLowerCase() ?? '';
	return /^#[0-9a-f]{6}$/.test(color) ? color : DEFAULT_WORKSPACE_COLOR;
}
