export const settingsTabIDs = [
	'profile',
	'security',
	'developer',
	'instance',
	'users',
	'general',
	'brand',
	'schedule',
	'members',
	'sso',
	'plan'
] as const;

export type SettingsTabID = (typeof settingsTabIDs)[number];
export type SettingsDestinationID = SettingsTabID | 'accounts';
