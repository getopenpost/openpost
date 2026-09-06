export interface OpenPostDesignFont {
	family: string;
	label: string;
	category: 'Sans serif' | 'Serif' | 'Monospace';
}

export const openPostDesignFonts: readonly OpenPostDesignFont[] = [
	{ family: 'Geist Variable', label: 'Geist', category: 'Sans serif' },
	{ family: 'Manrope Variable', label: 'Manrope', category: 'Sans serif' },
	{ family: 'DM Sans Variable', label: 'DM Sans', category: 'Sans serif' },
	{ family: 'Inter Variable', label: 'Inter', category: 'Sans serif' },
	{
		family: 'Inter Tight Variable',
		label: 'Inter Tight',
		category: 'Sans serif'
	},
	{
		family: 'Space Grotesk Variable',
		label: 'Space Grotesk',
		category: 'Sans serif'
	},
	{
		family: 'Playfair Display Variable',
		label: 'Playfair Display',
		category: 'Serif'
	},
	{
		family: 'Source Serif 4 Variable',
		label: 'Source Serif 4',
		category: 'Serif'
	},
	{ family: 'Roboto', label: 'Roboto', category: 'Sans serif' },
	{ family: 'Roboto Slab', label: 'Roboto Slab', category: 'Serif' },
	{ family: 'Anton', label: 'Anton', category: 'Sans serif' },
	{ family: 'Bebas Neue', label: 'Bebas Neue', category: 'Sans serif' },
	{ family: 'Orbitron Variable', label: 'Orbitron', category: 'Sans serif' },
	{ family: 'Arial', label: 'Arial', category: 'Sans serif' },
	{ family: 'Georgia', label: 'Georgia', category: 'Serif' },
	{ family: 'Times New Roman', label: 'Times New Roman', category: 'Serif' },
	{ family: 'Courier New', label: 'Courier New', category: 'Monospace' }
];
