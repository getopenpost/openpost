import type { ThemeFontFace } from './contracts.js';

export const BUNDLED_THEME_FONT_IDS = [
	'geist',
	'geist-mono',
	'manrope',
	'dm-sans',
	'inter',
	'inter-tight',
	'space-grotesk',
	'playfair-display',
	'source-serif-4',
	'orbitron',
	'anton',
	'bebas-neue',
	'roboto',
	'roboto-slab'
] as const;
export type BundledThemeFontId = (typeof BUNDLED_THEME_FONT_IDS)[number];

export interface BundledThemeFont {
	id: BundledThemeFontId;
	label: string;
	family: string;
	fallbacks: string[];
	category: 'sans-serif' | 'serif' | 'monospace' | 'display';
	weights: number[];
}

export const BUNDLED_THEME_FONTS = {
	geist: {
		id: 'geist',
		label: 'Geist',
		family: 'Geist Variable',
		fallbacks: ['Geist', 'system-ui', '-apple-system', 'sans-serif'],
		category: 'sans-serif',
		weights: [100, 200, 300, 400, 500, 600, 700, 800, 900]
	},
	'geist-mono': {
		id: 'geist-mono',
		label: 'Geist Mono',
		family: 'Geist Mono Variable',
		fallbacks: ['Geist Mono', 'ui-monospace', 'SFMono-Regular', 'monospace'],
		category: 'monospace',
		weights: [100, 200, 300, 400, 500, 600, 700, 800, 900]
	},
	manrope: {
		id: 'manrope',
		label: 'Manrope',
		family: 'Manrope Variable',
		fallbacks: ['Manrope', 'system-ui', 'sans-serif'],
		category: 'sans-serif',
		weights: [200, 300, 400, 500, 600, 700, 800]
	},
	'dm-sans': {
		id: 'dm-sans',
		label: 'DM Sans',
		family: 'DM Sans Variable',
		fallbacks: ['DM Sans', 'system-ui', 'sans-serif'],
		category: 'sans-serif',
		weights: [100, 200, 300, 400, 500, 600, 700, 800, 900]
	},
	inter: {
		id: 'inter',
		label: 'Inter',
		family: 'Inter Variable',
		fallbacks: ['Inter', 'system-ui', 'sans-serif'],
		category: 'sans-serif',
		weights: [100, 200, 300, 400, 500, 600, 700, 800, 900]
	},
	'inter-tight': {
		id: 'inter-tight',
		label: 'Inter Tight',
		family: 'Inter Tight Variable',
		fallbacks: ['Inter Tight', 'system-ui', 'sans-serif'],
		category: 'sans-serif',
		weights: [100, 200, 300, 400, 500, 600, 700, 800, 900]
	},
	'space-grotesk': {
		id: 'space-grotesk',
		label: 'Space Grotesk',
		family: 'Space Grotesk Variable',
		fallbacks: ['Space Grotesk', 'system-ui', 'sans-serif'],
		category: 'sans-serif',
		weights: [300, 400, 500, 600, 700]
	},
	'playfair-display': {
		id: 'playfair-display',
		label: 'Playfair Display',
		family: 'Playfair Display Variable',
		fallbacks: ['Playfair Display', 'Georgia', 'serif'],
		category: 'serif',
		weights: [400, 500, 600, 700, 800, 900]
	},
	'source-serif-4': {
		id: 'source-serif-4',
		label: 'Source Serif 4',
		family: 'Source Serif 4 Variable',
		fallbacks: ['Source Serif 4', 'Georgia', 'serif'],
		category: 'serif',
		weights: [200, 300, 400, 500, 600, 700, 800, 900]
	},
	orbitron: {
		id: 'orbitron',
		label: 'Orbitron',
		family: 'Orbitron Variable',
		fallbacks: ['Orbitron', 'system-ui', 'sans-serif'],
		category: 'display',
		weights: [400, 500, 600, 700, 800, 900]
	},
	anton: {
		id: 'anton',
		label: 'Anton',
		family: 'Anton',
		fallbacks: ['Arial', 'sans-serif'],
		category: 'display',
		weights: [400]
	},
	'bebas-neue': {
		id: 'bebas-neue',
		label: 'Bebas Neue',
		family: 'Bebas Neue',
		fallbacks: ['Arial', 'sans-serif'],
		category: 'display',
		weights: [400]
	},
	roboto: {
		id: 'roboto',
		label: 'Roboto',
		family: 'Roboto',
		fallbacks: ['Arial', 'sans-serif'],
		category: 'sans-serif',
		weights: [400, 500, 600, 700]
	},
	'roboto-slab': {
		id: 'roboto-slab',
		label: 'Roboto Slab',
		family: 'Roboto Slab',
		fallbacks: ['Georgia', 'serif'],
		category: 'serif',
		weights: [400, 500, 700]
	}
} satisfies Record<BundledThemeFontId, BundledThemeFont>;

export const BUNDLED_THEME_FONT_FAMILIES = BUNDLED_THEME_FONT_IDS.map(
	(id) => BUNDLED_THEME_FONTS[id].family
);

export function bundledThemeFont(id: BundledThemeFontId): BundledThemeFont {
	return BUNDLED_THEME_FONTS[id];
}

export function isAvailableThemeFontFamily(
	family: string,
	uploadedFonts: readonly ThemeFontFace[]
): boolean {
	return (
		BUNDLED_THEME_FONT_FAMILIES.some((candidate) => candidate === family) ||
		uploadedFonts.some((font) => font.family === family)
	);
}
