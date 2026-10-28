import { afterEach, describe, expect, it } from 'vitest';
import { cdp } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import AsyncActionButton from './async-action-button.svelte';
import DialogLoadingStatus from './dialog-loading-status.svelte';
import '../../routes/layout.css';

async function emulateReducedMotion(value: 'reduce' | 'no-preference'): Promise<void> {
	await cdp().send('Emulation.setEmulatedMedia', {
		features: [{ name: 'prefers-reduced-motion', value }]
	});
}

afterEach(async () => {
	await emulateReducedMotion('no-preference');
});

describe('pending spinners under reduced motion', () => {
	it('shared delete-dialog indicator rests while keeping its status announcement', async () => {
		await emulateReducedMotion('reduce');
		expect(matchMedia('(prefers-reduced-motion: reduce)').matches).toBe(true);

		const screen = await render(DialogLoadingStatus);
		await expect.element(screen.getByRole('status')).toBeVisible();

		const indicator = screen.container.querySelector('[role="status"] svg');
		if (!(indicator instanceof SVGElement)) throw new Error('Expected the loading indicator.');
		expect(getComputedStyle(indicator).animationName).toBe('none');

		// The emulation genuinely toggles the animation; the assertion above is not vacuous.
		await emulateReducedMotion('no-preference');
		expect(matchMedia('(prefers-reduced-motion: reduce)').matches).toBe(false);
		expect(getComputedStyle(indicator).animationName).not.toBe('none');
	});

	it('async pending button keeps its busy announcement without spinning', async () => {
		await emulateReducedMotion('reduce');
		expect(matchMedia('(prefers-reduced-motion: reduce)').matches).toBe(true);

		const screen = await render(AsyncActionButton, {
			label: 'Save',
			pendingLabel: 'Saving',
			state: 'pending'
		});
		await expect
			.element(screen.getByRole('button', { name: 'Saving' }))
			.toHaveAttribute('aria-busy', 'true');

		const spinner = screen.container.querySelector('.animate-spin');
		if (!(spinner instanceof Element)) throw new Error('Expected a spinner element.');
		expect(getComputedStyle(spinner).animationName).toBe('none');
		await emulateReducedMotion('no-preference');
		expect(matchMedia('(prefers-reduced-motion: reduce)').matches).toBe(false);
		expect(getComputedStyle(spinner).animationName).not.toBe('none');
	});
});
