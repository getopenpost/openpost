export const settingsTabIDs = [
	'profile',
	'security',
	'developer',
	'general',
	'schedule',
	'media',
	'members',
	'plan'
] as const;

export type SettingsTabID = (typeof settingsTabIDs)[number];
export type SettingsDestinationID = SettingsTabID | 'accounts';
