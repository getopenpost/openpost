import { saveExportFile } from '../workspace-fs/exports';
import type { RenderedExportArtifact, RenderExportResult } from './render-export';

/** Save one completed in-memory artifact exactly once on the main thread. */
export async function saveRenderedExportArtifact(
	projectId: string,
	rendered: RenderedExportArtifact
): Promise<RenderExportResult> {
	const saved = await saveExportFile(projectId, rendered.fileName, rendered.blob);
	if (rendered.sidecar) {
		await saveExportFile(projectId, rendered.sidecar.fileName, rendered.sidecar.blob);
	}
	return { ...saved, blob: rendered.blob };
}
