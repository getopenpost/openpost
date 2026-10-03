import { expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import Fixture from './text-content-properties.fixture.svelte';
import '../../../routes/layout.css';

it('shows the selected variable font weight even when it is between named steps', async () => {
	const screen = await render(Fixture, { fontWeight: 850 });
	await expect.element(screen.getByLabelText('Weight')).toHaveTextContent('850');
	await expect.element(screen.getByLabelText('Text')).toBeVisible();
	expect(screen.getByRole('heading', { name: 'Text' }).query()).toBeNull();
});

it('explains whole-layer font controls while a text range is selected', async () => {
	const screen = await render(Fixture, { fontWeight: 400 });
	await screen.getByLabelText('Text').click();
	for (let i = 0; i < 20; i++) await userEvent.keyboard('{ArrowLeft}');
	await userEvent.keyboard('{Shift>}{ArrowRight}{ArrowRight}{ArrowRight}{/Shift}');
	await expect.element(screen.getByText('3 selected', { exact: true })).toBeVisible();
	const hint = 'Font family and size affect the whole text layer.';
	await expect.element(screen.getByText(hint, { exact: true })).toBeVisible();
	await expect
		.element(screen.getByRole('button', { name: 'Font family', exact: true }))
		.toHaveAccessibleDescription(hint);
	await expect
		.element(screen.getByLabelText('Size', { exact: true }))
		.toHaveAccessibleDescription(hint);
	await screen.getByLabelText('Text').click();
	await userEvent.keyboard('{ArrowLeft}');
	await expect.element(screen.getByText(hint, { exact: true })).not.toBeInTheDocument();
});
