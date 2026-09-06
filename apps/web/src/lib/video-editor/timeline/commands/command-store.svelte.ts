/**
 * Undo/redo history over timeline snapshots.
 *
 * `execute` is the core API: capture before → run action → capture after →
 * push an entry only if state actually changed. Redo clears on new actions.
 * Drag-style gestures call `addUndoEntry` with a pre-captured snapshot.
 *
 * Ported from FreeCut (MIT) — timeline-command-store.ts, single root context
 * (v1 has no compositions).
 */

import { createLogger } from '../../workspace-fs/logger';
import { timelineStore } from '../stores/timeline-store.svelte';
import { captureSnapshot, restoreSnapshot, snapshotsEqual } from './snapshot.svelte';
import type { CommandEntry, CommandPayloadValue, TimelineCommand, TimelineSnapshot } from './types';
import { keyframeSelectionStore } from '../stores/keyframe-selection-store.svelte';

const logger = createLogger('TimelineCommands');

class CommandHistory {
	undoStack = $state<CommandEntry[]>([]);
	redoStack = $state<CommandEntry[]>([]);
	private activeContext = 'root';
	private atomicDepth = 0;
	private readonly contextHistory = new Map<
		string,
		{ undoStack: CommandEntry[]; redoStack: CommandEntry[] }
	>();

	get canUndo(): boolean {
		return this.undoStack.length > 0;
	}

	get canRedo(): boolean {
		return this.redoStack.length > 0;
	}

	execute<T>(command: TimelineCommand, action: () => T): T {
		if (this.atomicDepth > 0) return action();
		const beforeSnapshot = captureSnapshot();
		const result = action();
		const afterSnapshot = captureSnapshot();
		if (!snapshotsEqual(beforeSnapshot, afterSnapshot)) {
			this.push(command, beforeSnapshot, afterSnapshot);
		}
		return result;
	}

	/** Collapse any nested timeline commands into one undoable transaction. */
	executeAtomic<T>(
		command: TimelineCommand,
		action: () => T,
		commitWhen?: (result: T) => boolean
	): T {
		if (this.atomicDepth > 0) {
			this.atomicDepth += 1;
			try {
				return action();
			} finally {
				this.atomicDepth -= 1;
			}
		}
		const beforeSnapshot = captureSnapshot();
		const beforeKeyframeSelection = keyframeSelectionStore.snapshotSelection();
		this.atomicDepth = 1;
		let result: T;
		try {
			result = action();
		} finally {
			this.atomicDepth = 0;
		}
		const afterSnapshot = captureSnapshot();
		if (commitWhen && !commitWhen(result)) {
			restoreSnapshot(beforeSnapshot, afterSnapshot.sequenceRegistry);
			keyframeSelectionStore.restoreSelection(beforeKeyframeSelection);
			return result;
		}
		if (!snapshotsEqual(beforeSnapshot, afterSnapshot)) {
			this.push(command, beforeSnapshot, afterSnapshot);
		}
		return result;
	}

	/** Commit a gesture that captured its own "before" snapshot at drag start. */
	addUndoEntry(command: TimelineCommand, beforeSnapshot: TimelineSnapshot): void {
		const afterSnapshot = captureSnapshot();
		if (!snapshotsEqual(beforeSnapshot, afterSnapshot)) {
			this.push(command, beforeSnapshot, afterSnapshot);
		}
	}

	private push(
		command: TimelineCommand,
		beforeSnapshot: TimelineSnapshot,
		afterSnapshot: TimelineSnapshot
	): void {
		const max = timelineStore.maxUndoHistory;
		this.undoStack = [
			...this.undoStack.slice(-(max - 1)),
			{ command, beforeSnapshot, afterSnapshot, timestamp: Date.now() }
		];
		this.redoStack = [];
	}

	undo(): void {
		if (this.undoStack.length === 0) return;
		const entry = this.undoStack[this.undoStack.length - 1];
		if (!entry) return;
		restoreSnapshot(entry.beforeSnapshot, entry.afterSnapshot.sequenceRegistry);
		this.undoStack = this.undoStack.slice(0, -1);
		this.redoStack = [...this.redoStack, entry];
		logger.debug(`undo ${entry.command.type}`);
	}

	redo(): void {
		if (this.redoStack.length === 0) return;
		const entry = this.redoStack[this.redoStack.length - 1];
		if (!entry) return;
		restoreSnapshot(entry.afterSnapshot, entry.beforeSnapshot.sequenceRegistry);
		this.redoStack = this.redoStack.slice(0, -1);
		this.undoStack = [...this.undoStack, entry];
		logger.debug(`redo ${entry.command.type}`);
	}

	clearHistory(): void {
		this.undoStack = [];
		this.redoStack = [];
		this.contextHistory.clear();
		this.activeContext = 'root';
		this.atomicDepth = 0;
	}

	setActiveContext(context: string | null): void {
		const key = context ?? 'root';
		if (key === this.activeContext) return;
		this.contextHistory.set(this.activeContext, {
			undoStack: [...this.undoStack],
			redoStack: [...this.redoStack]
		});
		const next = this.contextHistory.get(key);
		this.undoStack = next ? [...next.undoStack] : [];
		this.redoStack = next ? [...next.redoStack] : [];
		this.activeContext = key;
	}

	removeContext(context: string): void {
		this.contextHistory.delete(context);
	}

	getLastCommandType(): string | null {
		return this.undoStack[this.undoStack.length - 1]?.command.type ?? null;
	}
}

export const commandHistory = new CommandHistory();

/** Convenience wrapper matching FreeCut's `execute` action helper. */
export function execute<T>(
	commandType: string,
	action: () => T,
	payload?: Record<string, CommandPayloadValue>
): T {
	return commandHistory.execute({ type: commandType, payload }, action);
}

/** Run several command-producing actions as one undo entry. */
export function executeAtomic<T>(
	commandType: string,
	action: () => T,
	payload?: Record<string, CommandPayloadValue>
): T {
	return commandHistory.executeAtomic({ type: commandType, payload }, action);
}

/** Roll back the whole transaction when any nested action reports failure. */
export function executeAtomicBoolean(
	commandType: string,
	action: () => boolean,
	payload?: Record<string, CommandPayloadValue>
): boolean {
	return commandHistory.executeAtomic({ type: commandType, payload }, action, Boolean);
}
