/** Shared keyframe selection and clipboard for the dope sheet and value graph. */

import type {
	EasingConfig,
	EasingType,
	KeyframeProperty,
	SpatialBezierTangents,
	TimelineItem
} from '$lib/video-editor/project/types';
import {
	editorKeyframes,
	keyframeIdentity,
	type KeyframeRef
} from '$lib/video-editor/timeline/keyframe-editor';
import { activePositionKeyframes } from '$lib/video-editor/timeline/vector-keyframes';

export interface KeyframeClipboardEntry {
	property: KeyframeProperty;
	/** Frame offset from the first copied keyframe. */
	frame: number;
	value: number;
	easing: EasingType;
	easingConfig?: EasingConfig;
	vectorGroupId?: string;
	spatial?: SpatialBezierTangents;
}

export interface KeyframeClipboard {
	keyframes: KeyframeClipboardEntry[];
	sourceItemId: string;
	originFrame: number;
	sourceRefs: KeyframeRef[];
}

export interface KeyframeSelectionSnapshot {
	itemId: string | null;
	ids: string[];
}

class KeyframeSelectionStore {
	#itemId = $state<string | null>(null);
	#ids = $state<Set<string>>(new Set());
	#clipboard = $state<KeyframeClipboard | null>(null);
	#isCut = $state(false);

	get itemId(): string | null {
		return this.#itemId;
	}

	get ids(): ReadonlySet<string> {
		return this.#ids;
	}

	get clipboard(): KeyframeClipboard | null {
		return this.#clipboard;
	}

	get isCut(): boolean {
		return this.#isCut;
	}

	forItem(itemId: string): ReadonlySet<string> {
		return this.#itemId === itemId ? this.#ids : new Set();
	}

	replace(itemId: string, ids: Iterable<string>): void {
		this.#itemId = itemId;
		this.#ids = new Set(ids);
	}

	clear(): void {
		this.#itemId = null;
		this.#ids = new Set();
	}

	snapshotSelection(): KeyframeSelectionSnapshot {
		return { itemId: this.#itemId, ids: [...this.#ids] };
	}

	restoreSelection(snapshot: KeyframeSelectionSnapshot): void {
		this.#itemId = snapshot.itemId;
		this.#ids = new Set(snapshot.ids);
	}

	prune(itemId: string, validIds: ReadonlySet<string>): void {
		if (this.#itemId !== itemId) return;
		const next = new Set([...this.#ids].filter((id) => validIds.has(id)));
		if (next.size !== this.#ids.size) this.#ids = next;
	}

	copy(item: TimelineItem, ids: ReadonlySet<string>, cut = false): boolean {
		// SAFETY: ItemKeyframes only permits KeyframeProperty keys.
		const properties = new Set<KeyframeProperty>(
			Object.keys(item.keyframes ?? {}) as KeyframeProperty[]
		);
		if (activePositionKeyframes(item)) {
			properties.add('x');
			properties.add('y');
		}
		const allKeyframes = [...properties].flatMap((property) => editorKeyframes(item, property));
		const selectedVectorIds = new Set(
			allKeyframes.flatMap((keyframe) =>
				keyframe.vectorId && ids.has(keyframeIdentity(keyframe)) ? [keyframe.vectorId] : []
			)
		);
		const selected = allKeyframes.filter(
			(keyframe) =>
				ids.has(keyframeIdentity(keyframe)) ||
				Boolean(keyframe.vectorId && selectedVectorIds.has(keyframe.vectorId))
		);
		if (selected.length === 0) return false;
		const originFrame = Math.min(...selected.map((keyframe) => keyframe.frame));
		this.#clipboard = {
			keyframes: selected.map((keyframe) => ({
				property: keyframe.property,
				frame: keyframe.frame - originFrame,
				value: keyframe.value,
				easing: keyframe.easing,
				...(keyframe.vectorId && { vectorGroupId: keyframe.vectorId }),
				...(keyframe.spatial && { spatial: cloneSpatial(keyframe.spatial) }),
				...(keyframe.easingConfig && {
					easingConfig: cloneEasingConfig(keyframe.easingConfig)
				})
			})),
			sourceItemId: item.id,
			originFrame,
			sourceRefs: selected.map((keyframe) => ({
				property: keyframe.property,
				frame: keyframe.frame,
				id: keyframe.id,
				index: keyframe.index,
				vectorId: keyframe.vectorId
			}))
		};
		this.#isCut = cut;
		return true;
	}

	clearClipboard(): void {
		this.#clipboard = null;
		this.#isCut = false;
	}
}

export const keyframeSelectionStore = new KeyframeSelectionStore();

function cloneEasingConfig(config: EasingConfig): EasingConfig {
	return {
		...config,
		...(config.bezier && { bezier: { ...config.bezier } }),
		...(config.spring && { spring: { ...config.spring } })
	};
}

function cloneSpatial(spatial: SpatialBezierTangents): SpatialBezierTangents {
	return {
		...spatial,
		inTangent: { ...spatial.inTangent },
		outTangent: { ...spatial.outTangent }
	};
}
