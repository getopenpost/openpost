import { expect, it } from 'vitest';

it('mounts the opt-in scanner with the app Svelte runtime and toggles it', async () => {
	localStorage.removeItem('svelte-render-scan-enabled');
	await import('./render-scan');
	const button = document.querySelector<HTMLButtonElement>(
		'.openpost-render-scan button[title="Disable render scanning"]'
	);
	expect(button).not.toBeNull();
	button!.click();
	await expect.poll(() => button!.title).toBe('Enable render scanning');
	localStorage.removeItem('svelte-render-scan-enabled');
});
