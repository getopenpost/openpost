/* oxlint-disable anti-slop/no-unsafe-dictionary-type, anti-slop/no-unknown-parameters -- Video and image exporters return distinct artifact records; the job boundary preserves the result and catches unknown renderer failures. */
export type EditorExportStatus = 'running' | 'cancelling' | 'completed' | 'failed' | 'cancelled';

export interface EditorExportJob {
	id: string;
	project_id: string;
	revision: string;
	status: EditorExportStatus;
	progress: number;
	phase?: string;
	result?: Record<string, unknown>;
	error?: string;
	started_at: string;
	finished_at?: string;
}

const jobs = new Map<string, { job: EditorExportJob; controller: AbortController }>();
const maxRetainedJobs = 20;

export function startEditorExport(
	projectID: string,
	revision: string,
	run: (
		signal: AbortSignal,
		progress: (fraction: number, phase?: string) => void
	) => Promise<Record<string, unknown>>
): EditorExportJob {
	const controller = new AbortController();
	const job: EditorExportJob = {
		id: crypto.randomUUID(),
		project_id: projectID,
		revision,
		status: 'running',
		progress: 0,
		started_at: new Date().toISOString()
	};
	jobs.set(job.id, { job, controller });
	for (const [id, entry] of jobs) {
		if (jobs.size <= maxRetainedJobs) break;
		if (entry.job.status !== 'running' && entry.job.status !== 'cancelling') jobs.delete(id);
	}
	void run(controller.signal, (fraction, phase) => {
		if (job.status !== 'running' && job.status !== 'cancelling') return;
		job.progress = Math.max(0, Math.min(1, fraction));
		job.phase = phase;
	})
		.then((result) => {
			if (job.status !== 'running' && job.status !== 'cancelling') return;
			job.status = 'completed';
			job.progress = 1;
			job.result = result;
			job.finished_at = new Date().toISOString();
		})
		.catch((error: unknown) => {
			if (job.status !== 'running' && job.status !== 'cancelling') return;
			job.status = controller.signal.aborted ? 'cancelled' : 'failed';
			job.error = error instanceof Error ? error.message : 'Export failed';
			job.finished_at = new Date().toISOString();
		});
	return { ...job };
}

export function editorExportStatus(projectID: string, exportID: string): EditorExportJob | null {
	const job = jobs.get(exportID)?.job;
	return job?.project_id === projectID ? { ...job } : null;
}

export function cancelEditorExport(projectID: string, exportID: string): EditorExportJob | null {
	const entry = jobs.get(exportID);
	if (!entry || entry.job.project_id !== projectID) return null;
	if (entry.job.status === 'running') {
		entry.controller.abort();
		entry.job.status = 'cancelling';
	}
	return { ...entry.job };
}
