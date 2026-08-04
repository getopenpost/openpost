import { uploadMediaFile } from '$lib/media-upload-client';
import { createImageEditorDesign, saveImageEditorDesign } from './api';
import {
	getGuestImageEditorMediaForMigration,
	guestImageEditorMediaIDs,
	guestImageEditorMigrationTarget,
	loadGuestImageEditorDesign,
	markGuestImageEditorDesignMigrated,
	replaceGuestImageEditorMediaIDs
} from './local-persistence';

export async function migrateGuestImageEditorDesign(
	localDesignID: string,
	workspaceID: string
): Promise<{ id: string; alreadyMigrated: boolean }> {
	const existingTarget = await guestImageEditorMigrationTarget(localDesignID);
	if (existingTarget) {
		return { id: existingTarget, alreadyMigrated: true };
	}

	const local = await loadGuestImageEditorDesign(localDesignID);
	const created = await createImageEditorDesign(workspaceID, {
		title: local.document.title,
		preset_key: local.document.preset_key,
		width_px: local.document.width_px,
		height_px: local.document.height_px,
		client_request_id: localDesignID
	});
	const replacements = new Map<string, string>();
	for (const mediaID of guestImageEditorMediaIDs(local.document)) {
		const media = await getGuestImageEditorMediaForMigration(mediaID);
		const uploaded = await uploadMediaFile({
			workspaceId: workspaceID,
			file: new File([media.blob], media.name, { type: media.mimeType }),
			source: media.provenance ? 'stock_import' : 'upload',
			stockProvenance: media.provenance
		});
		replacements.set(mediaID, uploaded.id);
	}

	const importedDocument = replaceGuestImageEditorMediaIDs(local.document, replacements);
	const saved = await saveImageEditorDesign(created.id, created.revision, importedDocument);
	await markGuestImageEditorDesignMigrated(localDesignID, saved.id);
	return { id: saved.id, alreadyMigrated: false };
}
