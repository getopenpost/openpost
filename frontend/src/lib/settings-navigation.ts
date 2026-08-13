export const settingsTabIDs = [
	'profile',
	'notifications',
	'security',
	'developer',
	'instance',
	'configuration',
	'users',
	'general',
	'brand',
	'accounts',
	'reposts',
	'schedule',
	'members',
	'sso',
	'plan'
] as const;

export type SettingsTabID = (typeof settingsTabIDs)[number];
export type SettingsDestinationID = SettingsTabID;
