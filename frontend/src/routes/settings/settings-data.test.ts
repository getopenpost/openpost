import { describe, expect, it } from 'vitest';
import {
	apiTokenCustomExpiryMax,
	apiTokenCustomExpiryMin,
	apiTokenExpiresAt,
	activeReauthProviderID,
	buildProfileUpdateBody,
	isAPITokenScope
} from './settings-data';

describe('profile update capability boundary', () => {
	it.each([null, false] as const)(
		'omits public-profile changes when capability is %s',
		(publicProfilesAvailable) => {
			expect(
				buildProfileUpdateBody({
					displayName: 'New private name',
					username: 'new-private-handle',
					publicProfilesAvailable,
					publicProfileEnabled: true,
					publicProfileVisibleFields: ['workspaces']
				})
			).toEqual({
				display_name: 'New private name',
				username: 'new-private-handle'
			});
		}
	);

	it('includes explicit visibility only after the server advertises the capability', () => {
		expect(
			buildProfileUpdateBody({
				displayName: 'Public name',
				username: 'public-handle',
				publicProfilesAvailable: true,
				publicProfileEnabled: true,
				publicProfileVisibleFields: ['avatar']
			})
		).toEqual({
			display_name: 'Public name',
			username: 'public-handle',
			public_profile_enabled: true,
			public_profile_visible_fields: ['avatar']
		});
	});
});

describe('linked identity reauthentication selection', () => {
	it('skips disabled providers even when they sort before an active identity', () => {
		expect(
			activeReauthProviderID([
				{
					id: 'disabled-identity',
					provider_id: 'disabled-provider',
					provider_name: 'A disabled provider',
					active: false,
					created_at: '2026-08-01T12:00:00Z'
				},
				{
					id: 'active-identity',
					provider_id: 'active-provider',
					provider_name: 'Z active provider',
					active: true,
					created_at: '2026-08-01T12:00:00Z'
				}
			])
		).toBe('active-provider');
	});
});

describe('API token expiry boundary', () => {
	it('keeps every custom picker date inside the server maximum', () => {
		const now = new Date('2026-08-09T12:00:00.000Z');
		expect(apiTokenCustomExpiryMin(now)).toBe('2026-08-10');
		expect(apiTokenCustomExpiryMax(now)).toBe('2027-08-08');

		const customMaximum = new Date(apiTokenExpiresAt('custom', apiTokenCustomExpiryMax(now), now));
		expect(customMaximum.getTime()).toBeGreaterThan(now.getTime());
		expect(customMaximum.getTime()).toBeLessThanOrEqual(now.getTime() + 365 * 24 * 60 * 60 * 1000);
	});

	it('retains the exact one-year preset', () => {
		const now = new Date('2026-08-09T12:00:00.000Z');
		expect(apiTokenExpiresAt('365', '', now)).toBe('2027-08-09T12:00:00.000Z');
	});
});

describe('API token scope contract', () => {
	it('accepts only scopes exposed by the generated create-token contract', () => {
		expect(isAPITokenScope('api:read')).toBe(true);
		expect(isAPITokenScope('cli:full')).toBe(true);
		expect(isAPITokenScope('admin:full')).toBe(false);
		expect(isAPITokenScope('api:read,api:write')).toBe(false);
	});
});
