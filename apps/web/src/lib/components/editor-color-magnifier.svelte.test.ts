import { expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import Magnifier from './editor-color-magnifier.svelte';
import '../../routes/layout.css';

it('centers the sampled pixel without stretching edge pixels and stays inside a narrow window', async () => {
	await page.viewport(320, 480);
	const image = new ImageData(
		new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 128]),
		2,
		2
	);
	const screen = await render(Magnifier, {
		image,
		pixelX: 0,
		pixelY: 0,
		clientX: 315,
		clientY: 475,
		color: '#ff0000',
		testId: 'magnifier'
	});
	const preview = screen.getByTestId('magnifier');
	await expect.element(preview).toHaveTextContent('#FF0000');
	const pixels = screen.container.querySelectorAll('.pixel');
	expect(getComputedStyle(pixels[12]!).backgroundColor).toBe('rgb(255, 0, 0)');
	expect(getComputedStyle(pixels[13]!).backgroundColor).toBe('rgb(0, 255, 0)');
	expect(getComputedStyle(pixels[17]!).backgroundColor).toBe('rgb(0, 0, 255)');
	expect(getComputedStyle(pixels[18]!).backgroundColor).toBe('rgba(255, 255, 255, 0.5)');
	expect(getComputedStyle(pixels[11]!).backgroundColor).toBe('rgba(0, 0, 0, 0)');
	const bounds = preview.element().getBoundingClientRect();
	expect(bounds.left).toBeGreaterThanOrEqual(0);
	expect(bounds.top).toBeGreaterThanOrEqual(0);
	expect(bounds.right).toBeLessThanOrEqual(320);
	expect(bounds.bottom).toBeLessThanOrEqual(480);
	expect(getComputedStyle(preview.element()).pointerEvents).toBe('none');
});
