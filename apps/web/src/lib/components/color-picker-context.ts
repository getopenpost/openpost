import { getContext, setContext } from 'svelte';

export interface ColorPickerPreset {
	id: string;
	name: string;
	value: string;
}

export interface ColorPickerPaletteSource {
	readonly brandColors: readonly ColorPickerPreset[];
}

const COLOR_PICKER_PALETTE = Symbol('openpost-color-picker-palette');

export function provideColorPickerPalette(source: ColorPickerPaletteSource): void {
	setContext(COLOR_PICKER_PALETTE, source);
}

export function useOptionalColorPickerPalette(): ColorPickerPaletteSource | undefined {
	return getContext<ColorPickerPaletteSource | undefined>(COLOR_PICKER_PALETTE);
}
