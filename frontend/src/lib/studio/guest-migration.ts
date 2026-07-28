import { uploadMediaFile } from '$lib/media-upload-client';
import { createStudioDesign, saveStudioDesign } from './api';
import {
	getGuestStudioMediaForMigration,
	guestStudioMediaIDs,
	guestStudioMigrationTarget,
	loadGuestStudioDesign,
	markGuestStudioDesignMigrated,
	replaceGuestStudioMediaIDs
} from './local-persistence';

export async function migrateGuestStudioDesign(
	localDesignID: string,
	workspaceID: string
): Promise<{ id: string; alreadyMigrated: boolean }> {
	const existingTarget = await guestStudioMigrationTarget(localDesignID);
	if (existingTarget) {
		return { id: existingTarget, alreadyMigrated: true };
	}

	const local = await loadGuestStudioDesign(localDesignID);
	const created = await createStudioDesign(workspaceID, {
		title: local.document.title,
		preset_key: local.document.preset_key,
		width_px: local.document.width_px,
		height_px: local.document.height_px,
		client_request_id: localDesignID
	});
	const replacements = new Map<string, string>();
	for (const mediaID of guestStudioMediaIDs(local.document)) {
		const media = await getGuestStudioMediaForMigration(mediaID);
		const uploaded = await uploadMediaFile({
			workspaceId: workspaceID,
			file: new File([media.blob], media.name, { type: media.mimeType }),
			source: 'upload'
		});
		replacements.set(mediaID, uploaded.id);
	}

	const importedDocument = replaceGuestStudioMediaIDs(local.document, replacements);
	const saved = await saveStudioDesign(created.id, created.revision, importedDocument);
	await markGuestStudioDesignMigrated(localDesignID, saved.id);
	return { id: saved.id, alreadyMigrated: false };
}
