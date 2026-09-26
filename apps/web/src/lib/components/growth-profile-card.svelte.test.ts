import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import GrowthProfileCard from './growth-profile-card.svelte';
import type { components } from '$lib/api/types';

type RecommendationView = components['schemas']['RecommendationView'];

function rec(overrides: Partial<RecommendationView> = {}): RecommendationView {
	// SAFETY: the literal lists every RecommendationView field the card reads; overrides only replace whole fields.
	return {
		id: 'r1',
		workspace_id: 'ws-1',
		social_account_id: 'acc-1',
		platform: 'bluesky',
		remote_account_id: 'remote-1',
		handle: 'jane',
		display_name: 'Jane',
		bio: '',
		avatar_url: '',
		profile_url: 'https://example.com/jane',
		followers_count: 100,
		following_count: 50,
		follows_viewer: true,
		mutual_count: 0,
		mutual_exact: false,
		mutuals: [],
		signals: [],
		score: 1,
		follow_state: 'idle',
		generation_id: 'gen-1',
		created_at: new Date().toISOString(),
		updated_at: new Date().toISOString(),
		last_seen_at: new Date().toISOString(),
		...overrides
	} as RecommendationView;
}

const callbacks = () => ({
	position: 0,
	onFollow: vi.fn(),
	onDismiss: vi.fn(),
	onOpenProfile: vi.fn()
});

describe('growth profile card groups', () => {
	it('exposes the reason chips as a named group', async () => {
		const screen = await render(GrowthProfileCard, {
			recommendation: rec(),
			...callbacks()
		});

		const group = screen.getByRole('group', { name: 'Reasons' });
		await expect.element(group).toBeVisible();
		await expect.element(group.getByText('Follows you')).toBeVisible();
	});

	it('exposes the follower counts as a named group', async () => {
		const screen = await render(GrowthProfileCard, {
			recommendation: rec(),
			...callbacks()
		});

		const group = screen.getByRole('group', { name: /100 followers, 50 following/ });
		await expect.element(group).toBeVisible();
	});
});
