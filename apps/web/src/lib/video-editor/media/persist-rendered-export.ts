import { saveExportFile } from '../workspace-fs/exports';

export interface RenderExportResult {
	fileName: string;
	relPath: string;
	blob: Blob;
}

export interface RenderedExportArtifact {
	fileName: string;
	blob: Blob;
	sidecar?: { fileName: string; blob: Blob };
	renderMethod?: 'smart-copy' | 'rendered';
}

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
