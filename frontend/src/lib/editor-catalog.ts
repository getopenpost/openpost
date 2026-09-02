import type { ImageEditorDesignSummary } from '$lib/image-editor/types';

export const EDITOR_CATALOG_PAGE_SIZE = 50;

export interface EditorCatalogSnapshot {
	workspaceID: string;
	query: string;
	designs: ImageEditorDesignSummary[];
	designTotal: number;
	designOffset: number;
	canEditDesigns: boolean;
}

export type EditorCatalogItemKind = 'design';
export type EditorCatalogSurface = 'loading' | 'error' | 'empty' | 'content';

export function normalizeEditorCatalogQuery(value: string): string {
	return value.trim().toLowerCase();
}

export function editorCatalogKey(workspaceID: string, query: string): string {
	return JSON.stringify([workspaceID, normalizeEditorCatalogQuery(query)]);
}

export function resolveEditorCatalogSurface(input: {
	loading: boolean;
	error: string;
	designCount: number;
}): EditorCatalogSurface {
	if (input.designCount > 0) return 'content';
	if (input.loading) return 'loading';
	if (input.error) return 'error';
	return 'empty';
}

export function mergeEditorCatalogItems<T extends { id: string }>(
	current: readonly T[],
	incoming: readonly T[]
): T[] {
	const merged = current.map((item) => ({ ...item }));
	const positions = new Map(merged.map((item, index) => [item.id, index]));
	for (const item of incoming) {
		const index = positions.get(item.id);
		if (index === undefined) {
			positions.set(item.id, merged.length);
			merged.push({ ...item });
		} else {
			merged[index] = { ...item };
		}
	}
	return merged;
}
