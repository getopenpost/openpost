import { beforeEach, describe, expect, it } from 'vitest';
import type { TimelineItem, TimelineTrack } from '../../project/types';
import { commandHistory } from '../commands/command-store.svelte';
import { timelineStore } from '../stores/timeline-store.svelte';
import {
	applyTextEffectPreset,
	applyTextStylePreset,
	setTextItemLayout,
	updateTextSpan
} from './text-layout';

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

function textItem(): TimelineItem {
	return {
		id: 'text',
		trackId: track.id,
		from: 0,
		durationInFrames: 90,
		label: 'Launch',
		text: 'Launch',
		type: 'text',
		fontSize: 100,
		fontFamily: 'Inter',
		fontWeight: 700,
		color: '#ffffff'
	};
}

beforeEach(() => {
	commandHistory.clearHistory();
	timelineStore.__resetForTesting();
	timelineStore.setAll({ tracks: [track], items: [textItem()], currentFrame: 0, fps: 30 });
});

describe('text layout actions', () => {
	it('round-trips one, two, and three line drafts in one undo step per switch', () => {
		expect(setTextItemLayout('text', 'three')).toBe(true);
		expect(timelineStore.itemById.get('text')).toMatchObject({
			text: 'Tag\nLaunch\nSubtitle',
			textSpans: [{ text: 'Tag' }, { text: 'Launch' }, { text: 'Subtitle' }],
			backgroundFit: 'content'
		});
		expect(updateTextSpan('text', 0, { text: 'NEW' })).toBe(true);
		expect(setTextItemLayout('text', 'single')).toBe(true);
		expect(timelineStore.itemById.get('text')).toMatchObject({ text: 'Launch', fontSize: 100 });
		expect(timelineStore.itemById.get('text')?.textSpans).toBeUndefined();
		expect(setTextItemLayout('text', 'three')).toBe(true);
		expect(timelineStore.itemById.get('text')?.textSpans?.map((span) => span.text)).toEqual([
			'NEW',
			'Launch',
			'Subtitle'
		]);
		expect(commandHistory.undoStack).toHaveLength(4);
	});

	it('applies a structured preset without discarding the creator copy', () => {
		expect(applyTextStylePreset('text', 'lower-third', { width: 1920, height: 1080 })).toBe(true);
		expect(timelineStore.itemById.get('text')).toMatchObject({
			text: 'Launch\nRole or subtitle',
			textStylePresetId: 'lower-third',
			textStyleScale: 1,
			fontFamily: 'Inter',
			fontWeight: 600,
			backgroundFit: 'content',
			textSpans: [
				{ text: 'Launch', fontWeight: 700 },
				{ text: 'Role or subtitle', color: '#cbd5e1' }
			]
		});
		expect(commandHistory.undoStack).toHaveLength(1);
	});

	it('keeps edited structured copy while resizing its active recipe', () => {
		applyTextStylePreset('text', 'lower-third', { width: 1920, height: 1080 });
		updateTextSpan('text', 1, { text: 'Founder' });
		expect(applyTextStylePreset('text', 'lower-third', { width: 1920, height: 1080 }, 1.5)).toBe(
			true
		);
		expect(timelineStore.itemById.get('text')).toMatchObject({
			text: 'Launch\nFounder',
			textStyleScale: 1.5,
			textSpans: [{ text: 'Launch' }, { text: 'Founder' }]
		});
	});

	it('applies FreeCut text effects to a selection as one undoable edit', () => {
		timelineStore._addItem({ ...textItem(), id: 'text-two', color: '#22d3ee' });
		commandHistory.clearHistory();

		expect(applyTextEffectPreset(['text', 'text-two'], 'glow')).toBe(2);
		for (const id of ['text', 'text-two']) {
			expect(timelineStore.itemById.get(id)).toMatchObject({
				strokeWidth: 1,
				strokeColor: '#ffffff',
				textShadow: { offsetX: 0, offsetY: 0, blur: 18, color: '#ffffff' }
			});
		}
		expect(commandHistory.undoStack).toHaveLength(1);

		commandHistory.undo();
		expect(timelineStore.itemById.get('text')?.textShadow).toBeUndefined();
		expect(timelineStore.itemById.get('text-two')?.strokeWidth).toBeUndefined();
	});
});
