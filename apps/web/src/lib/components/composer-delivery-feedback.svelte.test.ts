import { expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import type { components } from '$lib/api/types';
import ComposerDeliveryFeedback from './composer-delivery-feedback.svelte';

type Rendition = components['schemas']['RenditionActionOutcome'];
type Delivery = components['schemas']['ProviderDeliveryResponse'];

const rendition = (overrides: Partial<Rendition>): Rendition => ({
	id: `rendition-${String(overrides.id ?? 'base')}`,
	social_account_id: `account-${String(overrides.id ?? 'base')}`,
	target_key: String(overrides.id ?? 'base'),
	platform: 'x',
	status: 'scheduled',
	...overrides
});

const delivery = (
	targetKey: string,
	state: string,
	recoveryAction: Delivery['recovery_action'],
	overrides: Partial<Delivery> = {}
): Delivery => ({
	current_attempt_created_at: '2026-08-15T20:00:00Z',
	current_attempt_id: `attempt-${targetKey}`,
	current_attempt_number: 1,
	target_key: targetKey,
	state,
	recovery_action: recoveryAction,
	...overrides
});

it('keeps mixed destination outcomes and canonical recovery actions visible', async () => {
	const onRetry = vi.fn();
	const onCreateAnother = vi.fn();
	const screen = await render(ComposerDeliveryFeedback, {
		publicationID: 'publication-1',
		renditions: [
			rendition({
				id: 'live',
				status: 'published',
				delivery: delivery('live', 'live', 'none')
			}),
			rendition({ id: 'pending', delivery: delivery('pending', 'queued', 'none') }),
			rendition({
				id: 'failed',
				status: 'failed',
				delivery: delivery('failed', 'rejected', 'retry', {
					error_kind: 'provider_http',
					error_code: 'rate_limited',
					error_http_status: 429,
					current_attempt_number: 2
				})
			}),
			rendition({
				id: 'ambiguous',
				status: 'failed',
				delivery: delivery('ambiguous', 'ambiguous', 'reconcile')
			})
		],
		accountLabels: {
			'account-live': '@live',
			'account-pending': '@pending',
			'account-failed': '@failed',
			'account-ambiguous': '@ambiguous'
		},
		onRetry,
		onManualResolution: vi.fn(),
		onCreateAnother
	});

	await expect.element(screen.getByRole('heading', { name: 'Destination outcomes' })).toBeVisible();
	await expect
		.element(screen.getByText('1 succeeded · 1 pending · 1 failed · 1 need review'))
		.toBeVisible();
	await expect.element(screen.getByText('@failed')).toBeVisible();
	const failedCard = screen.getByRole('article').filter({ hasText: '@failed' });
	await expect.element(failedCard.getByText('Rejected', { exact: true })).toBeVisible();
	await expect.element(failedCard.getByText(/Provider attempt 2/)).toBeVisible();
	await expect.element(screen.getByText('provider_http · rate_limited')).toBeVisible();
	await failedCard.getByRole('button', { name: 'Retry destination' }).click();
	expect(onRetry).toHaveBeenCalledWith('failed');
	await expect
		.element(screen.getByRole('link', { name: 'View post' }))
		.toHaveAttribute('href', '/publications/publication-1');
	await screen.getByRole('button', { name: 'Create another' }).click();
	expect(onCreateAnother).toHaveBeenCalledOnce();
	await expect
		.element(screen.getByText('OpenPost is checking the provider before another send.'))
		.toBeVisible();
	const ambiguousCard = screen.getByRole('article').filter({ hasText: '@ambiguous' });
	await expect.element(ambiguousCard).toBeVisible();
	await expect
		.element(ambiguousCard.getByRole('button', { name: 'Retry destination' }))
		.not.toBeInTheDocument();
});
