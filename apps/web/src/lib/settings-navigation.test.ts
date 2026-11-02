import { describe, expect, it } from 'vitest';
import {
	getSettingsDestinations,
	normalizeSettingsTab,
	settingsTabRedirect,
	type SettingsDestinationGroup
} from './settings-navigation';

describe('settings destination registry', () => {
	it('keeps instance destinations restricted and legacy aliases stable', () => {
		expect(
			getSettingsDestinations(false).some((destination) => destination.id === 'instance')
		).toBe(false);
		expect(getSettingsDestinations(true).some((destination) => destination.id === 'instance')).toBe(
			true
		);
		expect(
			getSettingsDestinations(true).some((destination) => destination.id === 'ai-prompts')
		).toBe(true);
		expect(normalizeSettingsTab('instance', false)).toBe('general');
		expect(normalizeSettingsTab('ai-prompts', false)).toBe('general');
		expect(normalizeSettingsTab('instance', true)).toBe('instance');
		expect(normalizeSettingsTab('ai-prompts', true)).toBe('ai-prompts');
		expect(normalizeSettingsTab('billing', false)).toBe('plan');
		expect(normalizeSettingsTab('team', false)).toBe('members');
		expect(normalizeSettingsTab('account', false)).toBe('profile');
		expect(normalizeSettingsTab('tokens', false)).toBe('developer');
		expect(normalizeSettingsTab('workspace', false)).toBe('general');
		expect(normalizeSettingsTab('media', false)).toBe('general');
	});

	it('keeps moved destinations addressable and out of the navigation', () => {
		expect(normalizeSettingsTab('accounts', false)).toBe('accounts');
		expect(normalizeSettingsTab('social-accounts', false)).toBe('accounts');
		expect(normalizeSettingsTab('reposts', false)).toBe('reposts');
		expect(normalizeSettingsTab('app-branding', false)).toBe('brand');
		for (const moved of ['accounts', 'reposts', 'app-branding'] as const) {
			expect(getSettingsDestinations(true).some((destination) => destination.id === moved)).toBe(
				false
			);
		}
	});

	it('redirects moved tabs to their current homes', () => {
		const url = new URL(
			'https://openpost.test/settings?tab=accounts&account_id=acc-1&workspace_id=ws-1#section'
		);
		expect(settingsTabRedirect('accounts', url)).toBe(
			'/accounts?account_id=acc-1&workspace_id=ws-1#section'
		);
		expect(settingsTabRedirect('reposts', url)).toBe('/workflows/reposts');
		expect(settingsTabRedirect('brand', url)).toBeNull();
		expect(settingsTabRedirect('general', url)).toBeNull();
	});

	it('groups destinations into You, Workspace, Plan, and Advanced', () => {
		const byGroup = (group: SettingsDestinationGroup) =>
			getSettingsDestinations(true)
				.filter((destination) => destination.group === group)
				.map((destination) => destination.id);
		expect(byGroup('you')).toEqual(['profile', 'notifications', 'security', 'developer']);
		expect(byGroup('workspace')).toEqual(['general', 'brand', 'schedule', 'members']);
		expect(byGroup('plan')).toEqual(['plan']);
		expect(byGroup('advanced')).toEqual([
			'appearance',
			'sso',
			'audit',
			'ownership',
			'instance',
			'configuration',
			'ai-prompts',
			'users',
			'instance-audit'
		]);
	});

	it('hides hosted billing outside cloud editions', () => {
		expect(getSettingsDestinations(false).some((destination) => destination.id === 'plan')).toBe(
			true
		);
		expect(
			getSettingsDestinations(false, {}, false).some((destination) => destination.id === 'plan')
		).toBe(false);
		expect(
			getSettingsDestinations(false, {}, false).some(
				(destination) => destination.group === 'advanced'
			)
		).toBe(true);
		expect(normalizeSettingsTab('plan', false, false)).toBe('general');
		expect(normalizeSettingsTab('billing', false, false)).toBe('general');
		expect(normalizeSettingsTab('organization', true, false)).toBe('general');
		expect(normalizeSettingsTab('plan', false, true)).toBe('plan');
		expect(normalizeSettingsTab('appearance', false, false)).toBe('appearance');
	});
});
