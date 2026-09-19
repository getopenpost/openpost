import { afterEach, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import type { TimelineItem } from '$lib/video-editor/project/types';
import { createDefaultTracks } from '$lib/video-editor/project/defaults';
import { timelineStore } from '$lib/video-editor/timeline/stores/timeline-store.svelte';
import ClipPropertiesPanel from './clip-properties-panel.svelte';
import TextTemplateBrowser from './text-template-browser.svelte';

function textItem(): TimelineItem {
	return {
		id: 'text-1',
		trackId: 'track-video-main',
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
	await expect.element(screen.getByRole('heading', { name: 'Text' })).not.toBeInTheDocument();

	const cornerPin = screen.container.querySelector<HTMLButtonElement>(
		'[data-collapsible-trigger][aria-label="Corner pin"]'
	)!;
	expect(cornerPin.getAttribute('aria-expanded')).toBe('false');
	expect(cornerPin.parentElement?.className).toContain('[@media(pointer:coarse)]:min-h-11');
	cornerPin.click();
	await expect.element(screen.getByRole('spinbutton', { name: 'TL X' })).toBeVisible();

	await screen.getByRole('button', { name: 'Browse styles' }).click();
	expect(onbrowsetextstyles).toHaveBeenCalledOnce();
});

it('opens active corner pin controls by default', async () => {
	const item: TimelineItem = {
		...textItem(),
		cornerPin: {
			topLeft: [0, 0],
			topRight: [0, 0],
			bottomRight: [0, 0],
			bottomLeft: [0, 0]
		}
	};
	timelineStore._setItems([item]);
	const screen = await render(ClipPropertiesPanel, {
		itemId: item.id,
		onedit: () => {}
	});

	await vi.waitFor(() => {
		expect(
			screen.container
				.querySelector('[data-collapsible-trigger][aria-label="Corner pin: Active"]')
				?.getAttribute('aria-expanded')
		).toBe('true');
	});
	await expect.element(screen.getByRole('spinbutton', { name: 'TL X' })).toBeVisible();
});

it('applies a rail style to selected text without inserting another item', async () => {
	const item = textItem();
	timelineStore._setItems([item]);
	timelineStore._setTracks(createDefaultTracks());
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

it('does not apply a rail style when the selected text track is locked', async () => {
	const item = textItem();
	timelineStore._setItems([item]);
	timelineStore._setTracks(
		createDefaultTracks().map((track) =>
			track.id === item.trackId ? { ...track, locked: true } : track
		)
	);
	const oninserted = vi.fn();
	const onapplied = vi.fn();
	const screen = await render(TextTemplateBrowser, {
		oninserted,
		selectedTextItemId: item.id,
		onapplied
	});

	const preset = screen.getByRole('button', { name: 'Apply Clean' });
	await expect.element(preset).toBeDisabled();
	expect(timelineStore.itemById.get(item.id)?.textStylePresetId).toBeUndefined();
	expect(oninserted).not.toHaveBeenCalled();
	expect(onapplied).not.toHaveBeenCalled();
});
