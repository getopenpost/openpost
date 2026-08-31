import { CURRENT_SCHEMA_VERSION } from './defaults';
import type {
	AnimationPreset,
	KeyframeProperty,
	Project,
	ProjectTimeline,
	SubComposition,
	TimelineItem,
	TimelineMarker,
	TimelineTrack,
	TimelineTransition
} from './types';

export interface CloneProjectOptions {
	name?: string;
	mediaIdMap?: ReadonlyMap<string, string>;
	now?: number;
	createId?: () => string;
}

export interface CloneSubCompositionOptions {
	name?: string;
	createId?: () => string;
}

interface ProjectIdMaps {
	composition: Map<string, string>;
	track: Map<string, string>;
	item: Map<string, string>;
	linkedGroup: Map<string, string>;
	origin: Map<string, string>;
	motionLayer: Map<string, string>;
}

function allItems(timeline: ProjectTimeline): TimelineItem[] {
	return [...timeline.items, ...(timeline.compositions ?? []).flatMap((entry) => entry.items)];
}

function allTracks(timeline: ProjectTimeline): TimelineTrack[] {
	return [...timeline.tracks, ...(timeline.compositions ?? []).flatMap((entry) => entry.tracks)];
}

function createMappedIds(values: readonly string[], createId: () => string): Map<string, string> {
	return new Map([...new Set(values)].map((value) => [value, createId()]));
}

function buildIdMaps(timeline: ProjectTimeline, createId: () => string): ProjectIdMaps {
	const items = allItems(timeline);
	return {
		composition: createMappedIds(
			(timeline.compositions ?? []).map((entry) => entry.id),
			createId
		),
		track: createMappedIds(
			allTracks(timeline).map((track) => track.id),
			createId
		),
		item: createMappedIds(
			items.map((item) => item.id),
			createId
		),
		linkedGroup: createMappedIds(
			items.flatMap((item) => (item.linkedGroupId ? [item.linkedGroupId] : [])),
			createId
		),
		origin: createMappedIds(
			items.flatMap((item) => (item.originId ? [item.originId] : [])),
			createId
		),
		motionLayer: createMappedIds(
			items.flatMap((item) => (item.motionLayers ?? []).map((layer) => layer.id)),
			createId
		)
	};
}

function mapped(value: string | undefined, ids: ReadonlyMap<string, string>): string | undefined {
	return value ? (ids.get(value) ?? value) : undefined;
}

