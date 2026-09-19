import { expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import Fixture from './text-content-properties.fixture.svelte';
import '../../../routes/layout.css';

it('shows the selected variable font weight even when it is between named steps', async () => {
	const screen = await render(Fixture, { fontWeight: 850 });
	await expect.element(screen.getByLabelText('Weight')).toHaveTextContent('850');
	await expect.element(screen.getByLabelText('Text')).toBeVisible();
	expect(screen.getByRole('heading', { name: 'Text' }).query()).toBeNull();
});
