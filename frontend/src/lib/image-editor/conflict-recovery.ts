import { duplicateImageEditorDesign, saveImageEditorDesign } from './api';
import { cloneImageEditorPage } from './document';
import type { ImageEditorDocument, ImageEditorDocumentResponse } from './types';

export interface ImageEditorConflictCopyDependencies {
	duplicate(sourceID: string): Promise<ImageEditorDocumentResponse>;
	save(
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
 * Preserves the local side of a revision conflict as a separate cloud design.
 * The duplicate endpoint supplies a unique copy title; retain it when replacing
 * the duplicate's document with the local, unsaved content.
 */
export async function saveImageEditorConflictCopy(
	sourceID: string,
	localDocument: ImageEditorDocument,
	dependencies: ImageEditorConflictCopyDependencies = defaultDependencies
): Promise<ImageEditorDocumentResponse> {
	const duplicate = await dependencies.duplicate(sourceID);
	const copyDocument = structuredClone(localDocument);
	copyDocument.title = duplicate.document.title;
	copyDocument.pages = localDocument.pages.map((page) => cloneImageEditorPage(page, page.name));
	return dependencies.save(duplicate.id, duplicate.revision, copyDocument);
}
