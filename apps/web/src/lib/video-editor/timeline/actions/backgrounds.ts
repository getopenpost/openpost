import { editorSession } from '../../editor.svelte';
import { timelineStore } from '../stores/timeline-store.svelte';
import { execute } from '../commands/command-store.svelte';
import type { BackgroundPatternKind, ProceduralBackground } from '../../project/types';
import { cloneBackground, type BackgroundPatch } from '../../backgrounds/types';
import { getBackgroundPreset, clonePresetBackground } from '../../backgrounds/presets';
import { ensureOpenTrackForRange } from './track-placement';
import { effectiveMediaTracks } from '../utils/track-groups';

export function addBackgroundItem(presetId?: string): string {
	return execute('ADD_BACKGROUND_ITEM', () => {
		if (
			!effectiveMediaTracks(timelineStore.tracks).some(
				(track) => track.kind !== 'audio' && !track.locked
			)
		) {
			throw new Error('An unlocked visual track is required to add a background.');
		}
		const presetBg = presetId ? clonePresetBackground(presetId) : null;
		const fallback = getBackgroundPreset('mesh-sunset');
		if (!fallback) throw new Error('Missing default background preset.');
		const background = presetBg ?? cloneBackground(fallback.background);
		const projectWidth = editorSession.project?.metadata.width ?? 1920;
		const projectHeight = editorSession.project?.metadata.height ?? 1080;
		const id = crypto.randomUUID();
		const label = presetId ? (getBackgroundPreset(presetId)?.label ?? 'Background') : 'Background';
		const from = timelineStore.currentFrame;
		const durationInFrames = timelineStore.fps * 3;
		const targetTrack = ensureOpenTrackForRange({
			kind: 'video',
			itemType: 'background',
			from,
			durationInFrames,
			label
		});
		timelineStore._addItem({
			id,
			trackId: targetTrack.id,
			from,
			durationInFrames,
			label,
			type: 'background',
			background,
			transform: {
				width: projectWidth,
				height: projectHeight,
				x: 0,
				y: 0,
				opacity: 1
			}
		});
		return id;
	});
}

function applyPatch(itemId: string, patch: BackgroundPatch, commandType: string): boolean {
	return execute(commandType, () => {
		const item = timelineStore.itemById.get(itemId);
		if (!item || item.type !== 'background' || !item.background) return false;
		const current = item.background;
		const next =
			current.kind === 'mesh-gradient'
				? cloneBackground({
						kind: 'mesh-gradient',
						colors: patch.colors ?? current.colors,
						smoothness: patch.smoothness ?? current.smoothness,
						rotation: patch.rotation ?? current.rotation,
						scale: patch.scale ?? current.scale,
						offsetX: patch.offsetX ?? current.offsetX,
						offsetY: patch.offsetY ?? current.offsetY
					})
				: cloneBackground({
						kind: 'pattern',
						pattern: patch.pattern ?? current.pattern,
						foreground: patch.foreground ?? current.foreground,
						background: patch.background ?? current.background,
						scale: patch.scale ?? current.scale,
						rotation: patch.rotation ?? current.rotation,
						offsetX: patch.offsetX ?? current.offsetX,
						offsetY: patch.offsetY ?? current.offsetY,
						density: patch.density ?? current.density,
						foregroundOpacity: patch.foregroundOpacity ?? current.foregroundOpacity
					});
		timelineStore._updateItems([{ id: itemId, patch: { background: next } }]);
		return true;
	});
}

export function updateBackground(
	itemId: string,
	patch: BackgroundPatch,
	commandType = 'UPDATE_BACKGROUND'
): boolean {
	return applyPatch(itemId, patch, commandType);
}

export function updateBackgroundRotation(itemId: string, rotation: number): boolean {
	return applyPatch(itemId, { rotation }, 'UPDATE_BACKGROUND_ROTATION');
}

export function updateBackgroundScale(itemId: string, scale: number): boolean {
	return applyPatch(itemId, { scale }, 'UPDATE_BACKGROUND_SCALE');
}

export function updateBackgroundOffsetX(itemId: string, offsetX: number): boolean {
	return applyPatch(itemId, { offsetX }, 'UPDATE_BACKGROUND_OFFSET_X');
}

export function updateBackgroundOffsetY(itemId: string, offsetY: number): boolean {
	return applyPatch(itemId, { offsetY }, 'UPDATE_BACKGROUND_OFFSET_Y');
}

export function updateBackgroundSmoothness(itemId: string, smoothness: number): boolean {
	return applyPatch(itemId, { smoothness }, 'UPDATE_BACKGROUND_SMOOTHNESS');
}

export function updateBackgroundDensity(itemId: string, density: number): boolean {
	return applyPatch(itemId, { density }, 'UPDATE_BACKGROUND_DENSITY');
}

export function updateBackgroundForegroundOpacity(
	itemId: string,
	foregroundOpacity: number
): boolean {
	return applyPatch(itemId, { foregroundOpacity }, 'UPDATE_BACKGROUND_FOREGROUND_OPACITY');
}

export function updateBackgroundColors(
	itemId: string,
	colors: [string, string, string, string]
): boolean {
	return applyPatch(itemId, { colors }, 'UPDATE_BACKGROUND_COLORS');
}

export function updateBackgroundPatternKind(
	itemId: string,
	pattern: BackgroundPatternKind
): boolean {
	return applyPatch(itemId, { pattern }, 'UPDATE_BACKGROUND_PATTERN');
}

export function updateBackgroundForeground(itemId: string, foreground: string): boolean {
	return applyPatch(itemId, { foreground }, 'UPDATE_BACKGROUND_FOREGROUND');
}

export function updateBackgroundBackgroundColor(itemId: string, background: string): boolean {
	return applyPatch(itemId, { background }, 'UPDATE_BACKGROUND_BACKGROUND');
}

export function setBackground(itemId: string, background: ProceduralBackground): boolean {
	return execute('SET_BACKGROUND', () => {
		const item = timelineStore.itemById.get(itemId);
		if (!item || item.type !== 'background') return false;
		timelineStore._updateItems([
			{ id: itemId, patch: { background: cloneBackground(background) } }
		]);
		return true;
	});
}
