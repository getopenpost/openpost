import { expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import ComposerDeliveryFeedback from './composer-delivery-feedback.svelte';

vi.mock('$lib/i18n', () => ({ getLocaleTag: () => 'en-US' }));
vi.mock('$lib/paraglide/messages', () => ({
	m: new Proxy(
		{},
		{
			get: (_target, key) => (params?: Record<string, unknown>) =>
				({
					composer_delivery_outcomes: 'Destination outcomes',
					composer_delivery_summary: `${params?.succeeded} succeeded · ${params?.pending} pending · ${params?.failed} failed · ${params?.manual} need review`,
					workspace_activation_view_publication: 'View publication',
					workspace_activation_create_another: 'Create another',
					publication_delivery_queued: 'Queued',
					publication_delivery_live: 'Live',
					publication_delivery_rejected: 'Rejected',
					publication_delivery_ambiguous: 'Outcome needs reconciliation',
					publication_delivery_retry: 'Retry destination',
					publication_delivery_reconcile: 'OpenPost is checking the provider before another send.',
					publication_delivery_target: `Target ${params?.target}`,
					publication_delivery_failure_detail: `${params?.kind} · ${params?.code}`
				})[String(key)] ?? String(key)
		}
	)
}));

const rendition = (overrides: Record<string, unknown>) => ({
	id: `rendition-${String(overrides.id ?? 'base')}`,
	publication_id: 'publication-1',
	social_account_id: `account-${String(overrides.id ?? 'base')}`,
	target_key: String(overrides.id ?? 'base'),
	platform: 'x',
	profile: 'short_text',
	output_profile: 'x.post',
	format_locked: false,
	body: 'A launch note',
	title: '',
	description: '',
	settings: {},
	status: 'scheduled',
	error_retryable: false,
	segments: [],
	media: [],
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
				delivery: { state: 'live', recovery_action: 'none' }
			}),
			rendition({ id: 'pending', delivery: { state: 'queued', recovery_action: 'none' } }),
			rendition({
				id: 'failed',
				status: 'failed',
				delivery: {
					state: 'rejected',
					error_kind: 'provider_http',
					error_code: 'rate_limited',
					recovery_action: 'retry'
				}
			}),
			rendition({
				id: 'ambiguous',
				status: 'failed',
				delivery: { state: 'ambiguous', recovery_action: 'reconcile' }
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
	await expect.element(screen.getByText('provider_http · rate_limited')).toBeVisible();
	await screen.getByRole('button', { name: 'Retry destination' }).click();
	expect(onRetry).toHaveBeenCalledWith('failed');
	await expect
		.element(screen.getByRole('link', { name: 'View publication' }))
		.toHaveAttribute('href', '/publications/publication-1');
	await screen.getByRole('button', { name: 'Create another' }).click();
	expect(onCreateAnother).toHaveBeenCalledOnce();
	await expect
		.element(screen.getByText('OpenPost is checking the provider before another send.'))
		.toBeVisible();
});

it('does not offer recovery from an older attempt after a destination is queued', async () => {
	const screen = await render(ComposerDeliveryFeedback, {
		publicationID: 'publication-1',
		renditions: [
			rendition({
				id: 'queued-again',
				status: 'scheduled',
				delivery: { state: 'rejected', recovery_action: 'retry' }
			})
		],
		onRetry: vi.fn(),
		onManualResolution: vi.fn(),
		onCreateAnother: vi.fn()
	});

	await expect
		.element(screen.getByRole('button', { name: 'Retry destination' }))
		.not.toBeInTheDocument();
});
