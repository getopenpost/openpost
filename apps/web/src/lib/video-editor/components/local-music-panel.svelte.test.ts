import { expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page, userEvent } from 'vitest/browser';
import { WebThemeRuntime } from '$lib/themes/runtime';
import { resolveBuiltInTheme } from '$lib/themes/builtins';
import '../../../routes/layout.css';
import LocalMusicPanel from './local-music-panel.svelte';

it('shows the selected Music starting point while keeping its brief editable', async () => {
	const inserted = vi.fn();
	let screen = await render(LocalMusicPanel, {
		projectId: 'music-preset',
		oninserted: inserted,
		supported: false
	});
	const startingPoint = screen.getByRole('button', { name: 'Starting point', exact: true });
	const brief = screen.getByRole('textbox', { name: 'Music brief', exact: true });
	const theme = new WebThemeRuntime();
	try {
		await expect.element(startingPoint).toHaveTextContent('Cinematic pulse');
		await startingPoint.click();
		await page.getByRole('option', { name: 'Ambient bed', exact: true }).click();
		await expect
			.element(brief)
			.toHaveValue(
				'Calm ambient instrumental, warm pads, sparse piano, gentle motion, no percussion'
			);
		await expect.element(startingPoint).toHaveTextContent('Ambient bed');
		startingPoint.element().focus();
		await userEvent.keyboard('{Enter}{End}{Enter}');
		await expect.element(startingPoint).toHaveTextContent('Lo-fi beat');
		await expect
			.element(brief)
			.toHaveValue(
				'Relaxed lo-fi hip hop instrumental, dusty drums, warm keys, subtle vinyl texture'
			);
		await brief.fill('My own instrumental brief');
		await expect.element(startingPoint).toHaveTextContent('Lo-fi beat');
		for (const scheme of ['light', 'dark'] as const) {
			await theme.apply(resolveBuiltInTheme('dither', scheme), document.documentElement);
			for (const width of [1280, 390, 320]) {
				await page.viewport(width, 844);
				screen.container.style.maxWidth = '500px';
				startingPoint.element().focus();
				await expect.element(startingPoint).toHaveFocus();
				await expect.element(startingPoint).toHaveTextContent('Lo-fi beat');
				await expect.element(brief).toHaveValue('My own instrumental brief');
				await page.screenshot({ path: `mu001-${scheme}-${width}.png` });
			}
		}
		await startingPoint.click();
		await page.getByRole('option', { name: 'Cinematic pulse', exact: true }).click();
		await expect.element(startingPoint).toHaveTextContent('Cinematic pulse');
		await expect
			.element(brief)
			.toHaveValue(
				'Cinematic electronic instrumental, rising pulse, deep drums, clear edit points, polished mix'
			);
		expect(inserted).not.toHaveBeenCalled();
		await screen.unmount();
		screen = await render(LocalMusicPanel, {
			projectId: 'music-preset',
			oninserted: inserted,
			supported: false
		});
		await expect
			.element(screen.getByRole('button', { name: 'Starting point', exact: true }))
			.toHaveTextContent('Cinematic pulse');
		await expect
			.element(screen.getByRole('textbox', { name: 'Music brief', exact: true }))
			.toHaveValue(
				'Cinematic electronic instrumental, rising pulse, deep drums, clear edit points, polished mix'
			);
	} finally {
		await screen.unmount();
		theme.clear(document.documentElement);
	}
});
