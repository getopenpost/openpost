import { expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { m } from '$lib/paraglide/messages';
import LottieBrowserPanel from './lottie-browser-panel.svelte';

it('exposes the lottie browser as a named group', async () => {
	const screen = await render(LottieBrowserPanel, {
		projectId: 'project-1',
		oninserted: vi.fn(),
		fetchAnimations: () => new Promise<never>(() => {})
	});

	const group = screen.getByRole('group', { name: m.video_editor_lottiefiles() });
	await expect.element(group).toBeVisible();
	await expect
		.element(group.getByRole('textbox', { name: m.video_editor_lottiefiles_search() }))
		.toBeVisible();
});

it('offers an honest retry after service unavailability without importing an animation', async () => {
	const fetchAnimations = vi
		.fn()
		.mockRejectedValueOnce(new Error('LottieFiles request failed (503).'))
		.mockResolvedValueOnce({
			items: [
				{
					id: 'recovered',
					name: 'Recovered animation',
					lottieUrl: 'https://example.com/animation.json',
					gifUrl: null,
					bgColor: null,
					author: 'Fixture creator',
					authorPath: null
				}
			],
			endCursor: null,
			hasNextPage: false,
			totalCount: 1
		});
	const importAnimation = vi.fn();
	const screen = await render(LottieBrowserPanel, {
		projectId: 'recovery',
		fetchAnimations,
		importAnimation
	});
	try {
		await expect
			.element(screen.getByText('LottieFiles request failed (503).', { exact: true }))
			.toBeVisible();
		await screen
			.getByRole('button', { name: m.video_editor_lottiefiles_retry(), exact: true })
			.click();
		await expect
			.element(
				screen.getByRole('button', {
					name: `${m.video_editor_lottiefiles_add()}: Recovered animation`,
					exact: true
				})
			)
			.toBeVisible();
		await expect
			.element(screen.getByText('LottieFiles request failed (503).', { exact: true }))
			.not.toBeInTheDocument();
		expect(fetchAnimations).toHaveBeenCalledTimes(2);
		expect(importAnimation).not.toHaveBeenCalled();
	} finally {
		await screen.unmount();
	}
});
