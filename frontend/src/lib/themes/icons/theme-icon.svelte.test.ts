import { afterEach, describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import ThemeIcon from './theme-icon.svelte';

const originalPack = document.documentElement.getAttribute('data-theme-icon-pack');

afterEach(() => {
	if (originalPack) document.documentElement.setAttribute('data-theme-icon-pack', originalPack);
	else document.documentElement.removeAttribute('data-theme-icon-pack');
});

describe('ThemeIcon', () => {
	it('renders a labeled semantic role from the selected pack', async () => {
		const screen = render(ThemeIcon, {
			role: 'search',
			pack: 'heroicons-solid',
			label: 'Search'
		});
		const icon = screen.getByRole('img', { name: 'Search' });

		await expect.element(icon).toHaveAttribute('data-theme-icon', 'search');
		await expect.element(icon).not.toHaveAttribute('data-loading');
		await expect.element(icon).toHaveAttribute('viewBox', '0 0 24 24');
	});

	it('keeps decorative icons out of the accessibility tree', async () => {
		const screen = render(ThemeIcon, {
			role: 'settings',
			pack: 'tabler',
			'data-testid': 'theme-icon'
		});
		const icon = screen.getByTestId('theme-icon');

		await expect.element(icon).toHaveAttribute('aria-hidden', 'true');
	});

	it('renders the Workshop fallback while a selected pack is not loaded', async () => {
		const screen = render(ThemeIcon, {
			role: 'settings',
			pack: 'tabler',
			'data-testid': 'fallback-theme-icon'
		});
		const icon = screen.getByTestId('fallback-theme-icon');

		await expect.element(icon).not.toBeEmptyDOMElement();
		await expect.element(icon).not.toHaveAttribute('data-loading');
	});

	it('follows the closest runtime scope when a theme switches', async () => {
		document.documentElement.setAttribute('data-theme-icon-pack', 'lucide');
		const screen = render(ThemeIcon, {
			role: 'settings',
			'data-testid': 'scoped-theme-icon'
		});
		const icon = screen.getByTestId('scoped-theme-icon');

		await expect.element(icon).toHaveAttribute('data-icon-pack', 'lucide');
		document.documentElement.setAttribute('data-theme-icon-pack', 'tabler');
		document.documentElement.dispatchEvent(
			new CustomEvent('openpost:themechange', { bubbles: true })
		);
		await expect.element(icon).toHaveAttribute('data-icon-pack', 'tabler');
	});
});
