import type { GradeEffectSnapshot, PickedColor } from './color-grade';
import type { GpuEffect, ItemEffect } from './types';
import { defaultGpuParams, type GpuParamValues } from './gpu/types';
import { getGpuEffect } from './gpu/registry';
import type { EditorColorComparisonMode } from '$lib/editor-color-grade/controls';

export type ColorComparisonMode = EditorColorComparisonMode;
export type ColorPickerKind = 'white-balance' | 'black-point' | 'white-point';

export interface ActiveColorPicker {
	itemId: string;
	kind: ColorPickerKind;
}

export interface ColorEffectDraft {
	itemId: string;
	itemIds: string[];
	effectIds: string[];
	effectType: string;
	enabled: boolean;
	params: GpuParamValues;
}

let comparisonMode = $state<ColorComparisonMode>('after');
let comparisonItemIds = $state<string[]>([]);
let splitPosition = $state(0.5);
let activePicker = $state<ActiveColorPicker | null>(null);
let pickerResolver: ((color: PickedColor | null) => void) | null = null;
let gradeClipboard = $state<GradeEffectSnapshot[] | null>(null);
let frameCaptureItemId = $state<string | null>(null);
let frameCaptureResolver: ((image: ImageData | null) => void) | null = null;
let frameCaptureTimeout: ReturnType<typeof setTimeout> | null = null;
let effectDraft = $state<ColorEffectDraft | null>(null);
let scopeSampleItemId = $state<string | null>(null);

function cloneGrade(grade: readonly GradeEffectSnapshot[]): GradeEffectSnapshot[] {
	return grade.map((entry) => ({
		...entry,
		params: { ...entry.params }
	}));
}

export const colorPreviewStore = {
	get comparisonMode() {
		return comparisonMode;
	},
	get splitPosition() {
		return splitPosition;
	},
	get comparisonItemIds() {
		return comparisonItemIds;
	},
	get activePicker() {
		return activePicker;
	},
	get gradeClipboard() {
		return gradeClipboard;
	},
	get frameCaptureItemId() {
		return frameCaptureItemId;
	},
	get effectDraft() {
		return effectDraft;
	},
	get scopeSampleItemId() {
		return scopeSampleItemId;
	},
	setScopeSampleItemId(itemId: string | null): void {
		scopeSampleItemId = itemId;
	},
	setComparisonMode(mode: ColorComparisonMode, itemIds: readonly string[] = []): void {
		comparisonMode = mode;
		comparisonItemIds = mode === 'after' ? [] : [...new Set(itemIds)];
	},
	setSplitPosition(position: number): void {
		splitPosition = Math.max(0.05, Math.min(0.95, position));
	},
	requestPick(itemId: string, kind: ColorPickerKind): Promise<PickedColor | null> {
		this.cancelPick();
		activePicker = { itemId, kind };
		return new Promise((resolve) => {
			pickerResolver = resolve;
		});
	},
	resolvePick(color: PickedColor): void {
		const resolve = pickerResolver;
		pickerResolver = null;
		activePicker = null;
		resolve?.(color);
	},
	cancelPick(): void {
		const resolve = pickerResolver;
		pickerResolver = null;
		activePicker = null;
		resolve?.(null);
	},
	requestFrameCapture(itemId: string): Promise<ImageData | null> {
		this.cancelFrameCapture();
		frameCaptureItemId = itemId;
		return new Promise((resolve) => {
			frameCaptureResolver = resolve;
			frameCaptureTimeout = setTimeout(() => this.cancelFrameCapture(), 1500);
		});
	},
	resolveFrameCapture(itemId: string, image: ImageData): void {
		if (frameCaptureItemId !== itemId) return;
		const resolve = frameCaptureResolver;
		if (frameCaptureTimeout) clearTimeout(frameCaptureTimeout);
		frameCaptureTimeout = null;
		frameCaptureResolver = null;
		frameCaptureItemId = null;
		resolve?.(image);
	},
	cancelFrameCapture(): void {
		const resolve = frameCaptureResolver;
		if (frameCaptureTimeout) clearTimeout(frameCaptureTimeout);
		frameCaptureTimeout = null;
		frameCaptureResolver = null;
		frameCaptureItemId = null;
		resolve?.(null);
	},
	copyGrade(grade: readonly GradeEffectSnapshot[]): void {
		gradeClipboard = cloneGrade(grade);
	},
	clearGradeClipboard(): void {
		gradeClipboard = null;
	},
	setEffectDraft(
		itemId: string,
		effect: GpuEffect,
		params: GpuParamValues,
		effectIds: readonly string[] = [effect.id],
		itemIds: readonly string[] = [itemId]
	): void {
		effectDraft = {
			itemId,
			itemIds: [...new Set([itemId, ...itemIds])],
			effectIds: [...new Set([effect.id, ...effectIds])],
			effectType: effect.effectId,
			enabled: effect.enabled,
			params: { ...params }
		};
	},
	clearEffectDraft(itemId?: string, effectId?: string): void {
		if (
			effectDraft &&
			(itemId === undefined || effectDraft.itemId === itemId) &&
			(effectId === undefined || effectDraft.effectIds.includes(effectId))
		) {
			effectDraft = null;
		}
	},
	applyEffectDraft(itemId: string, effects: readonly ItemEffect[]): ItemEffect[] {
		const draft = effectDraft;
		if (!draft || !draft.itemIds.includes(itemId)) return [...effects];
		let matched = false;
		const patched = effects.map((effect) => {
			if (!draft.effectIds.includes(effect.id) || effect.type !== 'gpu') return effect;
			matched = true;
			return { ...effect, params: { ...effect.params, ...draft.params } };
		});
		if (matched) return patched;
		const definition = getGpuEffect(draft.effectType);
		if (!definition) return patched;
		return [
			...patched,
			{
				id: `__color-preview__:${itemId}:${draft.effectType}`,
				type: 'gpu',
				effectId: draft.effectType,
				enabled: draft.enabled,
				params: { ...defaultGpuParams(definition.schema), ...draft.params }
			}
		];
	},
	__resetForTesting(): void {
		this.cancelPick();
		this.cancelFrameCapture();
		comparisonMode = 'after';
		comparisonItemIds = [];
		splitPosition = 0.5;
		gradeClipboard = null;
		effectDraft = null;
		scopeSampleItemId = null;
	}
};
