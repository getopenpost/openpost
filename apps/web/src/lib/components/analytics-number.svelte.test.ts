import { expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import AnalyticsNumber from './analytics-number.svelte';

it('distinguishes unavailable metrics from measured zero and formats updated totals in the chosen locale', async () => {
	const screen = await render(AnalyticsNumber, {
		value: null,
		locale: 'en-US'
	});
	await expect.element(screen.getByText('—', { exact: true })).toBeVisible();
	await screen.rerender({ value: 0, locale: 'en-US' });
	await expect.element(screen.getByRole('img', { name: '0', exact: true })).toBeVisible();
	await screen.rerender({ value: 1240, locale: 'en-US' });
	await expect.element(screen.getByRole('img', { name: '1.2K', exact: true })).toBeVisible();
	await screen.rerender({ value: 1234567, locale: 'pt-PT' });
	await expect.element(screen.getByRole('img', { name: '1,2 M', exact: true })).toBeVisible();
	await screen.rerender({ value: null, locale: 'pt-PT' });
	await expect.element(screen.getByText('—', { exact: true })).toBeVisible();
});
