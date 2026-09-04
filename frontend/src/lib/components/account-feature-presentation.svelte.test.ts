import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import type { components } from '$lib/api/types';
import AccountFeaturePresentation from './account-feature-presentation.svelte';

type Feature = components['schemas']['FeatureStateResponse'];

function feature(name: Feature['feature'], overrides: Partial<Feature> = {}): Feature {
	return {
		workspace_id: 'workspace-1',
		social_account_id: 'account-1',
		platform: 'bluesky',
		feature: name,
		supported: true,
		availability: 'available',
		reason_code: 'available',
		required_scopes: [],
		missing_scopes: [],
		unavailable_reason: '',
		stored_exists: true,
		stored_enabled: false,
		effective_enabled: false,
		...overrides
	};
}

describe('account feature presentation', () => {
	it('explains unavailable features without allowing a change', async () => {
		const screen = await render(AccountFeaturePresentation, {
			accountId: 'account-1',
			features: [
				feature('grow', {
					availability: 'missing_scope',
					reason_code: 'missing_scope',
					required_scopes: ['graph.read'],
					missing_scopes: ['graph.read']
				})
			],
			selections: { grow: false },
			mode: 'details',
			onToggle: vi.fn()
		});

		await expect.element(screen.getByLabelText('Grow')).toBeDisabled();
		await expect
			.element(screen.getByText(/Needs more provider permission: graph\.read/u))
			.toBeVisible();
	});

	it('keeps plan restrictions distinct from provider permission', async () => {
		const screen = await render(AccountFeaturePresentation, {
			accountId: 'account-1',
			features: [
				feature('analytics', {
					availability: 'plan_restricted',
					reason_code: 'plan_restricted'
				})
			],
			selections: { analytics: false },
			mode: 'details',
			onToggle: vi.fn()
		});

		await expect.element(screen.getByLabelText('Analytics')).toBeDisabled();
		await expect
			.element(screen.getByText(/current plan does not include this feature/u))
			.toBeVisible();
	});
});
