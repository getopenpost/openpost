export const PROTECTED_ICON_ROLES = [
	'editor-animation',
	'editor-backgrounds',
	'editor-captions',
	'editor-cut',
	'editor-effects',
	'editor-media',
	'editor-move',
	'editor-record',
	'editor-scenes',
	'editor-shapes',
	'editor-stickers',
	'editor-text',
	'editor-transitions',
	'error',
	'info',
	'loading',
	'media-audio',
	'media-file',
	'media-image',
	'media-video',
	'pause',
	'play',
	'success',
	'warning'
] as const;

export type ProtectedIconRole = (typeof PROTECTED_ICON_ROLES)[number];
