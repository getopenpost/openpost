import type { ImageEditorDesignSummary } from '$lib/image-editor/types';
import type { CloudVideoProjectSummary } from '$lib/video-editor/api';

export const EDITOR_CATALOG_PAGE_SIZE = 50;

export interface EditorCatalogSnapshot {
	workspaceID: string;
	query: string;
	designs: ImageEditorDesignSummary[];
	videoProjects: CloudVideoProjectSummary[];
	designTotal: number;
	videoTotal: number;
	designOffset: number;
	videoOffset: number;
	canEditDesigns: boolean;
	canEditVideos: boolean;
}

export type EditorCatalogItemKind = 'design' | 'video';

type CatalogItem = ImageEditorDesignSummary | CloudVideoProjectSummary;

interface RemovedItem {
	key: string;
	index: number;
	item: CatalogItem;
}

export interface EditorCatalogRollback {
	kind: EditorCatalogItemKind;
	workspaceID: string;
	items: RemovedItem[];
}

export interface EditorCatalogRequestToken {
	key: string;
	generation: number;
	signal: AbortSignal;
}

export function normalizeEditorCatalogQuery(value: string): string {
	return value.trim().toLowerCase();
}

export function editorCatalogKey(workspaceID: string, query: string): string {
	return JSON.stringify([workspaceID, normalizeEditorCatalogQuery(query)]);
}

export function emptyEditorCatalog(workspaceID: string, query: string): EditorCatalogSnapshot {
	return {
		workspaceID,
		query: normalizeEditorCatalogQuery(query),
		designs: [],
		videoProjects: [],
		designTotal: 0,
		videoTotal: 0,
		designOffset: 0,
		videoOffset: 0,
		canEditDesigns: false,
		canEditVideos: false
	};
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

function cloneSnapshot(snapshot: EditorCatalogSnapshot): EditorCatalogSnapshot {
	return {
		...snapshot,
		designs: snapshot.designs.map((design) => ({ ...design })),
		videoProjects: snapshot.videoProjects.map((project) => ({ ...project }))
	};
}

/**
 * Stores complete query snapshots under both workspace and normalized search.
 * Mutations fan out only across entries for their originating workspace.
 */
export class EditorCatalogCache {
	private readonly entries = new Map<string, EditorCatalogSnapshot>();

	read(workspaceID: string, query: string): EditorCatalogSnapshot | undefined {
		const snapshot = this.entries.get(editorCatalogKey(workspaceID, query));
		return snapshot ? cloneSnapshot(snapshot) : undefined;
	}

	write(snapshot: EditorCatalogSnapshot): void {
		this.entries.set(
			editorCatalogKey(snapshot.workspaceID, snapshot.query),
			cloneSnapshot(snapshot)
		);
	}

	remove(workspaceID: string, kind: EditorCatalogItemKind, itemID: string): EditorCatalogRollback {
		const items: RemovedItem[] = [];
		for (const [key, snapshot] of this.entries) {
			if (snapshot.workspaceID !== workspaceID) continue;
			if (kind === 'design') {
				const index = snapshot.designs.findIndex((item) => item.id === itemID);
				if (index < 0) continue;
				const [item] = snapshot.designs.splice(index, 1);
				snapshot.designTotal = Math.max(0, snapshot.designTotal - 1);
				items.push({ key, index, item });
			} else {
				const index = snapshot.videoProjects.findIndex((item) => item.id === itemID);
				if (index < 0) continue;
				const [item] = snapshot.videoProjects.splice(index, 1);
				snapshot.videoTotal = Math.max(0, snapshot.videoTotal - 1);
				items.push({ key, index, item });
			}
		}
		return { kind, workspaceID, items };
	}

	restore(rollback: EditorCatalogRollback): void {
		for (const removed of rollback.items) {
			const snapshot = this.entries.get(removed.key);
			if (!snapshot || snapshot.workspaceID !== rollback.workspaceID) continue;
			if (rollback.kind === 'design') {
				if (snapshot.designs.some((item) => item.id === removed.item.id)) continue;
				snapshot.designs.splice(
					Math.min(removed.index, snapshot.designs.length),
					0,
					removed.item as ImageEditorDesignSummary
				);
				snapshot.designTotal += 1;
			} else {
				if (snapshot.videoProjects.some((item) => item.id === removed.item.id)) continue;
				snapshot.videoProjects.splice(
					Math.min(removed.index, snapshot.videoProjects.length),
					0,
					removed.item as CloudVideoProjectSummary
				);
				snapshot.videoTotal += 1;
			}
		}
	}

	invalidateWorkspace(workspaceID: string): void {
		for (const [key, snapshot] of this.entries) {
			if (snapshot.workspaceID === workspaceID) this.entries.delete(key);
		}
	}
}

/** A small generation gate that aborts superseded reads and rejects late results. */
export class EditorCatalogRequestGate {
	private generation = 0;
	private controller: AbortController | null = null;

	begin(key: string): EditorCatalogRequestToken {
		this.controller?.abort();
		this.controller = new AbortController();
		return {
			key,
			generation: ++this.generation,
			signal: this.controller.signal
		};
	}

	accepts(token: EditorCatalogRequestToken, activeKey: string): boolean {
		return !token.signal.aborted && token.key === activeKey && token.generation === this.generation;
	}

	invalidate(): void {
		this.generation += 1;
		this.controller?.abort();
		this.controller = null;
	}
}

export function isAbortError(cause: unknown): boolean {
	return cause instanceof Error && cause.name === 'AbortError';
}
