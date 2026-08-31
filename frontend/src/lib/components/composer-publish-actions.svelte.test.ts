import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import type { ComponentProps } from 'svelte';
import ComposerPublishActions from './composer-publish-actions.svelte';

function renderActions(overrides: Partial<ComponentProps<typeof ComposerPublishActions>> = {}) {
	return render(ComposerPublishActions, {
		scheduleLabel: 'Schedule',
		quickScheduleLabel: 'Schedule to next free slot',
		publishLabel: 'Publish Now',
		moreLabel: 'More delivery actions',
		onSchedule: vi.fn(),
		onQuickSchedule: vi.fn(),
		onPublish: vi.fn(),
		...overrides
	});
}

describe('ComposerPublishActions', () => {
	it('makes the next free slot the primary delivery action', async () => {
		const onQuickSchedule = vi.fn();
		const screen = await renderActions({ onQuickSchedule });
		const quickSchedule = screen.getByRole('button', {
			name: 'Schedule to next free slot'
		});

		await expect.element(quickSchedule).toBeEnabled();
		expect(quickSchedule.element().dataset.testid).toBe('composer-primary-delivery-action');
		await quickSchedule.click();
		expect(onQuickSchedule).toHaveBeenCalledOnce();
	});

	it('keeps schedule and immediate publish available in the delivery menu', async () => {
		const onSchedule = vi.fn();
		const onPublish = vi.fn();
		const screen = await renderActions({
			scheduleLabel: 'Tomorrow 10:30',
			onSchedule,
			onPublish
		});

		await screen.getByRole('button', { name: 'More delivery actions' }).click();
		await screen.getByRole('menuitem', { name: 'Tomorrow 10:30' }).click();
		expect(onSchedule).toHaveBeenCalledOnce();

		await screen.getByRole('button', { name: 'More delivery actions' }).click();
		await screen.getByRole('menuitem', { name: 'Publish Now' }).click();
		expect(onPublish).toHaveBeenCalledOnce();
	});
});
