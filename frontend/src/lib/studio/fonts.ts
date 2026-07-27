import { getAuthenticatedMediaURL } from '$lib/media-url';
import type { StudioBrandKit } from './types';

export async function loadStudioBrandFonts(brand: StudioBrandKit): Promise<void> {
	if (!globalThis.document?.fonts) return;
	for (const font of brand.fonts) {
		const family = font.css_family || font.family;
		const descriptor = `${font.style} ${font.weight} 12px "${family}"`;
		if (document.fonts.check(descriptor)) continue;
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
