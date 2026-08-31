/** Undoable text layout and template actions. */

import type {
	TextLayoutDrafts,
	TextSpan,
	TextStylePresetId,
	TimelineItem
} from '../../project/types';
import {
	buildEditableBaseSpans,
	buildSpanLayout,
	buildTextSingleLayoutDraft,
	cloneTextLayoutDrafts,
	getTextItemLayoutMode,
	type TextLayoutMode
} from '../../typography/text-layout-drafts';
import {
	applyTextStylePresetToItem,
	buildTextStylePresetTemplate,
	TEXT_STYLE_PRESETS,
	type TextCanvasSize,
	type TextStylePresetCopy
} from '../../typography/text-style-presets';
import { buildTextItemLabelFromText } from '../../typography/text-item-spans';
import { execute } from '../commands/command-store.svelte';
import { timelineStore } from '../stores/timeline-store.svelte';

export type TextEffectPresetId = 'none' | 'shadow' | 'outline' | 'glow';

function textEffectPatch(presetId: TextEffectPresetId, color: string): Partial<TimelineItem> {
	switch (presetId) {
		case 'none':
			return {
				textShadow: undefined,
				strokeWidth: undefined,
				strokeColor: undefined
			};
		case 'shadow':
			return {
				textShadow: { offsetX: 4, offsetY: 6, blur: 12, color: '#000000' },
				strokeWidth: undefined,
				strokeColor: undefined
			};
		case 'outline':
			return {
				textShadow: undefined,
				strokeWidth: 3,
				strokeColor: '#111827'
			};
		case 'glow':
			return {
				textShadow: { offsetX: 0, offsetY: 0, blur: 18, color },
				strokeWidth: 1,
				strokeColor: color
			};
	}
}

/** Apply FreeCut's independent text effects to every selected text clip as one edit. */
export function applyTextEffectPreset(
	itemIds: readonly string[],
	presetId: TextEffectPresetId
): number {
	const items = [...new Set(itemIds)]
		.map((itemId) => timelineStore.itemById.get(itemId))
		.filter((item): item is TimelineItem => item?.type === 'text');
	if (items.length === 0) return 0;

	const effectColor = items[0]?.color ?? '#ffffff';
	const patch = textEffectPatch(presetId, effectColor);
	execute('APPLY_TEXT_EFFECT_PRESET', () => {
		timelineStore._updateItems(items.map((item) => ({ id: item.id, patch })));
	});
	return items.length;
}

function currentTextItem(itemId: string): TimelineItem | undefined {
	const item = timelineStore.itemById.get(itemId);
	return item?.type === 'text' ? item : undefined;
}

function draftKey(layout: Exclude<TextLayoutMode, 'single'>): 'twoSpans' | 'threeSpans' {
	return layout === 'two' ? 'twoSpans' : 'threeSpans';
}

function saveCurrentLayout(item: TimelineItem): TextLayoutDrafts {
	const drafts = cloneTextLayoutDrafts(item.textLayoutDrafts) ?? {};
	const layout = getTextItemLayoutMode(item);
	if (layout === 'single') drafts.single = buildTextSingleLayoutDraft(item);
	else drafts[draftKey(layout)] = item.textSpans?.map((span) => ({ ...span })) ?? [];
	return drafts;
}

function commitTextPatch(itemId: string, commandType: string, patch: Partial<TimelineItem>): void {
	execute(commandType, () => timelineStore._updateItems([{ id: itemId, patch }]));
}

