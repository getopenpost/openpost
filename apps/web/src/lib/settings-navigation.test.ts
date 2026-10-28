import { describe, expect, it } from 'vitest';
import { getSettingsDestinations, normalizeSettingsTab } from './settings-navigation';

describe('settings destination registry', () => {
	it('keeps instance destinations restricted and legacy aliases stable', () => {
		expect(
			getSettingsDestinations(false).some((destination) => destination.group === 'instance')
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
		expect(normalizeSettingsTab('social-accounts', false)).toBe('accounts');
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
				(destination) => destination.group === 'organization'
			)
		).toBe(true);
		expect(normalizeSettingsTab('plan', false, false)).toBe('general');
		expect(normalizeSettingsTab('billing', false, false)).toBe('general');
		expect(normalizeSettingsTab('organization', true, false)).toBe('general');
		expect(normalizeSettingsTab('plan', false, true)).toBe('plan');
		expect(normalizeSettingsTab('appearance', false, false)).toBe('appearance');
	});
});
