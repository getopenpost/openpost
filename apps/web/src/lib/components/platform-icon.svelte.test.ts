import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import PlatformIcon from './platform-icon.svelte';
import YouTubeBrand from './youtube-brand.svelte';
import '../../routes/layout.css';

describe('YouTube attribution', () => {
	it('omits the logo from compact provider icons', () => {
		const screen = render(PlatformIcon, {
			platform: 'youtube',
			class: 'size-3'
		});
		expect(screen.container.querySelector('svg')).toBeNull();
	});
	it('links the official full-color mark at the audit minimum with a compact footprint and triangle-width clear space', () => {
		const screen = render(YouTubeBrand);
		const svg = screen.container.querySelector('svg')!;
		const paths = svg.querySelectorAll('path');
		expect(screen.getByRole('link', { name: 'YouTube' }).element().getAttribute('href')).toBe(
			'https://www.youtube.com/'
		);
		expect(getComputedStyle(paths[0]).fill).toBe('rgb(255, 0, 51)');
		expect(getComputedStyle(paths[1]).fill).toBe('rgb(255, 255, 255)');
		const scale = svg.getScreenCTM()!.a;
		const mark = paths[0].getBBox();
		const triangle = paths[1].getBBox();
		const viewBox = svg.viewBox.baseVal;
		const paintedHeight = mark.height * scale;
		expect(paintedHeight).toBeGreaterThanOrEqual(20);
		expect(paintedHeight).toBeLessThanOrEqual(28);
		expect(svg.getBoundingClientRect().width / svg.getBoundingClientRect().height).toBeCloseTo(
			viewBox.width / viewBox.height,
			2
		);
		for (const margin of [
			mark.x,
			mark.y,
			viewBox.width - mark.x - mark.width,
			viewBox.height - mark.y - mark.height
		]) {
			expect(margin).toBeGreaterThanOrEqual(triangle.width - 0.01);
		}
	});
});
