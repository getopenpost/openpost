import { describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import '../../../routes/layout.css';
import EditInspectorTabs from './edit-inspector-tabs.svelte';

describe('EditInspectorTabs', () => {
	it('switches contextual panels without overflowing a phone viewport', async () => {
		await page.viewport(320, 720);
		const onchange = vi.fn();
		const screen = await render(EditInspectorTabs, {
			tabs: ['properties', 'motion', 'effects', 'transcript'],
			value: 'properties',
			onchange
		});

		const properties = screen.getByRole('tab', { name: 'Properties' });
		const effects = screen.getByRole('tab', { name: 'Effects' });
		await expect.element(properties).toHaveAttribute('aria-selected', 'true');
		expect(properties.element().getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
		properties
			.element()
			.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
		await expect
			.element(screen.getByRole('tab', { name: 'Motion' }))
			.toHaveAttribute('aria-selected', 'true');

		await effects.click();

		await expect.element(effects).toHaveAttribute('aria-selected', 'true');
		expect(onchange).toHaveBeenCalledWith('effects');
		expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
		await page.screenshot({ path: '../../../../.svelte-kit/openpost-edit-inspector-320.png' });
	});
});
