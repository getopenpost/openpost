import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import ProtectedIcon from './protected-icon.svelte';

describe('ProtectedIcon', () => {
	it('keeps status and media glyphs outside the selected theme pack', async () => {
		const screen = await render(ProtectedIcon, { icon: 'success', class: 'status-mark' });
		const icon = screen.container.querySelector('svg');

		expect(icon).not.toBeNull();
		expect(icon?.getAttribute('data-protected-icon')).toBe('success');
		expect(icon?.getAttribute('data-theme-icon')).toBeNull();
		expect(icon?.getAttribute('data-icon-pack')).toBeNull();
		expect(icon?.getAttribute('aria-hidden')).toBe('true');
	});
});
