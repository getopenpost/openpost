import { duplicateImageEditorDesign, saveImageEditorDesign } from './api';
import { cloneImageEditorPage } from './document';
import type { ImageEditorDocument, ImageEditorDocumentResponse } from './types';

export interface ImageEditorConflictCopyDependencies {
	duplicate(workspaceID: string, sourceID: string): Promise<ImageEditorDocumentResponse>;
	save(
		workspaceID: string,
		id: string,
		revision: number,
		document: ImageEditorDocument
	): Promise<ImageEditorDocumentResponse>;
}

const defaultDependencies: ImageEditorConflictCopyDependencies = {
	duplicate: duplicateImageEditorDesign,
	save: saveImageEditorDesign
};

/**
 * Preserves one local authored snapshot, including its title, as a separate cloud design.
 */
export async function saveImageEditorConflictCopy(
	workspaceID: string,
	sourceID: string,
	localDocument: ImageEditorDocument,
	dependencies: ImageEditorConflictCopyDependencies = defaultDependencies
): Promise<ImageEditorDocumentResponse> {
	const copyDocument = structuredClone(localDocument);
	copyDocument.pages = copyDocument.pages.map((page) => cloneImageEditorPage(page, page.name));
	const duplicate = await dependencies.duplicate(workspaceID, sourceID);
	return dependencies.save(workspaceID, duplicate.id, duplicate.revision, copyDocument);
}
