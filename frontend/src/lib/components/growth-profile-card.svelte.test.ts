/* eslint-disable anti-slop/require-safety-comment-for-type-assertion */
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import GrowthProfileCard from './growth-profile-card.svelte';
import type { components } from '$lib/api/types';

type RecommendationView = components['schemas']['RecommendationView'];

function rec(overrides: Partial<RecommendationView> = {}): RecommendationView {
	return {
		id: 'r1',
		workspace_id: 'ws-1',
		social_account_id: 'acc-1',
		platform: 'bluesky',
		remote_account_id: 'remote-1',
		handle: 'jane',
		display_name: 'Jane Smith',
		bio: 'Building tiny tools.',
		avatar_url: '',
		profile_url: 'https://bsky.app/profile/jane',
		followers_count: 2100,
		following_count: 1400,
		follows_viewer: true,
		mutual_count: 2,
		mutual_exact: true,
		mutuals: [
			{ RemoteID: '1', Handle: 'theo', DisplayName: 'Theo', AvatarURL: '' },
			{ RemoteID: '2', Handle: 'jane2', DisplayName: 'Jane', AvatarURL: '' }
		] as never,
		signals: ['friends_of_friends'],
		score: 1,
		follow_state: 'idle',
		generation_id: 'gen-1',
		created_at: new Date().toISOString(),
		updated_at: new Date().toISOString(),
		last_seen_at: new Date().toISOString(),
		...overrides
	} as RecommendationView;
}

describe('GrowthProfileCard', () => {
	it('renders compact card with accessible follow, open-profile and dismiss actions', async () => {
		const onFollow = vi.fn();
		const onDismiss = vi.fn();
		const onOpenProfile = vi.fn();
		const screen = await render(GrowthProfileCard, {
			recommendation: rec({ follow_state: 'idle' }),
			position: 1,
			onFollow,
			onDismiss,
			onOpenProfile
		});

		await expect.element(screen.getByRole('article')).toBeInTheDocument();
		const followBtn = screen.getByRole('button', { name: /Follow @jane/i });
		await expect.element(followBtn).toBeInTheDocument();
		await expect.element(followBtn).toBeEnabled();

		const openBtn = screen.getByRole('button', { name: /Open profile for @jane/i });
		await expect.element(openBtn).toBeInTheDocument();

		const dismissBtn = screen.getByRole('button', { name: /Dismiss recommendation for @jane/i });
		await expect.element(dismissBtn).toBeInTheDocument();
	});

	it('shows Following… disabled when pending', async () => {
		const screen = await render(GrowthProfileCard, {
			recommendation: rec({ follow_state: 'pending' }),
			position: 2,
			onFollow: vi.fn(),
			onDismiss: vi.fn(),
			onOpenProfile: vi.fn()
		});
		const btn = screen.getByRole('button', { name: /Following…/i });
		await expect.element(btn).toBeDisabled();
	});

	it('shows Requested disabled when requested', async () => {
		const screen = await render(GrowthProfileCard, {
			recommendation: rec({ id: 'r2', follow_state: 'requested' }),
			position: 2,
			onFollow: vi.fn(),
			onDismiss: vi.fn(),
			onOpenProfile: vi.fn()
		});
		const btn = screen.getByRole('button', { name: /Requested/i });
		await expect.element(btn).toBeDisabled();
	});

	it('shows Following disabled when following', async () => {
		const screen = await render(GrowthProfileCard, {
			recommendation: rec({ id: 'r3', follow_state: 'following' }),
			position: 3,
			onFollow: vi.fn(),
			onDismiss: vi.fn(),
			onOpenProfile: vi.fn()
		});
		const btn = screen.getByRole('button', { name: 'Following @jane' });
		await expect.element(btn).toBeDisabled();
	});

	it('calls handlers on interaction', async () => {
		const onFollow = vi.fn();
		const onDismiss = vi.fn();
		const onOpenProfile = vi.fn();
		const screen = await render(GrowthProfileCard, {
			recommendation: rec(),
			position: 1,
			onFollow,
			onDismiss,
			onOpenProfile
		});

		await screen.getByRole('button', { name: /Follow @jane/i }).click();
		expect(onFollow).toHaveBeenCalledWith('r1');

		await screen.getByRole('button', { name: /Open profile for @jane/i }).click();
		expect(onOpenProfile).toHaveBeenCalled();

		await screen.getByRole('button', { name: /Dismiss recommendation for @jane/i }).click();
		expect(onDismiss).toHaveBeenCalledWith('r1');
	});

	it('uses theme-token bordered card without decorative shadows', async () => {
		const screen = await render(GrowthProfileCard, {
			recommendation: rec(),
			position: 1,
			onFollow: vi.fn(),
			onDismiss: vi.fn(),
			onOpenProfile: vi.fn()
		});
		const article = screen.getByTestId('growth-profile-card');
		await expect.element(article).toHaveClass('border');
		await expect.element(article).toHaveClass('bg-card');
		await expect.element(article).not.toHaveClass('shadow');
	});
});
