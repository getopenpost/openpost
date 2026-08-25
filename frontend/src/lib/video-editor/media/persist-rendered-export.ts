import { exists, openBlobWriter, removeEntry } from '../workspace-fs/fs-primitives';
import { requireWorkspaceRoot } from '../workspace-fs/root';
import {
	projectExportFilePath,
	sanitizeWorkspaceFileName,
	PROJECTS_DIR,
	EXPORTS_DIR
} from '../workspace-fs/paths';
import { deleteExportFile, saveExportFile } from '../workspace-fs/exports';
import type { RenderedExportArtifact, RenderExportResult } from './render-export';
import { discardStreamingScratch } from '$lib/video/stream-target';
import { CHUNKED_SAVE_THRESHOLD_BYTES, SAVE_CHUNK_SIZE } from './streaming-limits';

function suffixFileName(fileName: string, n: number): string {
	const dot = fileName.lastIndexOf('.');
	const hasExt = dot > 0;
	const stem = hasExt ? fileName.slice(0, dot) : fileName;
	const ext = hasExt ? fileName.slice(dot) : '';
	return `${stem} (${n})${ext}`;
}

async function uniqueFileNameForSave(
	root: FileSystemDirectoryHandle,
	pathOf: (name: string) => string[],
	fileName: string
): Promise<string> {
	const safe = sanitizeWorkspaceFileName(fileName);
	if (!(await exists(root, pathOf(safe)))) return safe;
	for (let n = 2; n < 1000; n++) {
		const candidate = suffixFileName(safe, n);
		if (!(await exists(root, pathOf(candidate)))) return candidate;
	}
	return suffixFileName(safe, Date.now());
}

async function saveLargeBlobChunked(
	projectId: string | undefined,
	fileName: string,
	blob: Blob
): Promise<{ fileName: string; relPath: string }> {
	const root = requireWorkspaceRoot();
	const pathOf = projectId
		? (name: string) => projectExportFilePath(projectId, name)
		: (name: string) => [EXPORTS_DIR, sanitizeWorkspaceFileName(name)];
	const relBase = projectId ? `${PROJECTS_DIR}/${projectId}/${EXPORTS_DIR}` : EXPORTS_DIR;
	const name = await uniqueFileNameForSave(root, pathOf, fileName);
	const writer = await openBlobWriter(root, pathOf(name));
	try {
		if (blob.size <= SAVE_CHUNK_SIZE) {
			const buffer = await blob.arrayBuffer();
			await writer.write(new Uint8Array(buffer));
		} else if (blob.stream) {
			const reader = blob.stream().getReader();
			try {
				while (true) {
					const { done, value } = await reader.read();
					if (done) break;
					if (value) await writer.write(value);
				}
			} finally {
				reader.releaseLock();
			}
		} else {
			for (let offset = 0; offset < blob.size; offset += SAVE_CHUNK_SIZE) {
				const slice = blob.slice(offset, offset + SAVE_CHUNK_SIZE);
				const buffer = await slice.arrayBuffer();
				await writer.write(new Uint8Array(buffer));
			}
		}
		await writer.close();
	} catch (error) {
		await writer
			.abort(error instanceof Error ? error : new Error(String(error)))
			.catch(() => undefined);
		await removeEntry(root, pathOf(name)).catch(() => undefined);
		throw error;
	}
	return { fileName: name, relPath: `${relBase}/${name}` };
}

/** Save one completed artifact exactly once on the main thread, streaming large blobs in bounded chunks. */
export async function saveRenderedExportArtifact(
	projectId: string,
	rendered: RenderedExportArtifact
): Promise<RenderExportResult> {
	const scratchFileName = rendered.scratchFileName;
	let saved: { fileName: string; relPath: string } | null = null;
	try {
		const useChunked = rendered.blob.size > CHUNKED_SAVE_THRESHOLD_BYTES;
		saved = useChunked
			? await saveLargeBlobChunked(projectId, rendered.fileName, rendered.blob)
			: await saveExportFile(projectId, rendered.fileName, rendered.blob);
		if (rendered.sidecar) {
			try {
				const sidecarChunked = rendered.sidecar.blob.size > CHUNKED_SAVE_THRESHOLD_BYTES;
				if (sidecarChunked) {
					await saveLargeBlobChunked(projectId, rendered.sidecar.fileName, rendered.sidecar.blob);
				} else {
					await saveExportFile(projectId, rendered.sidecar.fileName, rendered.sidecar.blob);
				}
			} catch (error) {
				if (saved) {
					await deleteExportFile(projectExportFilePath(projectId, saved.fileName)).catch(
						() => undefined
					);
				}
				throw error;
			}
		}
		return { ...saved, blob: rendered.blob };
	} finally {
		if (scratchFileName) {
			await discardStreamingScratch(scratchFileName).catch(() => undefined);
		}
	}
}

export function shouldUseChunkedSave(blobSize: number): boolean {
	return blobSize > CHUNKED_SAVE_THRESHOLD_BYTES;
}
