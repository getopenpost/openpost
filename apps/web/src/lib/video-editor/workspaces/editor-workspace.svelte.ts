export const EDITOR_WORKSPACE_STORAGE_KEY = 'openpost-video-editor-workspace-v1';

export const EDITOR_WORKSPACE_IDS = ['edit', 'color', 'motion'] as const;

export type EditorWorkspaceId = (typeof EDITOR_WORKSPACE_IDS)[number];

interface WorkspaceStorage {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
}

export interface EditorWorkspaceStore {
	readonly current: EditorWorkspaceId;
	set(workspace: EditorWorkspaceId): boolean;
}

function normalizeWorkspace(value: string | null): EditorWorkspaceId {
	return EDITOR_WORKSPACE_IDS.find((workspace) => workspace === value) ?? 'edit';
}

function browserStorage(): WorkspaceStorage | null {
	try {
		return 'localStorage' in globalThis ? globalThis.localStorage : null;
	} catch {
		return null;
	}
}

export function createEditorWorkspaceStore(
	storage: WorkspaceStorage | null = browserStorage()
): EditorWorkspaceStore {
	let initial: EditorWorkspaceId = 'edit';
	try {
		initial = normalizeWorkspace(storage?.getItem(EDITOR_WORKSPACE_STORAGE_KEY) ?? null);
	} catch {
		initial = 'edit';
	}
	let current = $state<EditorWorkspaceId>(initial);

	return {
		get current(): EditorWorkspaceId {
			return current;
		},
		set(workspace: EditorWorkspaceId): boolean {
			if (workspace === current) return false;
			current = workspace;
			try {
				storage?.setItem(EDITOR_WORKSPACE_STORAGE_KEY, workspace);
			} catch {
				// Storage availability must not block workspace changes.
			}
			return true;
		}
	};
}

export const editorWorkspace = createEditorWorkspaceStore();
