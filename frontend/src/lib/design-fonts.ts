export interface OpenPostDesignFont {
	family: string;
	label: string;
	category: 'Sans serif' | 'Serif' | 'Monospace';
}

export const openPostDesignFonts: readonly OpenPostDesignFont[] = [
	{ family: 'Geist Variable', label: 'Geist', category: 'Sans serif' },
	{ family: 'Manrope Variable', label: 'Manrope', category: 'Sans serif' },
	{ family: 'DM Sans Variable', label: 'DM Sans', category: 'Sans serif' },
	{ family: 'Space Grotesk Variable', label: 'Space Grotesk', category: 'Sans serif' },
	{ family: 'Playfair Display Variable', label: 'Playfair Display', category: 'Serif' },
	{ family: 'Source Serif 4 Variable', label: 'Source Serif 4', category: 'Serif' },
	{ family: 'Arial', label: 'Arial', category: 'Sans serif' },
	{ family: 'Georgia', label: 'Georgia', category: 'Serif' },
	{ family: 'Times New Roman', label: 'Times New Roman', category: 'Serif' },
	{ family: 'Courier New', label: 'Courier New', category: 'Monospace' }
];
