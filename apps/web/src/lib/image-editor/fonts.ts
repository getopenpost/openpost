import { SvelteMap } from 'svelte/reactivity';
import { editorFontAssetFamily } from '$lib/editor-font-identity';
import { hasRegisteredEditorBrandFont, loadEditorFontAsset } from '$lib/editor-fonts';
import { getAuthenticatedMediaURL } from '$lib/media-url';
import { m } from '$lib/paraglide/messages';
import type { ImageEditorTextValue } from './types';

export {
	hasRegisteredEditorBrandFont as hasRegisteredImageEditorBrandFont,
	loadEditorBrandFonts as loadImageEditorBrandFonts,
	loadEditorBrandFontsWithReport as loadImageEditorBrandFontsWithReport
} from '$lib/editor-fonts';

export type { EditorBrandFontLoadReport as ImageEditorBrandFontLoadReport } from '$lib/editor-fonts';

// Notify inspectors when asynchronous registration changes the browser's FontFaceSet.
const registrations = new SvelteMap<string, number>();

export function imageEditorTextFontFamily(text: ImageEditorTextValue): string {
	return text.font_asset_id
		? editorFontAssetFamily(text.font_family, text.font_asset_id)
		: text.font_family;
}

export function hasRegisteredImageEditorTextFont(text: ImageEditorTextValue): boolean {
	const family = imageEditorTextFontFamily(text);
	void registrations.get(family);
	return hasRegisteredEditorBrandFont(
		{
			id: text.font_asset_id ?? '',
			media_id: text.font_asset_id ?? '',
			family,
			weight: text.font_weight,
			style: text.font_style ?? 'normal'
		},
		globalThis.document?.fonts ?? []
	);
}

export async function loadImageEditorTextFont(
	text: ImageEditorTextValue,
	blob?: Blob
): Promise<void> {
	if (!text.font_asset_id || hasRegisteredImageEditorTextFont(text)) return;
	if (!blob) {
		const response = await fetch(
			getAuthenticatedMediaURL(`/media/${encodeURIComponent(text.font_asset_id)}`),
			{ credentials: 'include' }
		);
		if (!response.ok) throw new Error(m.image_editor_project_media_failed());
		blob = await response.blob();
	}
	await loadEditorFontAsset({
		assetID: text.font_asset_id,
		family: text.font_family,
		weight: text.font_weight,
		style: text.font_style ?? 'normal',
		blob
	});
	const family = imageEditorTextFontFamily(text);
	registrations.set(family, (registrations.get(family) ?? 0) + 1);
}
