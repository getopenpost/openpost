import { expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import ColorPaletteTabs from './color-palette-tabs.svelte';

const palettes = [
	{ id: 'primaries', label: 'Primaries' },
	{ id: 'curves', label: 'Curves' },
	{ id: 'effects', label: 'Effects' },
	{ id: 'keyframes', label: 'Keyframes' }
] as const;

it('reports palette selection through its view-only callback', async () => {
	const onselect = vi.fn();
	const screen = await render(ColorPaletteTabs, {
		palettes,
		active: 'primaries',
		label: 'Color palettes',
		onselect
	});

	await screen.getByRole('tab', { name: 'Curves' }).click();

	expect(onselect).toHaveBeenCalledExactlyOnceWith('curves');
});

it('moves and selects with the tablist arrow keys', async () => {
	const onselect = vi.fn();
	const screen = await render(ColorPaletteTabs, {
		palettes,
		active: 'primaries',
		label: 'Color palettes',
		onselect
	});
	const primaries = screen.getByRole('tab', { name: 'Primaries' });
	const curves = screen.getByRole('tab', { name: 'Curves' });

	primaries.element().focus();
	primaries
		.element()
		.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));

	expect(onselect).toHaveBeenCalledExactlyOnceWith('curves');
	expect(curves.element()).toBe(document.activeElement);
});
