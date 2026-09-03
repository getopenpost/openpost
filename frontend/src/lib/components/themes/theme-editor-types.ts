import type {
	ThemeAssetSlot,
	ThemeManifest,
	ThemeMotionRecipeName,
	ThemeSchemeManifest,
	ThemeTypographyRole
} from '$lib/themes';
import type { ThemeEditorSection } from './theme-editor-model';

export type ThemeEditorPanel = ThemeEditorSection | 'icons' | 'assets' | 'revisions';

export interface ThemeRevisionItem {
	revision: number;
	label: string;
	publishedAt: string;
	publishedBy?: string;
	current?: boolean;
}

export interface ThemeValidationIssue {
	path: string;
	message: string;
}

export interface ThemeFontUploadInput {
	family: string;
	weight: number;
	style: 'normal' | 'italic';
	display: 'swap' | 'fallback' | 'optional';
	licenseAcknowledged: boolean;
}

export interface ThemeAssetUploadInput {
	slot: ThemeAssetSlot;
	alt: string;
}

export type ThemeValueUpdater = (
	section: ThemeEditorSection,
	key: string,
	value: string | number
) => void;

export type ThemeTypographyUpdater = (
	role: ThemeTypographyRole,
	key: keyof ThemeSchemeManifest['typography'][ThemeTypographyRole],
	value: string | string[] | number
) => void;

export type ThemeMotionUpdater = (
	recipe: ThemeMotionRecipeName,
	key: keyof ThemeSchemeManifest['motion'][ThemeMotionRecipeName],
	value: string | number
) => void;

export interface ThemeResourceActions {
	uploadFont?: (
		file: File,
		input: ThemeFontUploadInput,
		currentDraft: ThemeManifest
	) => ThemeManifest | Promise<ThemeManifest>;
	uploadAsset?: (
		file: File,
		input: ThemeAssetUploadInput,
		currentDraft: ThemeManifest
	) => ThemeManifest | Promise<ThemeManifest>;
	remove?: (
		resourceID: string,
		currentDraft: ThemeManifest
	) => ThemeManifest | Promise<ThemeManifest>;
}
