import { readJson, writeJsonAtomic } from '../workspace-fs/fs-primitives';
import { projectRenderQueuePath } from '../workspace-fs/paths';
import { requireWorkspaceRoot } from '../workspace-fs/root';
import type { RenderQueueJob, RenderQueueSnapshot } from './render-queue-store';

const SCHEMA_VERSION = 1;

type PersistedJob = Omit<RenderQueueJob, 'snapshot'> & { snapshotId: string };

export interface PersistedRenderQueue {
	schemaVersion: 1;
	isPaused: boolean;
	snapshots: Record<string, RenderQueueSnapshot>;
	jobs: PersistedJob[];
}

export interface RestoredRenderQueue {
	jobs: RenderQueueJob[];
	isPaused: boolean;
}

export function renderQueuePersistenceSignature(
	jobs: readonly RenderQueueJob[],
	isPaused: boolean
): string {
	return JSON.stringify({
		isPaused,
		jobs: jobs.map((job) => ({
			id: job.id,
			status: job.status,
			progress: job.progress,
			phase: job.phase,
			framesDone: job.framesDone,
			totalFrames: job.totalFrames,
			savedPath: job.savedPath,
			outputLabel: job.outputLabel,
			fileSize: job.fileSize,
			error: job.error,
			startedAt: job.startedAt,
			finishedAt: job.finishedAt
		}))
	});
}

export function serializeRenderQueue(
	jobs: readonly RenderQueueJob[],
	isPaused: boolean
): PersistedRenderQueue {
	const ids = new Map<RenderQueueSnapshot, string>();
	const snapshots: Record<string, RenderQueueSnapshot> = {};
	const persistedJobs = jobs.map((job) => {
		let snapshotId = ids.get(job.snapshot);
		if (!snapshotId) {
			snapshotId = `snapshot-${ids.size + 1}`;
			ids.set(job.snapshot, snapshotId);
			snapshots[snapshotId] = job.snapshot;
		}
		const { snapshot: _snapshot, ...rest } = job;
		return { ...rest, snapshotId };
	});
	return {
		schemaVersion: SCHEMA_VERSION,
		isPaused,
		snapshots,
		jobs: persistedJobs
	};
}

export function restoreRenderQueue(document: PersistedRenderQueue | null): RestoredRenderQueue {
	if (!document || document.schemaVersion !== SCHEMA_VERSION || !Array.isArray(document.jobs)) {
		return { jobs: [], isPaused: false };
	}
	const jobs = document.jobs.flatMap((persisted) => {
		const snapshot = document.snapshots[persisted.snapshotId];
		if (!snapshot) return [];
		const { snapshotId: _snapshotId, ...job } = persisted;
		return [{ ...job, snapshot }];
	});
	const interrupted = jobs.some((job) => job.status === 'rendering');
	return { jobs, isPaused: document.isPaused || interrupted };
}

export async function loadProjectRenderQueue(projectId: string): Promise<RestoredRenderQueue> {
	const document = await readJson<PersistedRenderQueue>(
		requireWorkspaceRoot(),
		projectRenderQueuePath(projectId)
	);
	return restoreRenderQueue(document);
}

export async function saveProjectRenderQueue(
	projectId: string,
	jobs: readonly RenderQueueJob[],
	isPaused: boolean
): Promise<void> {
	await writeJsonAtomic(
		requireWorkspaceRoot(),
		projectRenderQueuePath(projectId),
		serializeRenderQueue(jobs, isPaused)
	);
}
