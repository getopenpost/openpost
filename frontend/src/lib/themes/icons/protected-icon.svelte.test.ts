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

	it.each([
		'media-image',
		'media-video',
		'media-audio',
		'media-file',
		'editor-animation',
		'editor-backgrounds',
		'editor-captions',
		'editor-cut',
		'editor-effects',
		'editor-media',
		'editor-move',
		'editor-record',
		'editor-scenes',
		'editor-shapes',
		'editor-stickers',
		'editor-text',
		'editor-transitions'
	] as const)('renders the protected %s glyph without a theme pack identity', async (role) => {
		const screen = await render(ProtectedIcon, { icon: role });
		const icon = screen.container.querySelector(`[data-protected-icon="${role}"]`);

		expect(icon).not.toBeNull();
		expect(icon?.getAttribute('data-theme-icon')).toBeNull();
		expect(icon?.getAttribute('data-icon-pack')).toBeNull();
	});
});
