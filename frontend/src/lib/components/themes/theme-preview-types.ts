export const THEME_PREVIEW_SCENES = [
	'shell',
	'dashboard',
	'cards',
	'composer',
	'calendar',
	'tables',
	'settings',
	'forms',
	'dialog',
	'notices',
	'empty',
	'loading',
	'image-editor',
	'video-editor'
] as const;

export type ThemePreviewScene = (typeof THEME_PREVIEW_SCENES)[number];
export type ThemePreviewViewport = 'desktop' | 'phone' | 'phone-small';
