import type { RenderQueueJob } from '../export/render-queue-store';

export function completedExportRefreshKey(jobs: readonly RenderQueueJob[]): string {
	return jobs
		.filter((job) => job.status === 'completed')
		.map((job) => job.id)
		.sort()
		.join('\u0000');
}
