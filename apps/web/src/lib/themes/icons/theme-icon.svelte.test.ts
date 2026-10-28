import { afterEach, describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import heroiconsSolid from '@openpost/ui/themes/icons/packs/heroicons-solid.generated.js';
import lucidePack from '@openpost/ui/themes/icons/packs/lucide.generated.js';
import tablerPack from '@openpost/ui/themes/icons/packs/tabler.generated.js';
import ThemeIcon from '@openpost/ui/themes/icons/theme-icon.svelte';

const originalPack = document.documentElement.getAttribute('data-theme-icon-pack');

afterEach(() => {
	if (originalPack) document.documentElement.setAttribute('data-theme-icon-pack', originalPack);
	else document.documentElement.removeAttribute('data-theme-icon-pack');
});

interface SvgNodeGeometry {
	tag: string;
	attributes: string[];
}

// Compare node geometry, not serialized markup: Svelte's @html output adds
// comment anchors and the browser may close self-closing paths differently from
// the pinned body strings, while the authored attributes stay identical.
function svgGeometry(root: Element): SvgNodeGeometry[] {
	return [...root.querySelectorAll('*')].map((element) => ({
		tag: element.tagName,
		attributes: [...element.attributes]
			.map((attribute) => `${attribute.name}=${attribute.value}`)
			.sort()
	}));
}

const geometryParser = new DOMParser();

function fixtureGeometry(body: string): SvgNodeGeometry[] {
	const parsed = geometryParser.parseFromString(
		`<svg xmlns="http://www.w3.org/2000/svg">${body}</svg>`,
		'image/svg+xml'
	);
	if (parsed.querySelector('parsererror')) throw new Error('Pinned icon body is not valid SVG');
	return svgGeometry(parsed.documentElement);
}

describe('ThemeIcon', () => {
	it('renders a labeled semantic role from the selected pack', async () => {
		const screen = render(ThemeIcon, {
			role: 'search',
			pack: 'heroicons-solid',
			label: 'Search'
		});
		const icon = screen.getByRole('img', { name: 'Search' });

		await expect.element(icon).toHaveAttribute('data-theme-icon', 'search');
		await expect.element(icon).toHaveAttribute('data-icon-pack', 'heroicons-solid');
		await expect.element(icon).toHaveAttribute('viewBox', '0 0 24 24');
		await expect
			.poll(() => svgGeometry(icon.element()))
			.toEqual(fixtureGeometry(heroiconsSolid.icons.search.body));
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
			pack: 'phosphor',
			'data-testid': 'fallback-theme-icon'
		});
		const fallback = screen.getByTestId('fallback-theme-icon');
		const icon = fallback.element();

		// The pack chunk resolves asynchronously, so the first paint must already
		// carry the embedded Lucide geometry rather than an empty icon. Phosphor is
		// imported only after this assertion so the module cannot be preloaded here.
		expect(icon.getAttribute('data-icon-pack')).toBe('phosphor');
		expect(svgGeometry(icon)).toEqual(fixtureGeometry(lucidePack.icons.settings.body));

		await expect.element(fallback).toHaveAttribute('viewBox', '0 0 256 256');
		const phosphor = await import('@openpost/ui/themes/icons/packs/phosphor.generated.js');
		await expect
			.poll(() => svgGeometry(icon))
			.toEqual(fixtureGeometry(phosphor.default.icons.settings.body));
	});

	it('follows the closest runtime scope when a theme switches', async () => {
		document.documentElement.setAttribute('data-theme-icon-pack', 'lucide');
		const rootScreen = render(ThemeIcon, {
			role: 'settings',
			'data-testid': 'root-theme-icon'
		});
		const rootIcon = rootScreen.getByTestId('root-theme-icon');
		await expect.element(rootIcon).toHaveAttribute('data-icon-pack', 'lucide');
		await expect
			.poll(() => svgGeometry(rootIcon.element()))
			.toEqual(fixtureGeometry(lucidePack.icons.settings.body));

		const host = document.createElement('div');
		host.setAttribute('data-theme-icon-pack', 'tabler');
		document.body.append(host);
		try {
			const nestedScreen = render(ThemeIcon, {
				target: host,
				props: { role: 'settings', 'data-testid': 'nested-theme-icon' }
			});
			const nestedIcon = nestedScreen.getByTestId('nested-theme-icon');
			await expect.element(nestedIcon).toHaveAttribute('data-icon-pack', 'tabler');
			await expect
				.poll(() => svgGeometry(nestedIcon.element()))
				.toEqual(fixtureGeometry(tablerPack.icons.settings.body));

			// The document pack moves the unscoped icon; the closer scope holds.
			document.documentElement.setAttribute('data-theme-icon-pack', 'heroicons-solid');
			document.documentElement.dispatchEvent(
				new CustomEvent('openpost:themechange', { bubbles: true })
			);
			await expect.element(rootIcon).toHaveAttribute('data-icon-pack', 'heroicons-solid');
			await expect
				.poll(() => svgGeometry(rootIcon.element()))
				.toEqual(fixtureGeometry(heroiconsSolid.icons.settings.body));
			await expect.element(nestedIcon).toHaveAttribute('data-icon-pack', 'tabler');
			await expect
				.poll(() => svgGeometry(nestedIcon.element()))
				.toEqual(fixtureGeometry(tablerPack.icons.settings.body));

			// Switching the closer scope moves only its own icon.
			host.setAttribute('data-theme-icon-pack', 'lucide');
			await expect.element(nestedIcon).toHaveAttribute('data-icon-pack', 'lucide');
			await expect
				.poll(() => svgGeometry(nestedIcon.element()))
				.toEqual(fixtureGeometry(lucidePack.icons.settings.body));
			await expect.element(rootIcon).toHaveAttribute('data-icon-pack', 'heroicons-solid');
		} finally {
			host.remove();
		}
	});
});
