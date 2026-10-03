import { expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import OpeningFocus from './opening-focus.fixture.svelte';

it('allows an outside focus choice while a nontrapping dialog opens', async () => {
	const outside = document.createElement('button');
	outside.textContent = 'Continue outside';
	document.body.append(outside);
	try {
		await render(OpeningFocus, {
			onOpenAutoFocus: () => queueMicrotask(() => outside.focus())
		});
		await new Promise<void>((resolve) =>
			requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
		);
		expect(document.activeElement).toBe(outside);
	} finally {
		outside.remove();
	}
});
