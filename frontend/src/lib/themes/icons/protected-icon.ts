export const PROTECTED_ICON_ROLES = [
	'error',
	'info',
	'loading',
	'pause',
	'play',
	'success',
	'warning'
] as const;

export type ProtectedIconRole = (typeof PROTECTED_ICON_ROLES)[number];
