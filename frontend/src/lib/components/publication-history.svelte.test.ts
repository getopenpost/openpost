import { beforeEach, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import PublicationHistory from './publication-history.svelte';

const mocks = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock('$lib/api/client', () => ({ client: { GET: mocks.get } }));
vi.mock('$lib/i18n', () => ({ getLocaleTag: () => 'en-US' }));
vi.mock('$lib/paraglide/messages', () => ({
	m: new Proxy(
		{},
		{
			get: (_target, key) => (params?: Record<string, unknown>) =>
				({
					image_editor_version_history: 'Version history',
					publication_history_effective_outcome: 'Latest effective destination outcome',
					publication_delivery_rejected: 'Rejected',
					publication_delivery_target: `Target ${params?.target}`,
					publication_delivery_attempt_number: `Provider attempt ${params?.number} · ${params?.date}`,
					publication_delivery_reconciled: `Reconciled ${params?.date}`
				})[String(key)] ?? String(key)
		}
	)
}));

beforeEach(() => {
	mocks.get.mockReset();
});

it('places the latest effective outcome at its attempt or reconciliation time', async () => {
	mocks.get.mockResolvedValue({
		data: [
			{
				id: 'failed-attempt-1',
				workspace_id: 'workspace-1',
				publication_id: 'publication-1',
				rendition_id: 'rendition-1',
				type: 'failed',
				status: 'failed',
				summary: 'Provider delivery failed',
				actor: { kind: 'system' },
				destination: {
					rendition_id: 'rendition-1',
					social_account_id: 'account-1',
					target_key: 'x',
					platform: 'x',
					label: '@openpost',
					status: 'failed'
				},
				delivery: {
					target_key: 'x',
					state: 'rejected',
					current_attempt_id: 'attempt-2',
					current_attempt_number: 2,
					current_attempt_created_at: '2026-08-14T11:05:00Z',
					last_reconciled_at: '2026-08-14T11:06:00Z',
					recovery_action: 'retry'
				},
				superseded: true,
				created_at: '2026-08-14T11:01:00Z'
			}
		],
		error: null,
		response: new Response(null, { headers: { 'X-Has-More': 'false' } })
	});

	const screen = await render(PublicationHistory, { publicationId: 'publication-1' });
	await expect.element(screen.getByText('Latest effective destination outcome')).toBeVisible();

	const items = [...document.querySelectorAll('ol > li')].map((item) => item.textContent ?? '');
	expect(items).toHaveLength(2);
	expect(items[0]).toContain('Latest effective destination outcome');
	expect(items[0]).toContain('Provider attempt 2');
	expect(items[0]).toContain('Reconciled');
	expect(items[1]).toContain('Provider delivery failed');
});
