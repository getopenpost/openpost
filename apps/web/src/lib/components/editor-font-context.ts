import { getContext, setContext } from 'svelte';
import type { EditorBrandFont } from '$lib/editor-fonts';

export interface EditorFontSelection {
	family: string;
	assetID?: string;
	weight?: number;
	style?: 'normal' | 'italic';
}

interface EditorFontCatalog {
	readonly brandFonts: EditorBrandFont[];
	prepareSelection?: (selection: EditorFontSelection) => Promise<EditorFontSelection | null>;
}

const EDITOR_FONT_CATALOG = Symbol('editor-font-catalog');

export function provideEditorFontCatalog(catalog: EditorFontCatalog): void {
	setContext(EDITOR_FONT_CATALOG, catalog);
}

export function useEditorFontCatalog(): EditorFontCatalog | undefined {
	return getContext<EditorFontCatalog | undefined>(EDITOR_FONT_CATALOG);
}