function remapExpression(source: string, itemIds: ReadonlyMap<string, string>): string {
	return source.replace(/prop\(\s*(["'])([^"']+)\1/g, (match, quote: string, itemId: string) => {
		const replacement = itemIds.get(itemId);
		return replacement ? `prop(${quote}${replacement}${quote}` : match;
	});
}

function remapMarker(marker: TimelineMarker, createId: () => string): TimelineMarker {
	return { ...marker, id: createId() };
}

function remapEffectKeyframeProperty(
	property: string,
	effectIds: ReadonlyMap<string, string>
): KeyframeProperty {
	const match = /^effect:([^:]+):([^:]+):(.+)$/.exec(property);
	if (!match) {
		// SAFETY: Every caller reads this key from an ItemKeyframes map or AnimationPresetProperty.
		return property as KeyframeProperty;
	}
	const [, effectType, effectId, paramName] = match;
	const remappedId = effectId ? effectIds.get(effectId) : undefined;
	if (!remappedId || !effectType || !paramName) {
		// SAFETY: The input was already a valid effect keyframe property from the project model.
		return property as KeyframeProperty;
	}
	return `effect:${effectType}:${remappedId}:${paramName}`;
}

function remapTransition(
	transition: TimelineTransition,
	maps: ProjectIdMaps,
	createId: () => string
): TimelineTransition {
	return {
		...transition,
		id: createId(),
		fromItemId: mapped(transition.fromItemId, maps.item) ?? transition.fromItemId,
		toItemId: mapped(transition.toItemId, maps.item) ?? transition.toItemId
	};
}

function remapItem(
	item: TimelineItem,
	maps: ProjectIdMaps,
	mediaIdMap: ReadonlyMap<string, string>,
	createId: () => string
): TimelineItem {
	const remappedId = maps.item.get(item.id) ?? createId();
	const effectIds = createMappedIds(
		(item.effects ?? []).map((effect) => effect.id),
		createId
	);
	const clonedBackground = item.background ? structuredClone(item.background) : undefined;
	return {
		...item,
		background: clonedBackground,
		id: remappedId,
		trackId: maps.track.get(item.trackId) ?? item.trackId,
		mediaId: mapped(item.mediaId, mediaIdMap),
		originId: mapped(item.originId, maps.origin),
		linkedGroupId: mapped(item.linkedGroupId, maps.linkedGroup),
		compositionId: mapped(item.compositionId, maps.composition),
		compositionControlOverrides: item.compositionControlOverrides
			? { ...item.compositionControlOverrides }
			: undefined,
		...(item.transformParent && {
			transformParent: {
				...item.transformParent,
				parentItemId:
					mapped(item.transformParent.parentItemId, maps.item) ?? item.transformParent.parentItemId,
				parentReference: item.transformParent.parentReference
					? { ...item.transformParent.parentReference }
					: undefined,
				childLocalReference: { ...item.transformParent.childLocalReference },
				childWorldReference: { ...item.transformParent.childWorldReference }
			}
		}),
		...(item.captionSource && {
			captionSource: {
				...item.captionSource,
				clipId: mapped(item.captionSource.clipId, maps.item) ?? item.captionSource.clipId,
				mediaId: mapped(item.captionSource.mediaId, mediaIdMap) ?? item.captionSource.mediaId
			}
		}),
		...(item.cues && {
			cues: item.cues.map((cue) => ({
				...cue,
				id: createId(),
				...(cue.words && {
					words: cue.words.map((word) => ({ ...word, id: createId() }))
				})
			}))
		}),
		...(item.propertyLinks && {
			propertyLinks: item.propertyLinks.map((link) => ({
				...link,
				sourceItemId: mapped(link.sourceItemId, maps.item) ?? link.sourceItemId
			}))
		}),
		...(item.expressions && {
			expressions: item.expressions.map((expression) => ({
				...expression,
				source: remapExpression(expression.source, maps.item)
			}))
		}),
		...(item.effects && {
			effects: item.effects.map((effect) => ({
				...effect,
				id: effectIds.get(effect.id) ?? createId()
			}))
		}),
		...(item.motionModifiers && {
			motionModifiers: item.motionModifiers.map((modifier) => ({
				...modifier,
				id: createId()
			}))
		}),
		...(item.motionLayers && {
			motionLayers: item.motionLayers.map((layer) => ({
				...layer,
				id: maps.motionLayer.get(layer.id) ?? createId(),
				tracks: layer.tracks.map((track) => ({
					...track,
					keyframes: track.keyframes.map((keyframe) => ({ ...keyframe, id: createId() }))
				}))
			}))
		}),
		...(item.keyframes && {
			keyframes: Object.fromEntries(
				Object.entries(item.keyframes).map(([property, track]) => [
					remapEffectKeyframeProperty(property, effectIds),
					track && {
						...track,
						...(track.ids && { ids: track.ids.map(() => createId()) })
					}
				])
			)
		}),
		...(item.vectorKeyframes && {
			vectorKeyframes: Object.fromEntries(
				Object.entries(item.vectorKeyframes).map(([property, keyframes]) => [
					property,
					keyframes?.map((keyframe) => ({ ...keyframe, id: createId() }))
				])
			)
		}),
		...(item.audioEffects && {
			audioEffects: item.audioEffects.map((effect) => ({ ...effect, id: createId() }))
		})
	};
}

function remapComposition(
	composition: SubComposition,
	maps: ProjectIdMaps,
	mediaIdMap: ReadonlyMap<string, string>,
	createId: () => string
): SubComposition {
	return {
		...composition,
		id: maps.composition.get(composition.id) ?? createId(),
		tracks: composition.tracks.map((track) => ({
			...track,
			id: maps.track.get(track.id) ?? track.id
		})),
		items: composition.items.map((item) => remapItem(item, maps, mediaIdMap, createId)),
		compositionControls: composition.compositionControls
			? {
					...composition.compositionControls,
					controls: composition.compositionControls.controls.map((control) => ({
						...control,
						targetItemId: mapped(control.targetItemId, maps.item) ?? control.targetItemId
					}))
				}
			: undefined,
		transitions: composition.transitions.map((transition) =>
			remapTransition(transition, maps, createId)
		),
		markers: composition.markers?.map((marker) => remapMarker(marker, createId))
	};
}

/** Clone one reusable timeline while preserving media and nested-composition references. */
export function cloneSubCompositionDocument(
	composition: SubComposition,
	options: CloneSubCompositionOptions = {}
): SubComposition {
	const createId = options.createId ?? (() => crypto.randomUUID());
	const maps = buildIdMaps({ tracks: [], items: [], compositions: [composition] }, createId);
	return {
		...remapComposition(composition, maps, new Map(), createId),
		name: options.name ?? `${composition.name} copy`
	};
}

function remapPreset(
	preset: AnimationPreset,
	createId: () => string,
	now: number
): AnimationPreset {
	const effectIds = createMappedIds(
		preset.effects.map((effect) => effect.id),
		createId
	);
	return {
		...preset,
		id: createId(),
		createdAt: now,
		properties: preset.properties.map((property) => ({
			...property,
			property: remapEffectKeyframeProperty(property.property, effectIds),
			keyframes: property.keyframes.map((keyframe) => ({
				...keyframe,
				id: createId()
			}))
		})),
		vectorProperties: preset.vectorProperties?.map((property) => ({
			...property,
			keyframes: property.keyframes.map((keyframe) => ({
				...keyframe,
				id: createId()
			}))
		})),
		effects: preset.effects.map((effect) => ({
			...effect,
			id: effectIds.get(effect.id) ?? createId()
		})),
		motionModifiers: preset.motionModifiers?.map((modifier) => ({
			...modifier,
			id: createId()
		})),
		motionLayers: preset.motionLayers?.map((layer) => ({
			...layer,
			id: createId(),
			tracks: layer.tracks.map((track) => ({
				...track,
				keyframes: track.keyframes.map((keyframe) => ({ ...keyframe, id: createId() }))
			}))
		}))
	};
}

export function cloneProjectDocument(project: Project, options: CloneProjectOptions = {}): Project {
	const createId = options.createId ?? (() => crypto.randomUUID());
	const now = options.now ?? Date.now();
	const mediaIdMap = options.mediaIdMap ?? new Map<string, string>();
	const { rootFolderHandle: _rootFolderHandle, ...serializable } = project;
	const cloned = structuredClone(serializable);
	const timeline = cloned.timeline;
	if (timeline) {
		const maps = buildIdMaps(timeline, createId);
		cloned.timeline = {
			...timeline,
			tracks: timeline.tracks.map((track) => ({
				...track,
				id: maps.track.get(track.id) ?? track.id
			})),
			items: timeline.items.map((item) => remapItem(item, maps, mediaIdMap, createId)),
			markers: timeline.markers?.map((marker) => remapMarker(marker, createId)),
			transitions: timeline.transitions?.map((transition) =>
				remapTransition(transition, maps, createId)
			),
			topLevelSequenceIds: timeline.topLevelSequenceIds?.map(
				(id) => maps.composition.get(id) ?? id
			),
			compositions: timeline.compositions?.map((composition) =>
				remapComposition(composition, maps, mediaIdMap, createId)
			)
		};
	}

	return {
		...cloned,
		id: createId(),
		name: options.name ?? `${project.name} copy`,
		createdAt: now,
		updatedAt: now,
		schemaVersion: CURRENT_SCHEMA_VERSION,
		thumbnailId: undefined,
		animationPresets: cloned.animationPresets?.map((preset) => remapPreset(preset, createId, now)),
		rootFolderName: undefined
	};
}
