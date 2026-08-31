import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { createDefaultTracks } from '$lib/video-editor/project/defaults';
import { commandHistory } from '$lib/video-editor/timeline/commands/command-store.svelte';
import { timelineStore } from '$lib/video-editor/timeline/stores/timeline-store.svelte';
import {
	GENERATED_ITEM_DRAG_MIME,
	parseGeneratedItemDragData
} from '$lib/video-editor/timeline/generated-item-drag';
import TextTemplateBrowser from './text-template-browser.svelte';

beforeEach(() => {
	commandHistory.clearHistory();
	timelineStore.__resetForTesting();
	timelineStore._setTracks(createDefaultTracks());
});

describe('TextTemplateBrowser', () => {
	it('shows the full recipe set and creates a styled item in one command', async () => {
		const oninserted = vi.fn();
		const screen = await render(TextTemplateBrowser, { oninserted });

		await expect.element(screen.getByRole('button', { name: 'Add text: Clean' })).toBeVisible();
		await expect
			.element(screen.getByRole('button', { name: 'Add text: Lower Third' }))
			.toBeVisible();
		await expect.element(screen.getByRole('button', { name: 'Add text: Breaking' })).toBeVisible();
		expect(screen.container.querySelectorAll('.template-card')).toHaveLength(14);

		await screen.getByRole('button', { name: 'Add text: Breaking' }).click();
		const item = timelineStore.items[0];
		expect(item).toMatchObject({
			type: 'text',
			textStylePresetId: 'breaking-update'
		});
		expect(commandHistory.getLastCommandType()).toBe('ADD_TEXT_ITEM');
		expect(oninserted).toHaveBeenCalledWith(item?.id);
		commandHistory.undo();
		expect(timelineStore.items).toHaveLength(0);

		const dataTransfer = new DataTransfer();
		screen
			.getByRole('button', { name: 'Add text: Lower Third' })
			.element()
			.dispatchEvent(
				new DragEvent('dragstart', {
					bubbles: true,
					cancelable: true,
					dataTransfer
				})
			);
		expect([...dataTransfer.types]).toContain(GENERATED_ITEM_DRAG_MIME);
		expect(parseGeneratedItemDragData(dataTransfer.getData(GENERATED_ITEM_DRAG_MIME))).toEqual({
			version: 1,
			kind: 'text',
			label: 'Lower Third',
			presetId: 'lower-third'
		});
	});
});
