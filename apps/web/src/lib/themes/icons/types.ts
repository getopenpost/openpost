import type { ThemeIconPackId, ThemeIconRole } from '../contracts.js';

export interface ThemeIconData {
	body: string;
	viewBox: string;
}

export interface ThemeIconPack {
	id: ThemeIconPackId;
	icons: Record<ThemeIconRole, ThemeIconData>;
}
