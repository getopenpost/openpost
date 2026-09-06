import type { ImageEditorDocument, ImageEditorPage } from './types';

export interface ImageEditorExportResumeEntry {
	mediaID: string;
	fingerprint: string;
}

export type ImageEditorExportResumeLedger = Record<string, ImageEditorExportResumeEntry>;
export interface ImageEditorReusableExports {
	[pageID: string]: string;
}

export function imageEditorPageExportFingerprint(
	document: ImageEditorDocument,
	page: ImageEditorPage
): string {
	const { preview_media_id: _preview, latest_export_media_id: _latest, ...renderedPage } = page;
	const source = JSON.stringify({
		width: document.width_px,
		height: document.height_px,
		exportDefaults: document.export_defaults,
		page: renderedPage
	});
	let hash = 2166136261;
	for (let index = 0; index < source.length; index++) {
		hash ^= source.charCodeAt(index);
		hash = Math.imul(hash, 16777619);
	}
	return (hash >>> 0).toString(36);
}

export function reusableImageEditorExports(
	document: ImageEditorDocument,
	ledger: ImageEditorExportResumeLedger
): ImageEditorReusableExports {
	const reusable: ImageEditorReusableExports = {};
	for (const page of document.pages) {
		const entry = ledger[page.id];
		if (entry?.fingerprint === imageEditorPageExportFingerprint(document, page)) {
			reusable[page.id] = entry.mediaID;
		}
	}
	return reusable;
}
