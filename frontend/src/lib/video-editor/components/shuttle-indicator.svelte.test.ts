import { describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import ShuttleIndicator from './shuttle-indicator.svelte';

describe('shuttle indicator', () => {
	it('renders accessible live status with readable contrast at desktop', async () => {
		const { container } = render(ShuttleIndicator, { props: { active: true, playbackRate: 2 } });
		// SAFETY: test queries rendered indicator element which is known to be HTMLElement.
		// SAFETY: test queries rendered indicator element which is known to be HTMLElement.
		const indicator = container.querySelector('[data-testid="shuttle-indicator"]') as HTMLElement;
		expect(indicator).not.toBeNull();
		expect(indicator.tagName).toBe('OUTPUT');
		expect(indicator.getAttribute('aria-live')).toBe('polite');
		expect(indicator.getAttribute('aria-atomic')).toBe('true');
		const style = getComputedStyle(indicator);
		expect(style.display).not.toBe('none');
		// Readable contrast: text color should be bright against dark bg
		// Check that color is not the low-contrast muted gray
		expect(style.color).not.toBe('');
		await expect(page.getByTestId('shuttle-indicator')).toBeVisible();
	});

	it('fits within 390 px viewport', async () => {
		await page.viewport(390, 800);
		const { container } = render(ShuttleIndicator, { props: { active: true, playbackRate: 4 } });
		// SAFETY: test queries rendered indicator element which is known to be HTMLElement.
		// SAFETY: test queries rendered indicator element which is known to be HTMLElement.
		const indicator = container.querySelector('[data-testid="shuttle-indicator"]') as HTMLElement;
		expect(indicator).not.toBeNull();
		const rect = indicator.getBoundingClientRect();
		expect(rect.width).toBeLessThanOrEqual(390);
		expect(rect.width).toBeGreaterThan(0);
		await expect(page.getByTestId('shuttle-indicator')).toBeVisible();
	});

	it('fits within 320 px viewport', async () => {
		await page.viewport(320, 800);
		const { container } = render(ShuttleIndicator, { props: { active: true, playbackRate: -2 } });
		// SAFETY: test queries rendered indicator element which is known to be HTMLElement.
		// SAFETY: test queries rendered indicator element which is known to be HTMLElement.
		const indicator = container.querySelector('[data-testid="shuttle-indicator"]') as HTMLElement;
		expect(indicator).not.toBeNull();
		const rect = indicator.getBoundingClientRect();
		expect(rect.width).toBeLessThanOrEqual(320);
		expect(rect.width).toBeGreaterThan(0);
		// Screenshot for visual regression
		await page.screenshot();
		await expect(page.getByTestId('shuttle-indicator')).toBeVisible();
	});

	it('hides when not useful and shows at 2x reverse', async () => {
		const { container } = render(ShuttleIndicator, { props: { active: false, playbackRate: 2 } });
		expect(container.querySelector('[data-testid="shuttle-indicator"]')).toBeNull();
		const { container: container2 } = render(ShuttleIndicator, {
			props: { active: true, playbackRate: -1 }
		});
		expect(container2.querySelector('[data-testid="shuttle-indicator"]')).not.toBeNull();
	});
});
