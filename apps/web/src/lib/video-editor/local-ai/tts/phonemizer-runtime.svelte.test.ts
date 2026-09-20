import { expect, test } from 'vitest';
import { render } from 'vitest-browser-svelte';
import PhonemizerRuntimeFixture from './phonemizer-runtime.fixture.svelte';

test('loads the Kokoro American English phonemizer in a browser', async () => {
	const screen = render(PhonemizerRuntimeFixture);

	await expect.element(screen.getByText('ready')).toBeVisible();
});
