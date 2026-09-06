import { getAuthenticatedMediaURL } from '$lib/media-url';
import { editorFontAssetFamily } from '$lib/editor-font-identity';

export interface EditorBrandFont {
	id: string;
	media_id: string;
	family: string;
	css_family?: string;
	/** Family persisted by the editor when preview CSS uses a runtime alias. */
	selection_family?: string;
	weight: number;
	style: 'normal' | 'italic';
}

interface EditorBrandFontKit {
	fonts: EditorBrandFont[];
}

interface RegisteredFontFace {
	family: string;
	style: string;
	weight: string;
}

function normalizedFamily(value: string): string {
	return value.trim().replace(/^(['"])(.*)\1$/, '$2');
}

export function hasRegisteredEditorBrandFont(
	font: EditorBrandFont,
	faces: Iterable<RegisteredFontFace>
): boolean {
	const family = normalizedFamily(font.css_family || font.family);
	return [...faces].some(
		(face) =>
			normalizedFamily(face.family) === family &&
			face.style === font.style &&
			face.weight === String(font.weight)
	);
}

async function loadEditorBrandFont(font: EditorBrandFont): Promise<void> {
	if (hasRegisteredEditorBrandFont(font, document.fonts)) return;
	const family = font.css_family || font.family;
	const source = getAuthenticatedMediaURL(`/media/${font.media_id}`);
	const face = new FontFace(family, `url("${source}")`, {
		weight: String(font.weight),
		style: font.style
	});
	await face.load();
	document.fonts.add(face);
}

export async function loadEditorFontAsset(input: {
	assetID: string;
	family: string;
	weight?: number;
	style?: 'normal' | 'italic';
	blob: Blob;
}): Promise<void> {
	if (!globalThis.document?.fonts) return;
	const registeredFamily = editorFontAssetFamily(input.family, input.assetID);
	const font = {
		id: input.assetID,
		media_id: input.assetID,
		family: registeredFamily,
		weight: input.weight ?? 400,
		style: input.style ?? 'normal'
	} satisfies EditorBrandFont;
	if (hasRegisteredEditorBrandFont(font, document.fonts)) return;
	const face = new FontFace(registeredFamily, await input.blob.arrayBuffer(), {
		weight: String(font.weight),
		style: font.style
	});
	await face.load();
	document.fonts.add(face);
}

export async function loadEditorBrandFonts(brand: EditorBrandFontKit): Promise<void> {
	if (!globalThis.document?.fonts) return;
	for (const font of brand.fonts) {
		await loadEditorBrandFont(font);
	}
	await document.fonts.ready;
}

export interface EditorBrandFontLoadReport {
	loaded: string[];
	failed: Array<{ mediaID: string; message: string }>;
}

export async function loadEditorBrandFontsWithReport(
	brand: EditorBrandFontKit
): Promise<EditorBrandFontLoadReport> {
	const report: EditorBrandFontLoadReport = { loaded: [], failed: [] };
	if (!globalThis.document?.fonts) return report;
	for (const font of brand.fonts) {
		try {
			await loadEditorBrandFont(font);
			report.loaded.push(font.media_id);
		} catch (cause) {
			report.failed.push({
				mediaID: font.media_id,
				message: cause instanceof Error ? cause.message : 'Font could not be loaded.'
			});
		}
	}
	await document.fonts.ready;
	return report;
}
