import { expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import PublicationDeliveryCard from './publication-delivery-card.svelte';

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
	await expect.element(screen.getByText(/Provider attempt 2/)).toBeVisible();
	await screen.getByRole('button', { name: 'Retry destination' }).click();
	expect(onRetry).toHaveBeenCalledWith('rendition-1');
});

it('does not offer a stale retry after the destination has been queued again', async () => {
	const screen = await render(PublicationDeliveryCard, {
		rendition: {
			...baseRendition,
			status: 'scheduled',
			delivery: {
				target_key: 'x',
				current_attempt_id: 'attempt-1',
				current_attempt_number: 1,
				current_attempt_created_at: '2026-08-13T10:00:00Z',
				state: 'rejected',
				recovery_action: 'retry'
			}
		},
		onRetry: vi.fn()
	});

	await expect
		.element(screen.getByRole('button', { name: 'Retry destination' }))
		.not.toBeInTheDocument();
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

it.each([{ resolvable: true }, { resolvable: false }])(
	'offers review for a manual-resolution outcome only when the caller can resolve it',
	async ({ resolvable }) => {
		const onManualResolution = vi.fn();
		const rendition = {
			...baseRendition,
			delivery: {
				target_key: 'x',
				state: 'manual_resolution',
				current_attempt_id: 'attempt-4',
				current_attempt_number: 4,
				current_attempt_created_at: '2026-08-13T10:00:00Z',
				recovery_action: 'manual_resolution'
			}
		};
		const screen = resolvable
			? await render(PublicationDeliveryCard, {
					rendition,
					onRetry: vi.fn(),
					onManualResolution
				})
			: await render(PublicationDeliveryCard, { rendition, onRetry: vi.fn() });

		await expect.element(screen.getByText('Manual review required')).toBeVisible();
		const review = screen.getByRole('button', { name: 'Review destination' });
		if (resolvable) {
			await review.click();
			expect(onManualResolution).toHaveBeenCalledWith('rendition-1');
		} else {
			await expect.element(review).not.toBeInTheDocument();
		}
		await expect
			.element(screen.getByRole('button', { name: 'Retry destination' }))
			.not.toBeInTheDocument();
	}
);
