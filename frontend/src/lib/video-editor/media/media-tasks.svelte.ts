export type MediaTaskKind =
	| 'import'
	| 'proxy'
	| 'filmstrip'
	| 'animated-image'
	| 'waveform'
	| 'scene-analysis'
	| 'transcription'
	| 'voice-generation'
	| 'music-generation'
	| 'reverse-conform'
	| 'upscale'
	| 'frame-interpolation';

export type MediaTaskStatus = 'queued' | 'running' | 'cancelling';

export interface MediaTask {
	id: string;
	/** Identifies the current owner when a logical task id gets replaced. */
	revision: number;
	kind: MediaTaskKind;
	mediaId?: string;
	label: string;
	stage?: string;
	status: MediaTaskStatus;
	/** A normalized 0 to 1 fraction, or null while the current stage is indeterminate. */
	progress: number | null;
	completed?: number;
	total?: number;
	receivedBytes?: number;
	totalBytes?: number;
	etaSeconds?: number | null;
	cancellable: boolean;
	startedAt: number;
	updatedAt: number;
}

export interface StartMediaTask {
	id: string;
	kind: MediaTaskKind;
	mediaId?: string;
	label: string;
	stage?: string;
	status?: Extract<MediaTaskStatus, 'queued' | 'running'>;
	progress?: number | null;
	completed?: number;
	total?: number;
	receivedBytes?: number;
	totalBytes?: number;
	etaSeconds?: number | null;
	onCancel?: () => void;
}

export type MediaTaskUpdate = Partial<
	Pick<
		MediaTask,
		| 'label'
		| 'stage'
		| 'status'
		| 'progress'
		| 'completed'
		| 'total'
		| 'receivedBytes'
		| 'totalBytes'
		| 'etaSeconds'
	>
>;

interface MediaTaskState {
	tasks: Record<string, MediaTask>;
}

const state = $state<MediaTaskState>({ tasks: {} });
const cancelHandlers = new Map<string, () => void>();
let nextRevision = 0;

function clampProgress(progress: number | null): number | null {
	if (progress === null || !Number.isFinite(progress)) return null;
	return Math.max(0, Math.min(1, progress));
}

export function mediaTaskId(kind: MediaTaskKind, scopeId: string): string {
	return `${kind}:${scopeId}`;
}

export const mediaTasks = {
	get list(): MediaTask[] {
		return Object.values(state.tasks).toSorted(
			(left, right) => left.startedAt - right.startedAt || left.id.localeCompare(right.id)
		);
	},

	get count(): number {
		return Object.keys(state.tasks).length;
	},

	get(id: string): MediaTask | undefined {
		return state.tasks[id];
	},

	start(input: StartMediaTask): number {
		const now = Date.now();
		const current = state.tasks[input.id];
		if (current) cancelHandlers.get(input.id)?.();
		const revision = ++nextRevision;
		state.tasks[input.id] = {
			id: input.id,
			revision,
			kind: input.kind,
			mediaId: input.mediaId,
			label: input.label,
			stage: input.stage,
			status: input.status ?? 'running',
			progress: clampProgress(input.progress ?? null),
			completed: input.completed,
			total: input.total,
			receivedBytes: input.receivedBytes,
			totalBytes: input.totalBytes,
			etaSeconds: input.etaSeconds,
			cancellable: Boolean(input.onCancel),
			startedAt: current?.startedAt ?? now,
			updatedAt: now
		};
		if (input.onCancel) cancelHandlers.set(input.id, input.onCancel);
		else cancelHandlers.delete(input.id);
		return revision;
	},

	update(id: string, patch: MediaTaskUpdate, revision?: number): void {
		const current = state.tasks[id];
		if (!current || (revision !== undefined && current.revision !== revision)) return;
		state.tasks[id] = {
			...current,
			...patch,
			progress: patch.progress === undefined ? current.progress : clampProgress(patch.progress),
			updatedAt: Date.now()
		};
	},

	finish(id: string, revision?: number): void {
		const current = state.tasks[id];
		if (!current || (revision !== undefined && current.revision !== revision)) return;
		const next = { ...state.tasks };
		delete next[id];
		state.tasks = next;
		cancelHandlers.delete(id);
	},

	cancel(id: string): boolean {
		const task = state.tasks[id];
		const cancel = cancelHandlers.get(id);
		if (!task || !cancel || task.status === 'cancelling') return false;
		this.update(id, { status: 'cancelling', stage: 'cancelling' });
		cancel();
		return true;
	},

	reset(): void {
		for (const [id, cancel] of cancelHandlers) {
			if (state.tasks[id]?.status !== 'cancelling') cancel();
		}
		cancelHandlers.clear();
		state.tasks = {};
	}
};
