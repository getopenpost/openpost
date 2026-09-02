import { describe, expect, it } from 'vitest';
import {
	getSettingsInitialLoadPlan,
	SETTINGS_INITIAL_LOAD_PARTICIPANT,
	SettingsInitialLoadBoundary
} from './settings-initial-load.svelte';

describe('SettingsInitialLoadBoundary', () => {
	it('waits for every registered participant and stays settled during background work', () => {
		const boundary = new SettingsInitialLoadBoundary({
			key: 'accounts:workspace-a',
			participants: [
				SETTINGS_INITIAL_LOAD_PARTICIPANT.accounts,
				SETTINGS_INITIAL_LOAD_PARTICIPANT.accountProviders
			]
		});
		const accounts = boundary.register(SETTINGS_INITIAL_LOAD_PARTICIPANT.accounts);
		const providers = boundary.register(SETTINGS_INITIAL_LOAD_PARTICIPANT.accountProviders);

		expect(boundary.loading).toBe(true);
		accounts.update(false);
		expect(boundary.loading).toBe(true);
		providers.update(false);
		expect(boundary.loading).toBe(false);

		accounts.update(true);
		expect(boundary.loading).toBe(false);
	});

	it('settles an initial failure and ignores reports from the previous tab cycle', () => {
		const boundary = new SettingsInitialLoadBoundary({
			key: 'brand:workspace-a',
			participants: [SETTINGS_INITIAL_LOAD_PARTICIPANT.brand]
		});
		const staleBrand = boundary.register(SETTINGS_INITIAL_LOAD_PARTICIPANT.brand);

		staleBrand.update(false);
		expect(boundary.loading).toBe(false);

		boundary.activate({
			key: 'notifications:user-a',
			participants: [SETTINGS_INITIAL_LOAD_PARTICIPANT.notifications]
		});
		expect(boundary.loading).toBe(true);

		staleBrand.update(false);
		expect(boundary.loading).toBe(true);
		boundary.register(SETTINGS_INITIAL_LOAD_PARTICIPANT.notifications).update(false);
		expect(boundary.loading).toBe(false);
	});

	it('resets when the same tab changes scope but not for an identical plan', () => {
		const workspaceA = {
			key: 'schedule:workspace-a',
			participants: [SETTINGS_INITIAL_LOAD_PARTICIPANT.schedule]
		} as const;
		const boundary = new SettingsInitialLoadBoundary(workspaceA);
		const firstSchedule = boundary.register(SETTINGS_INITIAL_LOAD_PARTICIPANT.schedule);

		firstSchedule.update(false);
		expect(boundary.loading).toBe(false);
		boundary.activate(workspaceA);
		expect(boundary.loading).toBe(false);

		boundary.activate({
			key: 'schedule:workspace-b',
			participants: [SETTINGS_INITIAL_LOAD_PARTICIPANT.schedule]
		});
		expect(boundary.loading).toBe(true);
		firstSchedule.update(false);
		expect(boundary.loading).toBe(true);
	});
});

describe('getSettingsInitialLoadPlan', () => {
	it('owns every Settings tab with a nested cold page loader', () => {
		const scope = {
			userID: 'user-a',
			workspaceID: 'workspace-a',
			organizationID: 'organization-a'
		};

		expect(getSettingsInitialLoadPlan('accounts', scope).participants).toEqual([
			SETTINGS_INITIAL_LOAD_PARTICIPANT.accounts,
			SETTINGS_INITIAL_LOAD_PARTICIPANT.accountProviders
		]);
		expect(getSettingsInitialLoadPlan('developer', scope).participants).toEqual([
			SETTINGS_INITIAL_LOAD_PARTICIPANT.apiTokens,
			SETTINGS_INITIAL_LOAD_PARTICIPANT.mcpActivity
		]);
		expect(getSettingsInitialLoadPlan('security', scope).participants).toEqual([
			SETTINGS_INITIAL_LOAD_PARTICIPANT.security,
			SETTINGS_INITIAL_LOAD_PARTICIPANT.authSessions
		]);

		for (const tab of [
			'notifications',
			'brand',
			'reposts',
			'schedule',
			'members',
			'plan',
			'sso',
			'audit',
			'ownership',
			'instance',
			'configuration',
			'ai-prompts',
			'users',
			'instance-audit'
		] as const) {
			expect(getSettingsInitialLoadPlan(tab, scope).participants.length, tab).toBeGreaterThan(0);
		}
	});

	it('does not wait for workspace or organization reads without their scope', () => {
		const scope = { userID: 'user-a', workspaceID: '', organizationID: '' };

		expect(getSettingsInitialLoadPlan('brand', scope).participants).toEqual([]);
		expect(getSettingsInitialLoadPlan('sso', scope).participants).toEqual([]);
		expect(getSettingsInitialLoadPlan('notifications', scope).participants).toEqual([
			SETTINGS_INITIAL_LOAD_PARTICIPANT.notifications
		]);
	});
});
