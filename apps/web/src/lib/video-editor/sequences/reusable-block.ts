import type { SubComposition, TimelineItem } from '../project/types';
import { cloneSubCompositionDocument } from '../project/project-clone';
import { executeAtomic } from '../timeline/commands/command-store.svelte';
import { timelineStore } from '../timeline/stores/timeline-store.svelte';
import { trackRangeIsOpen } from '../timeline/track-occupancy';
import { effectiveMediaTracks } from '../timeline/utils/track-groups';
import { snapshotTimelineState } from '../timeline/utils/state-snapshot.svelte';
import { sequenceStore } from './sequence-store.svelte';

function motionFrames(item: TimelineItem): number[] {
	return [
		...Object.values(item.keyframes ?? {}).flatMap((track) => track?.frames ?? []),
		...Object.values(item.vectorKeyframes ?? {}).flatMap(
			(keys) => keys?.map((key) => key.frame) ?? []
		),
		...(item.motionLayers ?? []).flatMap((layer) =>
			layer.tracks.flatMap((track) => track.keyframes.map((key) => key.frame))
		)
	];
}

function scalarHolds(frames: number[], values: number[], from: number, to: number): boolean {
	for (let index = 1; index < frames.length; index++) {
		if (frames[index]! <= from || frames[index - 1]! >= to) continue;
		if (values[index - 1] !== values[index]) return false;
	}
	return true;
}

function hasQuietMotion(item: TimelineItem, start: number, end: number): boolean {
	const from = start - item.from;
	const to = end - item.from;
	if (
		item.textMotion ||
		item.type === 'lottie' ||
		item.type === 'subtitle' ||
		item.propertyLinks?.length
	)
		return false;
	if (
		Object.values(item.keyframes ?? {}).some(
			(track) => track && !scalarHolds(track.frames, track.values, from, to)
		)
	)
		return false;
	if (
		(item.motionLayers ?? []).some((layer) =>
			layer.tracks.some(
				(track) =>
					!scalarHolds(
						track.keyframes.map((key) => key.frame),
						track.keyframes.map((key) => key.value),
						from,
						to
					)
			)
		)
	)
		return false;
	for (const keys of Object.values(item.vectorKeyframes ?? {})) {
		if (!keys) continue;
		for (let index = 1; index < keys.length; index++) {
			const left = keys[index - 1]!;
			const right = keys[index]!;
			if (right.frame <= from || left.frame >= to) continue;
			if (
				left.value.x !== right.value.x ||
				left.value.y !== right.value.y ||
				left.spatial ||
				right.spatial
			)
				return false;
		}
	}
	return true;
}

/** Find a quiet hold between authored events, leaving entrance and exit timing intact. */
export function reusableBlockHold(
	items: TimelineItem[],
	duration: number
): SubComposition['reusableHold'] {
	const boundaries = [
		...new Set([
			0,
			duration,
			...items.flatMap((item) => [
				item.from,
				item.from + item.durationInFrames,
				...motionFrames(item).map((frame) => item.from + frame)
			])
		])
	].sort((a, b) => a - b);
	let hold: SubComposition['reusableHold'];
	for (let index = 1; index < boundaries.length; index++) {
		const start = boundaries[index - 1]!;
		const end = boundaries[index]!;
		if (end - start < 2 || (hold && end - start <= hold.end - hold.start)) continue;
		const active = items.filter(
			(item) => item.from < end && item.from + item.durationInFrames > start
		);
		if (
			!active.length ||
			active.some(
				(item) =>
					item.type === 'video' ||
					item.type === 'audio' ||
					!hasQuietMotion(item, start, end) ||
					item.compositionId ||
					item.motionModifiers?.length ||
					item.expressions?.length
			)
		)
			continue;
		hold = { start, end };
	}
	return hold;
}

export function resizeReusableBlock(itemId: string, seconds: number): boolean {
	const wrapper = timelineStore.itemById.get(itemId);
	const source = wrapper?.compositionId
		? sequenceStore.compositionById.get(wrapper.compositionId)
		: undefined;
	if (
		!wrapper ||
		!source?.reusableHold ||
		!Number.isFinite(seconds) ||
		seconds <= 0 ||
		wrapper.speed !== 1 ||
		wrapper.sourceStart !== 0
	)
		return false;
	const duration = Math.round(seconds * source.fps);
	const delta = duration - source.durationInFrames;
	const hold = reusableBlockHold(source.items, source.durationInFrames);
	if (!hold) return false;
	if (hold.end + delta <= hold.start) return false;
	const wrappers = timelineStore.items.filter(
		(item) =>
			item.id === wrapper.id ||
			(wrapper.linkedGroupId && item.linkedGroupId === wrapper.linkedGroupId)
	);
	const ids = new Set(wrappers.map((item) => item.id));
	const nextDuration = Math.round(seconds * timelineStore.fps);
	const tracks = effectiveMediaTracks(timelineStore.tracks);
	if (
		wrappers.some(
			(item) =>
				tracks.find((track) => track.id === item.trackId)?.locked ||
				!trackRangeIsOpen(
					timelineStore.items,
					item.trackId,
					item.from,
					nextDuration,
					item.type,
					ids
				)
		)
	)
		return false;
	return executeAtomic('RESIZE_REUSABLE_BLOCK', () => {
		const copy = cloneSubCompositionDocument(snapshotTimelineState(source), {
			name: source.name
		});
		const mapFrame = (frame: number) => (frame >= hold.end ? frame + delta : frame);
		copy.items = copy.items.map((item) => {
			const from = mapFrame(item.from);
			const mapLocal = (frame: number) => mapFrame(item.from + frame) - from;
			return {
				...item,
				from,
				durationInFrames: mapFrame(item.from + item.durationInFrames) - from,
				keyframes:
					item.keyframes &&
					Object.fromEntries(
						Object.entries(item.keyframes).map(([key, track]) => [
							key,
							track && { ...track, frames: track.frames.map(mapLocal) }
						])
					),
				vectorKeyframes:
					item.vectorKeyframes &&
					Object.fromEntries(
						Object.entries(item.vectorKeyframes).map(([key, keys]) => [
							key,
							keys!.map((key) => ({ ...key, frame: mapLocal(key.frame) }))
						])
					),
				motionLayers: item.motionLayers?.map((layer) => ({
					...layer,
					tracks: layer.tracks.map((track) => ({
						...track,
						keyframes: track.keyframes.map((key) => ({
							...key,
							frame: mapLocal(key.frame)
						}))
					}))
				}))
			};
		});
		copy.durationInFrames = duration;
		copy.reusableHold = { start: hold.start, end: hold.end + delta };
		sequenceStore.addComposition(copy);
		timelineStore._setItems(
			timelineStore.items.map((item) =>
				ids.has(item.id)
					? {
							...item,
							compositionId: copy.id,
							durationInFrames: nextDuration,
							sourceEnd: duration,
							sourceDuration: duration
						}
					: item
			)
		);
		return true;
	});
}
