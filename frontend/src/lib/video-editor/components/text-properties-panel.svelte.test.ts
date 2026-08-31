import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { m } from '$lib/paraglide/messages';
import { setLocale } from '$lib/paraglide/runtime';
import type { TimelineItem, TimelineTrack } from '../project/types';
import { commandHistory } from '../timeline/commands/command-store.svelte';
import { timelineStore } from '../timeline/stores/timeline-store.svelte';
import TextPropertiesPanel from './text-properties-panel.svelte';

const track: TimelineTrack = {
	id: 'visual',
	name: 'Visual',
	kind: 'video',
	height: 64,
	locked: false,
	visible: true,
	muted: false,
	solo: false,
	order: 0
};

const item: TimelineItem = {
	id: 'text',
	trackId: track.id,
	from: 0,
	durationInFrames: 90,
	label: 'Launch',
	text: 'Launch',
	type: 'text',
	fontSize: 84,
	fontWeight: 700,
	color: '#ffffff'
};

beforeEach(() => {
	setLocale('en', { reload: false });
	commandHistory.clearHistory();
	timelineStore.__resetForTesting();
	timelineStore.setAll({ tracks: [track], items: [item], currentFrame: 0, fps: 30 });
});

afterEach(() => setLocale('en', { reload: false }));

describe('TextPropertiesPanel', () => {
	it('round-trips structured layouts without crowding the inspector', async () => {
		const onedit = vi.fn();
		const screen = await render(TextPropertiesPanel, {
			item: timelineStore.itemById.get('text')!,
			onedit
		});

		await screen.getByRole('button', { name: '3 spans' }).click();
		expect(timelineStore.itemById.get('text')?.textSpans?.map((span) => span.text)).toEqual([
			'Tag',
			'Launch',
			'Subtitle'
		]);
		await expect.element(screen.getByLabelText('Title', { exact: true })).toBeVisible();

		const title = screen.getByLabelText('Title', { exact: true });
		const titleElement = title.query();
		if (!(titleElement instanceof HTMLTextAreaElement)) {
			throw new Error('Title span editor did not render.');
		}
		titleElement.value = 'OpenPost 2.0';
		titleElement.dispatchEvent(new Event('change', { bubbles: true }));
		await screen.getByRole('button', { name: 'Single' }).click();
		expect(timelineStore.itemById.get('text')).toMatchObject({ text: 'Launch' });
		await screen.getByRole('button', { name: '3 spans' }).click();
		expect(timelineStore.itemById.get('text')?.textSpans?.map((span) => span.text)).toEqual([
			'Tag',
			'OpenPost 2.0',
			'Subtitle'
		]);
		expect(commandHistory.canUndo).toBe(true);
		expect(onedit).toHaveBeenCalledTimes(4);

		screen.container.style.width = '260px';
		const panel = screen.container.firstElementChild;
		expect(panel).not.toBeNull();
		if (panel) expect(panel.scrollWidth).toBeLessThanOrEqual(260);
	});

	it('applies a visual preset while keeping edited copy', async () => {
		const screen = await render(TextPropertiesPanel, {
			item: timelineStore.itemById.get('text')!,
			onedit: vi.fn()
		});
		await screen.getByRole('button', { name: 'Apply Lower Third' }).click();
		expect(timelineStore.itemById.get('text')).toMatchObject({
			text: 'Launch\nRole or subtitle',
			textStylePresetId: 'lower-third',
			backgroundFit: 'content',
			textSpans: [{ text: 'Launch' }, { text: 'Role or subtitle' }]
		});
		await expect.element(screen.getByLabelText('Subtitle', { exact: true })).toBeVisible();
	});

	it('localizes template previews and generated fallback copy', async () => {
		setLocale('pt', { reload: false });
		const screen = await render(TextPropertiesPanel, {
			item: timelineStore.itemById.get('text')!,
			onedit: vi.fn()
		});

		await expect.element(screen.getByText('Hoje à noite')).toBeVisible();
		await screen
			.getByRole('button', {
				name: m.video_editor_text_apply_template({
					name: m.video_editor_text_preset_lower_third()
				})
			})
			.click();

		expect(timelineStore.itemById.get('text')).toMatchObject({
			text: 'Launch\nFunção ou subtítulo',
			textSpans: [{ text: 'Launch' }, { text: 'Função ou subtítulo' }]
		});
	});

	it('offers the full authored copy for linked speech generation', async () => {
		timelineStore._updateItems([
			{
				id: 'text',
				patch: {
					textSpans: [{ text: 'Launch' }, { text: 'Built for small teams' }]
				}
			}
		]);
		const oncreatevoice = vi.fn();
		const screen = await render(TextPropertiesPanel, {
			item: timelineStore.itemById.get('text')!,
			onedit: vi.fn(),
			oncreatevoice
		});

		await screen.getByRole('button', { name: 'Create voice from text' }).click();
		expect(oncreatevoice).toHaveBeenCalledOnce();
		expect(oncreatevoice).toHaveBeenCalledWith('text', 'Launch\nBuilt for small teams');
	});

	it('exposes FreeCut text effect presets and commits the selected look', async () => {
		const onedit = vi.fn();
		const screen = await render(TextPropertiesPanel, {
			item: timelineStore.itemById.get('text')!,
			onedit
		});

		await screen.getByRole('button', { name: 'Shadow' }).click();
		expect(timelineStore.itemById.get('text')).toMatchObject({
			textShadow: { offsetX: 4, offsetY: 6, blur: 12, color: '#000000' }
		});
		expect(commandHistory.undoStack).toHaveLength(1);
		expect(onedit).toHaveBeenCalledOnce();
	});
});
