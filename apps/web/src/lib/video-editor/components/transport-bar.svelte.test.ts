import { expect, it } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import Fixture from './transport-bar.fixture.svelte';
import '../../../routes/layout.css';

it('keeps a 44px play target inside the narrow transport bar', async () => {
	await page.viewport(640, 450);
	try {
		const screen = await render(Fixture, { width: 640 });
		const transport = document.querySelector('[data-video-transport]');
		if (!(transport instanceof HTMLElement)) throw new Error('Expected transport bar');
		const play = screen.getByRole('button', { name: 'Play', exact: true }).element();
		if (!(play instanceof HTMLButtonElement)) throw new Error('Expected play button');

		expect(play.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
		expect(transport.getBoundingClientRect().height).toBeGreaterThanOrEqual(
			play.getBoundingClientRect().height + 2
		);
		const more = screen.getByRole('button', { name: 'More actions', exact: true });
		await expect.element(more).toBeVisible();
		more.element().focus();
		await userEvent.keyboard('{Enter}');
		await expect
			.element(screen.getByRole('menuitem', { name: 'Step one frame forward', exact: true }))
			.toBeVisible();
		await expect.element(screen.getByRole('menuitem', { name: 'Fit', exact: true })).toBeVisible();
		await userEvent.keyboard('{Escape}');
		await expect.element(more).toHaveFocus();
	} finally {
		await page.viewport(1280, 900);
	}
});

it('shows secondary transport controls when the Program container is wide', async () => {
	const screen = await render(Fixture, { width: 900 });

	await expect
		.element(screen.getByRole('button', { name: 'Go to start', exact: true }))
		.toBeVisible();
	await expect.element(screen.getByRole('button', { name: 'Stop', exact: true })).toBeVisible();
	expect(screen.getByRole('button', { name: 'More actions', exact: true }).query()).toBeNull();
});