export function setTextItemLayout(itemId: string, layout: TextLayoutMode): boolean {
	const item = currentTextItem(itemId);
	if (!item || getTextItemLayoutMode(item) === layout) return false;
	const drafts = saveCurrentLayout(item);

	if (layout === 'single') {
		const single = drafts.single ?? buildTextSingleLayoutDraft(item);
		commitTextPatch(itemId, 'SET_TEXT_LAYOUT', {
			text: single.text,
			textSpans: undefined,
			spanLayout: undefined,
			label: buildTextItemLabelFromText(single.text),
			fontSize: single.fontSize,
			fontFamily: single.fontFamily,
			fontWeight: single.fontWeight,
			fontStyle: single.fontStyle,
			underline: single.underline,
			color: single.color ?? item.color,
			letterSpacing: single.letterSpacing,
			textLayoutDrafts: drafts
		});
		return true;
	}

	const key = draftKey(layout);
	const spans = buildSpanLayout(
		drafts[key] ?? buildEditableBaseSpans(item),
		item,
		layout === 'two' ? 2 : 3
	);
	const text = spans.map((span) => span.text).join('\n');
	commitTextPatch(itemId, 'SET_TEXT_LAYOUT', {
		text,
		textSpans: spans,
		spanLayout: 'stack',
		label: buildTextItemLabelFromText(text),
		backgroundFit: 'content',
		textLayoutDrafts: drafts
	});
	return true;
}

export function updateTextSpan(itemId: string, index: number, patch: Partial<TextSpan>): boolean {
	const item = currentTextItem(itemId);
	if (!item?.textSpans?.[index]) return false;
	const spans = item.textSpans.map((span, spanIndex) =>
		spanIndex === index ? { ...span, ...patch } : { ...span }
	);
	const text = spans.map((span) => span.text).join('\n');
	commitTextPatch(itemId, 'UPDATE_TEXT_SPAN', {
		text,
		textSpans: spans,
		label: buildTextItemLabelFromText(text)
	});
	return true;
}

function copyForTemplate(item: TimelineItem, templateSpans: TextSpan[]): TextSpan[] {
	const current = item.textSpans?.length
		? item.textSpans
		: [{ text: buildTextSingleLayoutDraft(item).text }];
	const currentLayout = getTextItemLayoutMode(item);
	if (templateSpans.length === 2) {
		const copy =
			currentLayout === 'three'
				? [current[1]?.text, current[2]?.text]
				: [current[0]?.text, current[1]?.text];
		return templateSpans.map((span, index) => ({
			...span,
			text: copy[index] || span.text
		}));
	}
	if (templateSpans.length >= 3) {
		const copy =
			currentLayout === 'three'
				? [current[0]?.text, current[1]?.text, current[2]?.text]
				: currentLayout === 'two'
					? [undefined, current[0]?.text, current[1]?.text]
					: [undefined, current[0]?.text, undefined];
		return templateSpans.map((span, index) => ({
			...span,
			text: copy[index] || span.text
		}));
	}
	return templateSpans;
}

export function applyTextStylePreset(
	itemId: string,
	presetId: TextStylePresetId,
	canvas: TextCanvasSize,
	styleScale = 1,
	copyOverride?: TextStylePresetCopy
): boolean {
	const item = currentTextItem(itemId);
	if (!item) return false;
	if (item.textStylePresetId === presetId) {
		commitTextPatch(
			itemId,
			'APPLY_TEXT_STYLE_PRESET',
			applyTextStylePresetToItem(item, presetId, canvas, styleScale, copyOverride)
		);
		return true;
	}

	const preset = TEXT_STYLE_PRESETS.find((candidate) => candidate.id === presetId);
	if (!preset) return false;
	const template = buildTextStylePresetTemplate(presetId, canvas, styleScale, copyOverride);
	const drafts = saveCurrentLayout(item);
	if (preset.layout === 'single') {
		const single = buildTextSingleLayoutDraft(item);
		commitTextPatch(itemId, 'APPLY_TEXT_STYLE_PRESET', {
			...template,
			text: single.text,
			textSpans: undefined,
			spanLayout: undefined,
			label: buildTextItemLabelFromText(single.text),
			textLayoutDrafts: drafts
		});
		return true;
	}

	const spans = copyForTemplate(item, template.textSpans ?? []);
	const text = spans.map((span) => span.text).join('\n');
	commitTextPatch(itemId, 'APPLY_TEXT_STYLE_PRESET', {
		...template,
		text,
		textSpans: spans,
		spanLayout: 'stack',
		label: buildTextItemLabelFromText(text),
		textLayoutDrafts: drafts
	});
	return true;
}
