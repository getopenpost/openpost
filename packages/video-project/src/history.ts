import type { VideoProjectDocumentV1 } from './types.js';
import { cloneVideoProject } from './timeline.js';

export interface VideoProjectAction {
	id: string;
	label: string;
	apply(project: VideoProjectDocumentV1): VideoProjectDocumentV1;
	coalesce_key?: string;
}

interface HistoryEntry {
	action_id: string;
	label: string;
	before: VideoProjectDocumentV1;
	after: VideoProjectDocumentV1;
	coalesce_key?: string;
	created_at: number;
}

export class VideoProjectHistory {
	#undo: HistoryEntry[] = [];
	#redo: HistoryEntry[] = [];

	constructor(readonly limit = 200) {}

	execute(project: VideoProjectDocumentV1, action: VideoProjectAction): VideoProjectDocumentV1 {
		const before = cloneVideoProject(project);
		const after = action.apply(cloneVideoProject(project));
		const now = Date.now();
		const previous = this.#undo.at(-1);
		if (
			action.coalesce_key &&
			previous?.coalesce_key === action.coalesce_key &&
			now - previous.created_at < 1_000
		) {
			previous.after = cloneVideoProject(after);
			previous.created_at = now;
		} else {
			this.#undo.push({
				action_id: action.id,
				label: action.label,
				before,
				after: cloneVideoProject(after),
				...(action.coalesce_key ? { coalesce_key: action.coalesce_key } : {}),
				created_at: now
			});
			if (this.#undo.length > this.limit) this.#undo.shift();
		}
		this.#redo = [];
		return after;
	}

	undo(project: VideoProjectDocumentV1): VideoProjectDocumentV1 {
		const entry = this.#undo.pop();
		if (!entry) return project;
		this.#redo.push(entry);
		return cloneVideoProject(entry.before);
	}

	redo(project: VideoProjectDocumentV1): VideoProjectDocumentV1 {
		const entry = this.#redo.pop();
		if (!entry) return project;
		this.#undo.push(entry);
		return cloneVideoProject(entry.after);
	}

	get canUndo(): boolean {
		return this.#undo.length > 0;
	}

	get canRedo(): boolean {
		return this.#redo.length > 0;
	}

	get undoLabel(): string {
		return this.#undo.at(-1)?.label ?? '';
	}

	get redoLabel(): string {
		return this.#redo.at(-1)?.label ?? '';
	}

	clear(): void {
		this.#undo = [];
		this.#redo = [];
	}
}
