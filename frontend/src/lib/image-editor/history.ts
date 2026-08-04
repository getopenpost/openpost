export interface ImageEditorCommand<T> {
	label: string;
	apply(current: T): T;
	revert(current: T): T;
	coalesceKey?: string;
}

interface HistoryEntry<T> {
	label: string;
	before: T;
	after: T;
	coalesceKey?: string;
	createdAt: number;
}

export class ImageEditorHistory<T> {
	private undoStack: HistoryEntry<T>[] = [];
	private redoStack: HistoryEntry<T>[] = [];

	constructor(
		private readonly clone: (value: T) => T,
		private readonly limit = 100
	) {}

	execute(current: T, command: ImageEditorCommand<T>): T {
		const before = this.clone(current);
		const after = command.apply(this.clone(current));
		const now = Date.now();
		const previous = this.undoStack.at(-1);
		if (
			command.coalesceKey &&
			previous?.coalesceKey === command.coalesceKey &&
			now - previous.createdAt < 1000
		) {
			previous.after = this.clone(after);
			previous.createdAt = now;
		} else {
			this.undoStack.push({
				label: command.label,
				before,
				after: this.clone(after),
				coalesceKey: command.coalesceKey,
				createdAt: now
			});
			if (this.undoStack.length > this.limit) this.undoStack.shift();
		}
		this.redoStack = [];
		return after;
	}

	checkpoint(label: string, before: T, after: T, coalesceKey?: string): void {
		if (JSON.stringify(before) === JSON.stringify(after)) return;
		this.undoStack.push({
			label,
			before: this.clone(before),
			after: this.clone(after),
			coalesceKey,
			createdAt: Date.now()
		});
		if (this.undoStack.length > this.limit) this.undoStack.shift();
		this.redoStack = [];
	}

	undo(current: T): T {
		const entry = this.undoStack.pop();
		if (!entry) return current;
		this.redoStack.push(entry);
		return this.clone(entry.before);
	}

	redo(current: T): T {
		const entry = this.redoStack.pop();
		if (!entry) return current;
		this.undoStack.push(entry);
		return this.clone(entry.after);
	}

	get canUndo(): boolean {
		return this.undoStack.length > 0;
	}

	get canRedo(): boolean {
		return this.redoStack.length > 0;
	}

	get undoLabel(): string {
		return this.undoStack.at(-1)?.label ?? '';
	}

	get redoLabel(): string {
		return this.redoStack.at(-1)?.label ?? '';
	}

	clear(): void {
		this.undoStack = [];
		this.redoStack = [];
	}
}
