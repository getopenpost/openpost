import type { EditorStyleDefinition } from './preferences';
import { openPostDesignFonts } from '$lib/design-fonts';
import { registeredEditorFontSources } from '$lib/editor-fonts';
import { editorFontAssetFamily } from '$lib/editor-font-identity';
import { EditorAgentOperationError } from './browser-relay';
import type { ImageEditorTextValue } from '$lib/image-editor/types';
import type { TextStyleFields } from '$lib/video-editor/project/types';
type TextStyle = EditorStyleDefinition['typography'];

export function observedStyle(
	texts: TextStyle[],
	captions: TextStyle[],
	projectId: string,
	revision: string
): EditorStyleDefinition {
	const mostCommon = (entries: TextStyle[]): TextStyle => {
		const counts = new Map<string, { value: TextStyle; count: number }>();
		for (const value of entries) {
			const key = JSON.stringify(value);
			const entry = counts.get(key);
			if (entry) entry.count++;
			else counts.set(key, { value, count: 1 });
		}
		return [...counts.values()].toSorted((a, b) => b.count - a.count)[0]?.value ?? {};
	};
	const palette = [
		...new Set(
			[...texts, ...captions]
				.map((text) => text.color)
				.filter((color): color is string =>
					Boolean(color && /^#[\da-f]{6}([\da-f]{2})?$/i.test(color))
				)
		)
	].slice(0, 8);
	return {
		typography: mostCommon(texts),
		captions: mostCommon(captions),
		palette,
		guidance: [],
		library: [],
		source_project_id: projectId,
		source_revision: revision,
		interpretations:
			texts.length + captions.length > 1
				? [
						'Typography uses the most frequent exact authored text style. Mixed text styles remain unchanged unless explicitly restyled.'
					]
				: []
	};
}
export function videoStylePatch(style: TextStyle): TextStyleFields {
	const patch: TextStyleFields = {};
	if (style.font_family) {
		patch.fontFamily = style.font_family;
		patch.fontAssetId = style.font_asset_id;
	}
	if (style.font_size) patch.fontSize = style.font_size;
	if (style.color) patch.color = style.color;
	if (style.align) patch.textAlign = style.align;
	return patch;
}

export function validateStyleFont(
	style: TextStyle,
	available: Array<{ id: string; family: string }>
): void {
	if (style.font_asset_id) {
		if (
			!style.font_family ||
			!available.some(
				(font) => font.id === style.font_asset_id && font.family === style.font_family
			) ||
			!registeredEditorFontSources(editorFontAssetFamily(style.font_family, style.font_asset_id))
				.length
		)
			throw new EditorAgentOperationError(
				'missing_source',
				'Import this exact font through the project library before applying its style'
			);
		return;
	}
	if (
		style.font_family &&
		!openPostDesignFonts.some(
			(font) => font.family === style.font_family || font.label === style.font_family
		)
	)
		throw new EditorAgentOperationError(
			'unsupported',
			'Choose an available design font or an exact imported font asset'
		);
}
export function imageStylePatch(
	text: ImageEditorTextValue,
	style: TextStyle
): ImageEditorTextValue {
	const patch = { ...text };
	if (style.font_family) {
		patch.font_family = style.font_family;
		patch.font_asset_id = style.font_asset_id;
	}
	if (style.font_size) patch.font_size = style.font_size;
	if (style.color) {
		patch.color = style.color;
		patch.runs = text.runs?.map((run) => ({ ...run, color: style.color }));
	}
	if (style.align) patch.align = style.align;
	return patch;
}
