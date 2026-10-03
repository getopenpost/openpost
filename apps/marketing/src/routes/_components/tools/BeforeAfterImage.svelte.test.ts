import { afterEach, expect, it } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import '../../layout.css';
import BeforeAfterImage from './BeforeAfterImage.svelte';

const image = (color: string) =>
	`data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400"><rect width="600" height="400" fill="${color}"/></svg>`)}`;

afterEach(async () => {
	document.documentElement.classList.remove('dark');
	await page.viewport(1280, 900);
});

it.each([1280, 390, 320])('announces the visible image shares at %ipx', async (width) => {
	await page.viewport(width, 900);
	const screen = await render(BeforeAfterImage, {
		before: image('#d00000'),
		after: image('#0044ff'),
		beforeLabel: 'Original',
		afterLabel: 'Removed'
	});
	const slider = screen.getByRole('slider', { name: 'Compare before and after images' });
	slider.element().focus();
	await userEvent.keyboard('{Home}');
	await expect.element(slider).toHaveAttribute('aria-valuenow', '0');
	await expect.element(slider).toHaveAttribute('aria-valuetext', '0% original, 100% removed');
	await userEvent.keyboard('{End}');
	await expect.element(slider).toHaveAttribute('aria-valuenow', '100');
	await expect.element(slider).toHaveAttribute('aria-valuetext', '100% original, 0% removed');
	await userEvent.keyboard('{ArrowLeft}');
	await expect.element(slider).toHaveAttribute('aria-valuetext', '99% original, 1% removed');
	await userEvent.keyboard('{PageDown}');
	await expect.element(slider).toHaveAttribute('aria-valuetext', '89% original, 11% removed');
	await userEvent.keyboard('{Home}{PageUp}');
	await expect.element(slider).toHaveAttribute('aria-valuetext', '10% original, 90% removed');
});
