import collection from '@iconify-json/heroicons/icons.json';
import type { ThemeIconRole } from '../../contracts.js';
import { createThemeIconPack } from './create-pack.js';
import { heroiconsNames } from './heroicons-names.js';

// SAFETY: heroiconsNames is exhaustive, and this transformation preserves every semantic role key.
const names = Object.fromEntries(
	Object.entries(heroiconsNames).map(([role, name]) => [role, `${name}-solid`])
) as Record<ThemeIconRole, string>;

export default createThemeIconPack('heroicons-solid', collection, names);
