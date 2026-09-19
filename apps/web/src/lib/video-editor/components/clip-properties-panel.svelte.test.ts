import { afterEach, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import type { TimelineItem } from '$lib/video-editor/project/types';
import { timelineStore } from '$lib/video-editor/timeline/stores/timeline-store.svelte';
import ClipPropertiesPanel from './clip-properties-panel.svelte';
import TextTemplateBrowser from './text-template-browser.svelte';

function textItem(): TimelineItem {
	return {
		id: 'text-1',
		trackId: 'track-visual-main',
		from: 0,
		durationInFrames: 90,
		label: 'Launch title',
		type: 'text',
		text: 'Ship the work',
		fontFamily: 'Inter',
		fontSize: 64,
		fontWeight: 700,
		color: '#ffffff',
		transform: { x: 0, y: 0, width: 960, height: 240 }
	};
}

afterEach(() => {
	timelineStore.__resetForTesting();
});

it('puts selected text editing before geometry and keeps advanced geometry disclosed', async () => {
	const item = textItem();
	timelineStore._setItems([item]);
	const onbrowsetextstyles = vi.fn();
	const screen = await render(ClipPropertiesPanel, {
		itemId: item.id,
		onedit: () => {},
		onbrowsetextstyles
	});

	const text = screen.getByRole('textbox', { name: 'Text' }).element();
	const transform = screen.getByRole('heading', { name: 'Transform' }).element();
	expect(text.compareDocumentPosition(transform) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);

	const cornerPin = screen.getByText('Corner pin').element().closest('details');
	expect(cornerPin?.open).toBe(false);

	await screen.getByRole('button', { name: 'Browse styles' }).click();
	expect(onbrowsetextstyles).toHaveBeenCalledOnce();
});

it('applies a rail style to selected text without inserting another item', async () => {
	const item = textItem();
	timelineStore._setItems([item]);
	const oninserted = vi.fn();
	const onapplied = vi.fn();
	const screen = await render(TextTemplateBrowser, {
		oninserted,
		selectedTextItemId: item.id,
		onapplied
	});

	await screen.getByRole('button', { name: 'Apply Clean' }).click();

	expect(timelineStore.items).toHaveLength(1);
	expect(timelineStore.itemById.get(item.id)?.textStylePresetId).toBe('clean-title');
	expect(oninserted).not.toHaveBeenCalled();
	expect(onapplied).toHaveBeenCalledOnce();
});
