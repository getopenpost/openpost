import { expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import Logo from './Logo.svelte';

it('updates the mark when the active theme accent changes', async () => {
	const screen = await render(Logo);
	const logo = screen.getByRole('img', { name: 'OpenPost' }).element();
	const container = logo.parentElement!;
	const paths = [...logo.querySelectorAll('path')];
	expect(paths).toHaveLength(4);
	for (const accent of ['rgb(253, 151, 93)', 'rgb(49, 152, 104)', 'rgb(68, 136, 255)']) {
		container.style.setProperty('--action-focal', accent);
		await expect
			.poll(() => paths.map((path) => getComputedStyle(path).fill))
			.toEqual(Array(4).fill(accent));
	}
});
