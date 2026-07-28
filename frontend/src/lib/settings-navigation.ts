export const settingsTabIDs = [
	'profile',
	'security',
	'developer',
	'instance',
	'general',
	'brand',
	'schedule',
	'media',
	'members',
	'sso',
	'plan'
] as const;

export type SettingsTabID = (typeof settingsTabIDs)[number];
export type SettingsDestinationID = SettingsTabID | 'accounts';
