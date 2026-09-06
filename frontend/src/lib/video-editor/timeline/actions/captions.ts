/** Caption item migrations that cross timeline item shapes. */

import type { CaptionSource, TextStyleFields, TimelineItem } from '../../project/types';
import { execute } from '../commands/command-store.svelte';
import { timelineStore } from '../stores/timeline-store.svelte';
import { effectiveMediaTracks } from '../utils/track-groups';

export interface CaptionConsolidationOptions {
	clipId?: string;
	itemIds?: readonly string[];
}

export interface CaptionConsolidationPlan {
	items: TimelineItem[];
	consumedItemIds: string[];
}

export interface CaptionConsolidationResult {
	itemIds: string[];
	cuesConsolidated: number;
}

type ConsolidatableCaptionItem = TimelineItem & {
	type: 'text';
	text: string;
	captionSource: CaptionSource & {
		type: 'subtitle-import' | 'embedded-subtitles';
	};
};

function textStyle(item: TimelineItem): TextStyleFields {
	return {
		fontFamily: item.fontFamily,
		fontAssetId: item.fontAssetId,
		fontSize: item.fontSize,
		fontWeight: item.fontWeight,
		fontStyle: item.fontStyle,
		underline: item.underline,
		color: item.color,
		backgroundColor: item.backgroundColor,
		backgroundFit: item.backgroundFit,
		textAlign: item.textAlign,
		verticalAlign: item.verticalAlign,
		lineHeight: item.lineHeight,
		letterSpacing: item.letterSpacing,
		textShadow: item.textShadow ? { ...item.textShadow } : undefined,
		strokeWidth: item.strokeWidth,
		strokeColor: item.strokeColor,
		paddingX: item.paddingX,
		paddingY: item.paddingY,
		borderRadius: item.borderRadius
	};
}

function isConsolidatableCaptionItem(item: TimelineItem): item is ConsolidatableCaptionItem {
	return (
		item.type === 'text' &&
		typeof item.text === 'string' &&
		(item.captionSource?.type === 'subtitle-import' ||
			item.captionSource?.type === 'embedded-subtitles') &&
		item.captionSource.clipId.length > 0
	);
}

/** Build one subtitle item for each source clip without changing the timeline. */
export function planCaptionConsolidation(
	items: readonly TimelineItem[],
	options: CaptionConsolidationOptions = {}
): CaptionConsolidationPlan {
	const allowedIds = options.itemIds ? new Set(options.itemIds) : null;
	const groups = new Map<string, ConsolidatableCaptionItem[]>();
	for (const item of items) {
		if (!isConsolidatableCaptionItem(item)) continue;
		if (options.clipId !== undefined && item.captionSource.clipId !== options.clipId) continue;
		if (allowedIds && !allowedIds.has(item.id)) continue;
		const group = groups.get(item.captionSource.clipId) ?? [];
		group.push(item);
		groups.set(item.captionSource.clipId, group);
	}

	const consolidated: TimelineItem[] = [];
	const consumedItemIds: string[] = [];
	for (const [clipId, group] of groups) {
		const sorted = group.toSorted(
			(left, right) => left.from - right.from || left.id.localeCompare(right.id)
		);
		const first = sorted[0]!;
		const from = first.from;
		const end = sorted.reduce(
			(maximum, item) => Math.max(maximum, item.from + item.durationInFrames),
			from + 1
		);
		const sourceClip = items.find(
			(item) => item.id === clipId && (item.type === 'video' || item.type === 'audio')
		);
		consolidated.push({
			id: crypto.randomUUID(),
			trackId: first.trackId,
			from,
			durationInFrames: Math.max(1, end - from),
			label: first.label,
			type: 'subtitle',
			mediaId: first.mediaId,
			linkedGroupId: sourceClip?.linkedGroupId,
			captionSource: { ...first.captionSource },
			cues: sorted.map((item) => ({
				id: item.id,
				startFrame: item.from,
				endFrame: item.from + item.durationInFrames,
				text: item.text
			})),
			...textStyle(first),
			transform: first.transform ? { ...first.transform } : undefined,
			subtitleStyleScale: first.textStyleScale
		});
		consumedItemIds.push(...sorted.map((item) => item.id));
	}

	return { items: consolidated, consumedItemIds };
}

/** Replace matching caption text items as one undoable timeline command. */
export function consolidateCaptionItems(
	options: CaptionConsolidationOptions = {}
): CaptionConsolidationResult {
	const lockedTrackIds = new Set(
		effectiveMediaTracks(timelineStore.tracks)
			.filter((track) => track.locked)
			.map((track) => track.id)
	);
	const eligibleItems = timelineStore.items.filter((item) => !lockedTrackIds.has(item.trackId));
	const plan = planCaptionConsolidation(eligibleItems, options);
	if (plan.items.length === 0) return { itemIds: [], cuesConsolidated: 0 };

	return execute('CONSOLIDATE_CAPTIONS', () => {
		const consumed = new Set(plan.consumedItemIds);
		timelineStore._setItems([
			...timelineStore.items.filter((item) => !consumed.has(item.id)),
			...plan.items
		]);
		return {
			itemIds: plan.items.map((item) => item.id),
			cuesConsolidated: plan.items.reduce((total, item) => total + (item.cues?.length ?? 0), 0)
		};
	});
}
