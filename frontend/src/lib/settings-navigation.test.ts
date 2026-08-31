import { describe, expect, it } from 'vitest';
import {
	getSettingsDestinations,
	normalizeSettingsTab,
	settingsTabIDs
} from './settings-navigation';

describe('settings destination registry', () => {
	it('does not register duplicate settings destinations', () => {
		expect(new Set(settingsTabIDs).size).toBe(settingsTabIDs.length);
	});

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
});
