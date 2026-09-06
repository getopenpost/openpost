import { describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import AsyncActionButton from './async-action-button.svelte';
import '../../routes/layout.css';

describe('async actions', () => {
	it('keeps focus and geometry through pending, rejection, and retry without duplicate requests', async () => {
		let finish!: () => void;
		const onclick = vi.fn(
			() =>
				new Promise<void>((resolve) => {
					finish = resolve;
				})
		);
		const props = {
			label: 'Save',
			pendingLabel: 'Saving your changes',
			errorLabel: 'Try again',
			successLabel: 'Saved',
			onclick
		};
		const screen = await render(AsyncActionButton, props);
		const button = screen.getByRole('button', { name: 'Save' }).element();
		if (!(button instanceof HTMLButtonElement)) throw new Error('Expected a native button');
		const width = button.getBoundingClientRect().width;
		button.focus();
		await screen.getByRole('button', { name: 'Save' }).click();
		button.click();
		expect(onclick).toHaveBeenCalledOnce();
		expect(document.activeElement).toBe(button);
		expect(button.getBoundingClientRect().width).toBe(width);
		await screen.rerender({ ...props, state: 'error' });
		finish();
		await expect
			.element(screen.getByRole('button', { name: 'Try again' }))
			.toHaveAttribute('aria-busy', 'false');
		expect(button.getBoundingClientRect().width).toBe(width);
		await expect.element(screen.getByRole('status')).toHaveTextContent('Try again');
		await screen.getByRole('button', { name: 'Try again' }).click();
		expect(onclick).toHaveBeenCalledTimes(2);
		finish();
	});
});

it.each([390, 320])(
	'fits long translated labels at %ipx without moving on completion',
	async (width) => {
		await page.viewport(width, 900);
		try {
			const props = {
				label: 'Kopieren',
				pendingLabel: 'Die Änderungen werden für alle Ziele gespeichert',
				successLabel: 'Gespeichert'
			};
			const screen = await render(AsyncActionButton, props);
			const button = screen.getByRole('button', { name: 'Kopieren' }).element();
			expect(button.getBoundingClientRect().width).toBeLessThanOrEqual(width);
			const initialWidth = button.getBoundingClientRect().width;
			await screen.rerender({ ...props, state: 'success' });
			await expect.element(screen.getByRole('button', { name: 'Gespeichert' })).toBeVisible();
			expect(button.getBoundingClientRect().width).toBe(initialWidth);
		} finally {
			await page.viewport(1280, 900);
		}
	}
);
