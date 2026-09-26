import { imageEditorPageDimensions } from './page-dimensions';

export const IMAGE_EDITOR_EXPORT_WORKING_MEMORY_LIMIT = 512 * 1024 * 1024;

export interface ImageEditorExportBudget {
	pageCount: number;
	pixelsPerPage: number;
	estimatedWorkingBytes: number;
	allowed: boolean;
}

export function imageEditorExportBudget(
	document: {
		width_px: number;
		height_px: number;
		pages: ReadonlyArray<{ id: string; width_px?: number; height_px?: number }>;
	},
	pageIDs: readonly string[]
): ImageEditorExportBudget {
	const selectedPages = document.pages.filter((page) => pageIDs.includes(page.id));
	const pageCount = selectedPages.length;
	const pagePixels = selectedPages.map((page) => {
		const { width, height } = imageEditorPageDimensions(document, page);
		return Math.max(0, width) * Math.max(0, height);
	});
	const pixelsPerPage = Math.max(0, ...pagePixels);
	const totalPixels = pagePixels.reduce((total, pixels) => total + pixels, 0);
	// One live canvas and encoder copy, retained encoded pages, then ZIP input and output.
	const retainedOutputBytes = totalPixels * 5;
	const estimatedWorkingBytes = pixelsPerPage * 9 + retainedOutputBytes * (pageCount > 1 ? 3 : 1);
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
