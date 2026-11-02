import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import PlatformIcon from './platform-icon.svelte';
import YouTubeBrand from './youtube-brand.svelte';
import '../../routes/layout.css';

describe('YouTube attribution', () => {
	it('omits the logo from compact provider icons', () => {
		const screen = render(PlatformIcon, { platform: 'youtube', class: 'size-3' });
		expect(screen.container.querySelector('svg')).toBeNull();
	});
	it('links the official full-color mark at its 100px painted digital minimum', () => {
		const screen = render(YouTubeBrand);
		const svg = screen.container.querySelector('svg')!;
		const paths = svg.querySelectorAll('path');
		expect(screen.getByRole('link', { name: 'YouTube' }).element().getAttribute('href')).toBe(
			'https://www.youtube.com/'
		);
		expect(getComputedStyle(paths[0]).fill).toBe('rgb(255, 0, 51)');
		expect(getComputedStyle(paths[1]).fill).toBe('rgb(255, 255, 255)');
		const scale = svg.getScreenCTM()!.a;
		expect(paths[0].getBBox().height * scale).toBeGreaterThanOrEqual(100);
		expect(
			(svg.getBoundingClientRect().width - paths[0].getBBox().width * scale) / 2
		).toBeGreaterThanOrEqual(37);
	});
});
