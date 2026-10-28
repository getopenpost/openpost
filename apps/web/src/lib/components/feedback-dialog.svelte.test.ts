import { beforeEach, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import { QueryClientProvider } from '@tanstack/svelte-query';
import { client } from '$lib/api/client';
import { queryClient } from '$lib/query/client';
import { ui } from '$lib/stores/ui.svelte';
import FeedbackDialog from './feedback-dialog.svelte';
import '../../routes/layout.css';

const testPage = vi.hoisted(() => ({
	url: new URL('http://localhost/'),
	route: { id: '/' }
}));
// Standalone component tests have no SvelteKit router; provide its public URL state.
// oxlint-disable-next-line anti-slop/no-module-mocking
vi.mock('$app/state', () => ({ page: testPage }));
const getMock = vi.spyOn(client, 'GET');

const config = {
	enabled: true,
	recipient: 'OpenPost team',
	support_url: '',
	app_version: 'test',
	max_message_characters: 4000,
	max_screenshot_bytes: 1_048_576,
	diagnostic_categories: ['app version and page path']
};

beforeEach(() => {
	queryClient.clear();
	ui.closeFeedback();
	getMock.mockReset();
	getMock.mockImplementation(async () => {
		// SAFETY: This fixture supplies the feedback config shape read by the dialog.
		return { data: config, response: new Response() } as never;
	});
});

async function renderOpenDialog() {
	ui.openFeedback();
	return await render(
		FeedbackDialog,
		{},
		{ wrapper: QueryClientProvider, wrapperProps: { client: queryClient } }
	);
}

it('keeps category radios out of the label layout without removing keyboard access', async () => {
	const screen = await renderOpenDialog();
	// The selected-state styling lives on the label: each radio input must
	// occupy zero layout space, otherwise the label text sits off-center.
	// toHaveStyle reads the real computed style in the browser, so this fails
	// if the primitive's size classes ever win over the neutralizing ones again.
	for (const name of ['Bug', 'Idea', 'Question']) {
		const radio = screen.getByRole('radio', { name });
		await expect.element(radio).toHaveStyle({ width: '0px', height: '0px' });
		await expect.element(radio).not.toBeDisabled();
	}
	// Mouse and keyboard users drive the layout-neutral radios through the
	// visible label: clicking label text activates the wrapped control, and
	// arrow keys move between radios in the group.
	await screen.getByText('Bug', { exact: true }).click();
	await expect.element(screen.getByRole('radio', { name: 'Bug' })).toHaveFocus();
	await userEvent.keyboard('{ArrowRight}');
	await expect.element(screen.getByRole('radio', { name: 'Idea' })).toBeChecked();
});
