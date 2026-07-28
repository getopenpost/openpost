import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import type { ComponentProps } from 'svelte';
import ComposerPublishActions from './composer-publish-actions.svelte';

function renderActions(overrides: Partial<ComponentProps<typeof ComposerPublishActions>> = {}) {
	return render(ComposerPublishActions, {
		scheduleLabel: 'Schedule',
		quickScheduleLabel: 'Schedule to next free slot',
		publishLabel: 'Publish Now',
		onSchedule: vi.fn(),
		onQuickSchedule: vi.fn(),
		onPublish: vi.fn(),
		...overrides
	});
}

describe('ComposerPublishActions', () => {
	it('uses the arrow action for the next free slot', async () => {
		const onQuickSchedule = vi.fn();
		const screen = await renderActions({ onQuickSchedule });
		const quickSchedule = screen.getByRole('button', {
			name: 'Schedule to next free slot'
		});

		expect(
			screen.container.querySelector(
				'button[aria-label="Schedule to next free slot"] .lucide-arrow-right'
			)
		).not.toBeNull();
		await quickSchedule.click();
		expect(onQuickSchedule).toHaveBeenCalledOnce();
	});

	it('uses a send action when a complete schedule is selected', async () => {
		const onQuickSchedule = vi.fn();
		const screen = await renderActions({
			scheduleLabel: 'Tomorrow 10:30',
			quickScheduleLabel: 'Schedule for Tomorrow 10:30',
			scheduleSelected: true,
			onQuickSchedule
		});
		const quickSchedule = screen.getByRole('button', {
			name: 'Schedule for Tomorrow 10:30'
		});

		expect(
			screen.container.querySelector(
				'button[aria-label="Schedule for Tomorrow 10:30"] .lucide-send'
			)
		).not.toBeNull();
		await quickSchedule.click();
		expect(onQuickSchedule).toHaveBeenCalledOnce();
	});
});
