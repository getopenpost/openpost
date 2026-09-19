import { expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import type { TimelineItem } from '$lib/video-editor/project/types';
import { createDefaultTracks } from '$lib/video-editor/project/defaults';
import { colorPreviewStore } from '$lib/video-editor/effects/color-preview-store.svelte';
import { timelineStore } from '$lib/video-editor/timeline/stores/timeline-store.svelte';
import ColorPrimaryControls from './color-primary-controls.svelte';

function clip(id: string): TimelineItem {
	return {
		id,
		trackId: 'track-video-main',
		from: 0,
		durationInFrames: 30,
		label: id,
		type: 'image'
	};
}

function contrast(id: string): number | undefined {
	const effect = timelineStore.itemById
		.get(id)
		?.effects?.find(
			(candidate) => candidate.type === 'gpu' && candidate.effectId === 'gpu-color-wheels'
		);
	return effect?.type === 'gpu' ? Number(effect.params.contrast) : undefined;
}

it('commits a scrub to the selection captured when the gesture starts', async () => {
	timelineStore.__resetForTesting();
	timelineStore._setTracks(createDefaultTracks());
	timelineStore._setItems([clip('primary'), clip('original-secondary'), clip('new-secondary')]);

	const screen = await render(ColorPrimaryControls, {
		itemId: 'primary',
		itemIds: ['primary', 'original-secondary'],
		onedit: vi.fn()
	});
	const input = screen.getByRole('textbox', { name: 'Contrast' }).element();
	if (!(input instanceof HTMLInputElement)) throw new Error('Expected Contrast input');
	input.setPointerCapture = vi.fn();
	input.hasPointerCapture = vi.fn(() => false);

	input.dispatchEvent(
		new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, button: 0, clientX: 100 })
	);
	input.dispatchEvent(
		new PointerEvent('pointermove', { bubbles: true, pointerId: 1, buttons: 1, clientX: 110 })
	);
	await screen.rerender({ itemIds: ['primary', 'new-secondary'] });
	input.dispatchEvent(
		new PointerEvent('pointerup', { bubbles: true, pointerId: 1, button: 0, clientX: 110 })
	);

	await vi.waitFor(() => expect(contrast('primary')).toBe(1.05));
	expect(contrast('new-secondary')).toBeUndefined();
	expect(contrast('original-secondary')).toBe(1.05);
});

it('previews only editable targets while retaining the locked sequence grade', async () => {
	const baseTrack = createDefaultTracks()[1]!;
	timelineStore.__resetForTesting();
	colorPreviewStore.clearEffectDraft();
	timelineStore._setTracks([
		{ ...baseTrack, id: 'locked-track', locked: true, order: 0 },
		{
			id: 'locked-group',
			name: 'Locked group',
			isGroup: true,
			height: 48,
			locked: true,
			visible: true,
			muted: false,
			solo: false,
			order: 1
		},
		{
			...baseTrack,
			id: 'group-child',
			parentTrackId: 'locked-group',
			locked: false,
			order: 2
		},
		{ ...baseTrack, id: 'sequence-track', locked: true, order: 3 }
	]);
	timelineStore._setItems([
		{ ...clip('directly-locked'), trackId: 'locked-track' },
		{ ...clip('group-locked'), trackId: 'group-child' },
		{
			...clip('sequence-grade'),
			trackId: 'sequence-track',
			type: 'adjustment',
			sequenceColorGrade: true
		}
	]);

	const screen = await render(ColorPrimaryControls, {
		itemId: 'directly-locked',
		itemIds: ['directly-locked', 'group-locked', 'sequence-grade'],
		onedit: vi.fn()
	});
	const input = screen.getByRole('textbox', { name: 'Contrast' }).element();
	if (!(input instanceof HTMLInputElement)) throw new Error('Expected Contrast input');
	input.setPointerCapture = vi.fn();
	input.hasPointerCapture = vi.fn(() => false);
	input.dispatchEvent(
		new PointerEvent('pointerdown', { bubbles: true, pointerId: 2, button: 0, clientX: 100 })
	);
	input.dispatchEvent(
		new PointerEvent('pointermove', { bubbles: true, pointerId: 2, buttons: 1, clientX: 110 })
	);

	await vi.waitFor(() =>
		expect(colorPreviewStore.effectDraft?.itemIds).toEqual(['sequence-grade'])
	);
	input.dispatchEvent(
		new PointerEvent('pointercancel', { bubbles: true, pointerId: 2, button: 0, clientX: 110 })
	);
	await vi.waitFor(() => expect(colorPreviewStore.effectDraft).toBeNull());
});
