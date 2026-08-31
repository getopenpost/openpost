import { describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import ShuttleIndicator from './shuttle-indicator.svelte';

describe('ShuttleIndicator', () => {
	it('announces the exact direction, shortcut, and rate', async () => {
		const { container } = render(ShuttleIndicator, {
			props: { active: true, playbackRate: -2 }
		});
		const indicator = container.querySelector<HTMLOutputElement>(
			'[data-testid="shuttle-indicator"]'
		);
		expect(indicator).not.toBeNull();
		if (!indicator) return;
		expect(indicator.getAttribute('aria-live')).toBe('polite');
		expect(indicator.getAttribute('aria-atomic')).toBe('true');
		expect(indicator.getAttribute('aria-label')).toBe('Reverse shuttle 2×');
		expect(indicator.textContent).toContain('J');
		expect(indicator.textContent).toContain('◀');
		expect(indicator.textContent).toContain('2×');
		await expect(page.getByTestId('shuttle-indicator')).toBeVisible();
	});

	it('stays inside a 320px viewport without shrinking to zero', async () => {
		await page.viewport(320, 800);
		const { container } = render(ShuttleIndicator, {
			props: { active: true, playbackRate: 4 }
		});
		const indicator = container.querySelector<HTMLOutputElement>(
			'[data-testid="shuttle-indicator"]'
		);
		expect(indicator).not.toBeNull();
		if (!indicator) return;
		const rect = indicator.getBoundingClientRect();
		expect(rect.left).toBeGreaterThanOrEqual(0);
		expect(rect.right).toBeLessThanOrEqual(document.documentElement.clientWidth);
		expect(indicator.scrollWidth).toBeLessThanOrEqual(indicator.clientWidth);
	});

	it('renders nothing while inactive', () => {
		const { container } = render(ShuttleIndicator, {
			props: { active: false, playbackRate: 2 }
		});
		expect(container.querySelector('[data-testid="shuttle-indicator"]')).toBeNull();
	});

	it('shows the first 1x forward shuttle press', () => {
		const { container } = render(ShuttleIndicator, {
			props: { active: true, playbackRate: 1 }
		});
		const indicator = container.querySelector<HTMLOutputElement>(
			'[data-testid="shuttle-indicator"]'
		);
		expect(indicator?.getAttribute('aria-label')).toBe('Forward shuttle 1×');
		expect(indicator?.textContent).toContain('L');
	});
});
