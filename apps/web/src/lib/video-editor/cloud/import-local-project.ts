import { browser } from '$app/environment';
import { z } from 'zod';
import { uploadMediaFile } from '$lib/media-upload-client';
import type { Project } from '$lib/video-editor/project/types';
import { hashBlob } from '$lib/video-editor/project-bundle/bundle-utils';
import { resolveMediaBlob } from '$lib/video-editor/media/resolve-media-blob';
import { getMediaForProject } from '$lib/video-editor/workspace-fs/project-media';
import type { CloudVideoProject, CloudVideoProjectRepository } from './project-repository';

const IMPORT_IDS_KEY = 'openpost:video-project-local-imports:v1';
const storedImportIdsSchema = z.record(z.string(), z.string());

function importId(workspaceId: string, localProjectId: string): string {
	if (!browser) return crypto.randomUUID();
	const ids = storedImportIds(localStorage.getItem(IMPORT_IDS_KEY));
	const key = `${workspaceId}:${localProjectId}`;
	const existing = ids[key];
	if (existing) return existing;
	const created = crypto.randomUUID();
	localStorage.setItem(IMPORT_IDS_KEY, JSON.stringify({ ...ids, [key]: created }));
	return created;
}

function storedImportIds(raw: string | null): { [key: string]: string } {
	if (!raw) return {};
	try {
		const result = storedImportIdsSchema.safeParse(JSON.parse(raw));
		return result.success ? result.data : {};
	} catch {
		return {};
	}
}

/** Import is intentionally idempotent. The local project and its files remain untouched. */
export async function importLocalProjectToCloud(
	project: Project,
	repository: CloudVideoProjectRepository<Project>
): Promise<CloudVideoProject<Project>> {
	const cloudId = importId(repository.workspaceId, project.id);
	const media = await getMediaForProject(project.id);
	const preparedMedia = await Promise.all(
		media.map(async (item) => {
			const blob = await resolveMediaBlob(item);
			const contentHash = item.contentHash ?? (await hashBlob(blob));
			return { item, blob, contentHash };
		})
	);
	const cloudProject = await repository.createWithId(cloudId, project.name, project);
	const reservedMedia = await Promise.all(
		preparedMedia.map(async ({ item, blob, contentHash }) => ({
			item,
			blob,
			contentHash,
			projectAssetId: await repository.reserveAsset(cloudProject.id, {
				stableMediaId: item.id,
				fileName: item.fileName,
				mimeType: item.mimeType || blob.type || 'application/octet-stream',
				size: blob.size,
				sha256: contentHash
			})
		}))
	);
	for (const { item, blob, contentHash, projectAssetId } of reservedMedia) {
		await uploadMediaFile({
			workspaceId: repository.workspaceId,
			file: new File([blob], item.fileName, {
				type: item.mimeType || blob.type
			}),
			source: 'video_editor_source',
			assetKind: 'project_asset',
			retentionClass: 'temporary',
			projectAssetId,
			clientSHA256: contentHash,
			prepareVideo: false
		});
	}
	return repository.get(cloudProject.id);
}
