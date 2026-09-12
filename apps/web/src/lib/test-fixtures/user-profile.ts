import type { User } from '$lib/api/client';

export const userProfileDefaults = {
	avatar_url: '',
	composer_experience: 'specialized',
	display_name: 'Test user',
	password_usable: true,
	public_profile_visible_fields: null
} satisfies Pick<
	User,
	| 'avatar_url'
	| 'composer_experience'
	| 'display_name'
	| 'password_usable'
	| 'public_profile_visible_fields'
>;
