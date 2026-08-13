import type { ImageEditorDocument } from './types';

export const IMAGE_EDITOR_EXPORT_WORKING_MEMORY_LIMIT = 512 * 1024 * 1024;

export interface ImageEditorExportBudget {
	pageCount: number;
	pixelsPerPage: number;
	estimatedWorkingBytes: number;
	allowed: boolean;
}

export function imageEditorExportBudget(
	document: Pick<ImageEditorDocument, 'width_px' | 'height_px' | 'pages'>,
	pageIDs: readonly string[]
): ImageEditorExportBudget {
	const pageCount = document.pages.filter((page) => pageIDs.includes(page.id)).length;
	const pixelsPerPage = Math.max(0, document.width_px) * Math.max(0, document.height_px);
	// Canvas backing store + encoder copy + a conservative compressed-output allowance.
	const perPageWorkingBytes = pixelsPerPage * 9;
	const retainedOutputBytes = pixelsPerPage * Math.min(pageCount, 35);
	const estimatedWorkingBytes = perPageWorkingBytes + retainedOutputBytes;
	return {
		pageCount,
		pixelsPerPage,
		estimatedWorkingBytes,
		allowed:
			pageCount > 0 &&
			pixelsPerPage > 0 &&
			estimatedWorkingBytes <= IMAGE_EDITOR_EXPORT_WORKING_MEMORY_LIMIT
	};
}
