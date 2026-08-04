import { getAuthenticatedMediaURL } from '$lib/media-url';
import type { ImageEditorBrandFont, ImageEditorBrandKit } from './types';

interface RegisteredFontFace {
	family: string;
	style: string;
	weight: string;
}

function normalizedFamily(value: string): string {
	return value.trim().replace(/^(['"])(.*)\1$/, '$2');
}

export function hasRegisteredImageEditorBrandFont(
	font: ImageEditorBrandFont,
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

export async function loadImageEditorBrandFonts(brand: ImageEditorBrandKit): Promise<void> {
	if (!globalThis.document?.fonts) return;
	for (const font of brand.fonts) {
		const family = font.css_family || font.family;
		if (hasRegisteredImageEditorBrandFont(font, document.fonts)) continue;
		const source = getAuthenticatedMediaURL(`/media/${font.media_id}`);
		const face = new FontFace(family, `url("${source}")`, {
			weight: String(font.weight),
			style: font.style
		});
		await face.load();
		document.fonts.add(face);
	}
	await document.fonts.ready;
}
