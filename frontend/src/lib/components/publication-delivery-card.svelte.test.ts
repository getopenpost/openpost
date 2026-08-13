import { expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import PublicationDeliveryCard from './publication-delivery-card.svelte';

vi.mock('$lib/i18n', () => ({ getLocaleTag: () => 'en-US' }));
vi.mock('$lib/paraglide/messages', () => ({
	m: new Proxy(
		{},
		{
			get: (_target, key) => (params?: Record<string, unknown>) =>
				({
					publication_delivery_rejected: 'Rejected',
					publication_delivery_ambiguous: 'Outcome needs reconciliation',
					publication_delivery_retry: 'Retry destination',
					publication_delivery_reconcile: 'OpenPost is checking the provider before another send.',
					publication_delivery_manual_resolution: 'Manual review required',
					publication_delivery_manual_resolution_help:
						'Confirm whether the post exists before taking another action.',
					publication_delivery_review_destination: 'Review destination',
					publication_delivery_attempted: `Attempted ${params?.date}`,
					publication_delivery_failure_detail: `${params?.kind} · ${params?.code}`
				})[String(key)] ?? String(key)
		}
	)
}));

const baseRendition = {
	id: 'rendition-1',
	platform: 'x',
	target_key: 'x',
	status: 'failed'
};

it('attaches retryable failure evidence and retry to the exact destination', async () => {
	const onRetry = vi.fn();
	const screen = await render(PublicationDeliveryCard, {
		rendition: {
			...baseRendition,
			delivery: {
				target_key: 'x',
				state: 'rejected',
				current_attempt_id: 'attempt-2',
				current_attempt_number: 2,
				current_attempt_created_at: '2026-08-13T10:00:00Z',
				error_kind: 'provider_http',
				error_code: 'rate_limited',
				error_http_status: 429,
				recovery_action: 'retry'
			}
		},
		onRetry
	});

	await expect.element(screen.getByText('Rejected')).toBeVisible();
	await expect.element(screen.getByText(/provider_http.*rate_limited/)).toBeVisible();
	await expect.element(screen.getByText(/Attempted/)).toBeVisible();
	await screen.getByRole('button', { name: 'Retry destination' }).click();
	expect(onRetry).toHaveBeenCalledWith('rendition-1');
});

it('does not offer replay while an ambiguous attempt is being reconciled', async () => {
	const screen = await render(PublicationDeliveryCard, {
		rendition: {
			...baseRendition,
			delivery: {
				target_key: 'x',
				state: 'ambiguous',
				current_attempt_id: 'attempt-3',
				current_attempt_number: 3,
				current_attempt_created_at: '2026-08-13T10:00:00Z',
				recovery_action: 'reconcile'
			}
		},
		onRetry: vi.fn()
	});

	await expect
		.element(screen.getByText('OpenPost is checking the provider before another send.'))
		.toBeVisible();
	await expect
		.element(screen.getByRole('button', { name: 'Retry destination' }))
		.not.toBeInTheDocument();
});

it('offers explicit review instead of replay for a manual-resolution outcome', async () => {
	const onManualResolution = vi.fn();
	const screen = await render(PublicationDeliveryCard, {
		rendition: {
			...baseRendition,
			delivery: {
				target_key: 'x',
				state: 'manual_resolution',
				current_attempt_id: 'attempt-4',
				current_attempt_number: 4,
				current_attempt_created_at: '2026-08-13T10:00:00Z',
				recovery_action: 'manual_resolution'
			}
		},
		onRetry: vi.fn(),
		onManualResolution
	});

	await expect.element(screen.getByText('Manual review required')).toBeVisible();
	await screen.getByRole('button', { name: 'Review destination' }).click();
	expect(onManualResolution).toHaveBeenCalledWith('rendition-1');
	await expect
		.element(screen.getByRole('button', { name: 'Retry destination' }))
		.not.toBeInTheDocument();
});
