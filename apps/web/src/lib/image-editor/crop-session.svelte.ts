import { m } from '$lib/paraglide/messages';
import type { ProtectedIconRole } from '$lib/themes/icons/protected-icon.js';
import type { ImageEditorController } from './editor.svelte';
import type { OpenPostFabricAdapter } from './fabric-adapter';
import {
	applyImageEditorCropWindow,
	imageEditorCropWindowForAspect,
	normalizeImageEditorCropWindow,
	resetImageEditorCrop,
	rotateImageEditorTransformAroundCenter,
	type ImageEditorCropWindow
} from './crop';
import type { SelectionPoint } from './selection';
import type { ImageEditorLayer } from './types';

export type CropHandle = 'move' | 'content' | 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

export type CropInteractionMode = 'frame' | 'content';

const FULL_CROP_WINDOW: ImageEditorCropWindow = {
	x: 0,
	y: 0,
	width: 1,
	height: 1
};

function normalizeRotation(rotation: number): number {
	const normalized = ((((rotation + 180) % 360) + 360) % 360) - 180;
	return Object.is(normalized, -0) ? 0 : normalized;
}

export type CropSnapAxes = 'both' | 'x' | 'y';

/**
 * Which axes a crop gesture may snap on. Edge handles snap along their
 * own axis (swapped past a quarter turn); corners and moves snap both.
 */
export function resolveCropSnapAxes(
	handle: Exclude<CropHandle, 'content'>,
	rotatedSide: boolean
): CropSnapAxes {
	if (handle === 'move' || handle.length === 2) return 'both';
	if (handle === 'e' || handle === 'w') return rotatedSide ? 'y' : 'x';
	return rotatedSide ? 'x' : 'y';
}

export interface CropSessionEnvironment {
	editor: ImageEditorController;
	adapter: () => OpenPostFabricAdapter | null;
	documentPoint: (
		event: Pick<PointerEvent, 'clientX' | 'clientY'>,
		outside?: 'reject' | 'clamp' | 'allow'
	) => SelectionPoint | null;
	capturePointer: (target: EventTarget | null, pointerID: number) => void;
	announce: (message: string) => void;
}

/**
 * Stateful crop editing session: window/aspect/mode/rotation/flip state plus
 * the pointer, keyboard, and preview flows that mutate it. Constructed once
 * per canvas with the live editor, adapter access, and canvas helpers; the
 * canvas template reads the reactive fields directly. No DOM listeners or
 * timers here, so there is nothing to dispose.
 */
export class ImageEditorCropSession {
	window = $state.raw<ImageEditorCropWindow>({ ...FULL_CROP_WINDOW });
	sourceWindow = $state.raw<ImageEditorCropWindow>({ ...FULL_CROP_WINDOW });
	aspect = $state('free');
	mode = $state<CropInteractionMode>('frame');
	rotationDelta = $state(0);
	flipX = $state(false);
	flipY = $state(false);
	baseLayer = $state.raw<ImageEditorLayer | null>(null);
	gesture = $state.raw<{
		pointerID: number;
		handle: CropHandle;
		start: SelectionPoint;
		origin: ImageEditorCropWindow;
		sourceOrigin: ImageEditorCropWindow;
	} | null>(null);

	readonly orientationControls: {
		label: string;
		action: () => void;
		icon: ProtectedIconRole;
	}[] = [
		{
			label: m.image_editor_crop_rotate_left(),
			action: () => this.rotate(-90),
			icon: 'editor-rotate-left'
		},
		{
			label: m.image_editor_crop_rotate_right(),
			action: () => this.rotate(90),
			icon: 'editor-rotate-right'
		},
		{
			label: m.image_editor_crop_flip_horizontal(),
			action: () => this.flip('x'),
			icon: 'editor-flip-horizontal'
		},
		{
			label: m.image_editor_crop_flip_vertical(),
			action: () => this.flip('y'),
			icon: 'editor-flip-vertical'
		}
	];

	private readonly env: CropSessionEnvironment;

	constructor(environment: CropSessionEnvironment) {
		this.env = environment;
	}

	get layer(): ImageEditorLayer | null {
		const { editor } = this.env;
		return editor.activeTool === 'crop'
			? (editor.selectedLayers.find((layer) => layer.type === 'image' && !layer.locked) ?? null)
			: null;
	}

	get preview(): ImageEditorLayer | null {
		return this.createPreviewLayer();
	}

	resetSession(): void {
		this.gesture = null;
		this.resetWindowState();
		this.baseLayer = null;
	}

	private resetWindowState(): void {
		this.window = { ...FULL_CROP_WINDOW };
		this.sourceWindow = { ...FULL_CROP_WINDOW };
		this.aspect = 'free';
		this.mode = 'frame';
		this.rotationDelta = 0;
		this.flipX = false;
		this.flipY = false;
	}

	start(event: PointerEvent, handle: CropHandle): void {
		const point = this.env.documentPoint(event, 'allow');
		if (!point || !this.ensureSession() || event.button !== 0) return;
		event.preventDefault();
		event.stopPropagation();
		this.gesture = {
			pointerID: event.pointerId,
			handle,
			start: point,
			origin: { ...this.window },
			sourceOrigin: { ...this.sourceWindow }
		};
		this.env.capturePointer(event.currentTarget, event.pointerId);
	}

	move(event: PointerEvent): void {
		const gesture = this.gesture;
		if (!gesture || gesture.pointerID !== event.pointerId || !this.sessionLayer()) return;
		const point = this.env.documentPoint(event, 'allow');
		if (!point) return;
		const delta = this.pointDelta(gesture.start, point);
		if (gesture.handle === 'content') {
			this.env.adapter()?.clearSnappingGuides();
			this.sourceWindow = this.moveSource(gesture.sourceOrigin, delta);
		} else {
			const unsnappedWindow = this.updateWindow(gesture.origin, gesture.handle, delta);
			const nextWindow = this.snapWindow(unsnappedWindow, gesture.handle, event);
			this.sourceWindow = this.sourceWindowForFrame(
				gesture.origin,
				gesture.sourceOrigin,
				nextWindow
			);
			this.window = nextWindow;
			this.aspect = 'free';
		}
		this.previewSession();
		event.preventDefault();
		event.stopPropagation();
	}

	stop(event: PointerEvent): void {
		const gesture = this.gesture;
		if (!gesture || gesture.pointerID !== event.pointerId) return;
		this.gesture = null;
		this.env.adapter()?.clearSnappingGuides();
		if (
			event.currentTarget instanceof HTMLElement &&
			event.currentTarget.hasPointerCapture(event.pointerId)
		) {
			event.currentTarget.releasePointerCapture(event.pointerId);
		}
		event.preventDefault();
		event.stopPropagation();
	}

	nudge(event: KeyboardEvent, handle: CropHandle): void {
		const base = this.ensureSession();
		if (!base || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
		event.preventDefault();
		event.stopPropagation();
		const pixels = event.shiftKey ? 10 : 1;
		const delta = {
			x:
				event.key === 'ArrowLeft'
					? -pixels / Math.max(1, base.transform.width)
					: event.key === 'ArrowRight'
						? pixels / Math.max(1, base.transform.width)
						: 0,
			y:
				event.key === 'ArrowUp'
					? -pixels / Math.max(1, base.transform.height)
					: event.key === 'ArrowDown'
						? pixels / Math.max(1, base.transform.height)
						: 0
		};
		if (handle === 'content') {
			this.sourceWindow = this.moveSource(this.sourceWindow, delta);
		} else {
			const nextWindow = this.updateWindow(this.window, handle, delta);
			this.sourceWindow = this.sourceWindowForFrame(this.window, this.sourceWindow, nextWindow);
			this.window = nextWindow;
			this.aspect = 'free';
		}
		this.previewSession();
	}

	setAspect(value: string): void {
		this.aspect = value;
		const base = this.ensureSession();
		if (!base?.image || value === 'free') return;
		const aspect =
			value === 'original'
				? base.image.source_width / Math.max(1, base.image.source_height)
				: Number(value);
		const nextWindow = imageEditorCropWindowForAspect(base.transform, aspect);
		this.sourceWindow = this.sourceWindowForFrame(this.window, this.sourceWindow, nextWindow);
		this.window = nextWindow;
		this.previewSession();
	}

	setMode(mode: CropInteractionMode): void {
		if (!this.ensureSession()) return;
		this.mode = mode;
		this.env.announce(
			mode === 'frame'
				? m.image_editor_crop_frame_mode_help()
				: m.image_editor_crop_content_mode_help()
		);
	}

	rotate(delta: -90 | 90): void {
		if (!this.ensureSession()) return;
		this.rotationDelta = normalizeRotation(this.rotationDelta + delta);
		this.previewSession();
		this.env.announce(
			delta < 0 ? m.image_editor_crop_rotated_left() : m.image_editor_crop_rotated_right()
		);
	}

	flip(axis: 'x' | 'y'): void {
		if (!this.ensureSession()) return;
		if (axis === 'x') this.flipX = !this.flipX;
		else this.flipY = !this.flipY;
		this.previewSession();
		this.env.announce(
			axis === 'x'
				? m.image_editor_crop_flipped_horizontal()
				: m.image_editor_crop_flipped_vertical()
		);
	}

	apply(): void {
		const preview = this.createPreviewLayer();
		if (!preview?.image) return;
		const { editor } = this.env;
		this.env.announce(
			m.image_editor_crop_applied_dimensions({
				width: Math.max(1, Math.round(preview.transform.width)),
				height: Math.max(1, Math.round(preview.transform.height))
			})
		);
		editor.applyImageCropState(preview.id, {
			transform: preview.transform,
			crop: preview.image.crop
		});
		this.resetSession();
		editor.activeTool = 'select';
	}

	cancel(): void {
		const id = this.baseLayer?.id ?? this.layer?.id;
		if (id) this.env.adapter()?.previewImageLayer(id);
		this.resetSession();
		this.env.announce(m.image_editor_crop_cancelled());
		this.env.editor.activeTool = 'select';
	}

	reset(): void {
		const layer = this.layer;
		if (!layer?.image) return;
		const reset = resetImageEditorCrop(layer);
		this.baseLayer = {
			...structuredClone(layer),
			transform: reset.transform,
			image: { ...structuredClone(layer.image), crop: reset.crop }
		};
		this.resetWindowState();
		this.previewSession();
		this.env.announce(m.image_editor_crop_reset_pending());
	}

	private sessionLayer(): ImageEditorLayer | null {
		const layer = this.layer;
		if (!layer?.image) return null;
		return this.baseLayer?.id === layer.id ? this.baseLayer : layer;
	}

	private ensureSession(): ImageEditorLayer | null {
		const layer = this.layer;
		if (!layer?.image) return null;
		if (this.baseLayer?.id === layer.id) return this.baseLayer;
		if (this.baseLayer) this.env.adapter()?.previewImageLayer(this.baseLayer.id);
		this.resetSession();
		this.baseLayer = structuredClone(layer);
		return this.baseLayer;
	}

	private createPreviewLayer(): ImageEditorLayer | null {
		const base = this.sessionLayer();
		if (!base?.image) return null;
		const result = applyImageEditorCropWindow(base, this.window, this.sourceWindow);
		const transform = rotateImageEditorTransformAroundCenter(
			result.transform,
			normalizeRotation(base.transform.rotation + this.rotationDelta)
		);
		return {
			...structuredClone(base),
			transform: {
				...transform,
				flip_x: base.transform.flip_x !== this.flipX,
				flip_y: base.transform.flip_y !== this.flipY
			},
			image: { ...structuredClone(base.image), crop: result.crop }
		};
	}

	private previewSession(): void {
		const preview = this.createPreviewLayer();
		if (preview) this.env.adapter()?.previewImageLayer(preview.id, preview);
	}

	private pointDelta(start: SelectionPoint, current: SelectionPoint): SelectionPoint {
		const base = this.sessionLayer();
		const preview = this.createPreviewLayer();
		if (!base || !preview) return { x: 0, y: 0 };
		const deltaX = current.x - start.x;
		const deltaY = current.y - start.y;
		const radians = (-preview.transform.rotation * Math.PI) / 180;
		return {
			x:
				(deltaX * Math.cos(radians) - deltaY * Math.sin(radians)) /
				Math.max(1, base.transform.width),
			y:
				(deltaX * Math.sin(radians) + deltaY * Math.cos(radians)) /
				Math.max(1, base.transform.height)
		};
	}

	private updateWindow(
		origin: ImageEditorCropWindow,
		handle: CropHandle,
		delta: SelectionPoint
	): ImageEditorCropWindow {
		if (handle === 'move') {
			return {
				...origin,
				x: Math.max(0, Math.min(1 - origin.width, origin.x + delta.x)),
				y: Math.max(0, Math.min(1 - origin.height, origin.y + delta.y))
			};
		}
		let left = origin.x;
		let top = origin.y;
		let right = origin.x + origin.width;
		let bottom = origin.y + origin.height;
		if (handle.includes('w')) left += delta.x;
		if (handle.includes('e')) right += delta.x;
		if (handle.includes('n')) top += delta.y;
		if (handle.includes('s')) bottom += delta.y;
		const minimum = 0.005;
		left = Math.max(0, Math.min(right - minimum, left));
		top = Math.max(0, Math.min(bottom - minimum, top));
		right = Math.min(1, Math.max(left + minimum, right));
		bottom = Math.min(1, Math.max(top + minimum, bottom));
		return normalizeImageEditorCropWindow({
			x: left,
			y: top,
			width: right - left,
			height: bottom - top
		});
	}

	private snapWindow(
		window: ImageEditorCropWindow,
		handle: Exclude<CropHandle, 'content'>,
		event: Pick<PointerEvent, 'ctrlKey' | 'metaKey'>
	): ImageEditorCropWindow {
		const base = this.sessionLayer();
		if (!base || !this.env.editor.snappingEnabled || event.ctrlKey || event.metaKey) {
			this.env.adapter()?.clearSnappingGuides();
			return window;
		}
		const result = applyImageEditorCropWindow(base, window, window);
		const rotation = normalizeRotation(base.transform.rotation + this.rotationDelta);
		const quarterTurns = Math.round(rotation / 90);
		if (Math.abs(rotation - quarterTurns * 90) > 0.01) {
			this.env.adapter()?.clearSnappingGuides();
			return window;
		}
		const transform = { ...result.transform, rotation };
		const local = {
			x: handle.includes('w') ? 0 : handle.includes('e') ? transform.width : transform.width / 2,
			y: handle.includes('n') ? 0 : handle.includes('s') ? transform.height : transform.height / 2
		};
		const radians = (rotation * Math.PI) / 180;
		const center = {
			x: transform.x + transform.width / 2,
			y: transform.y + transform.height / 2
		};
		const point = {
			x:
				center.x +
				(local.x - transform.width / 2) * Math.cos(radians) -
				(local.y - transform.height / 2) * Math.sin(radians),
			y:
				center.y +
				(local.x - transform.width / 2) * Math.sin(radians) +
				(local.y - transform.height / 2) * Math.cos(radians)
		};
		const rotatedSide = Math.abs(quarterTurns) % 2 === 1;
		const axes = resolveCropSnapAxes(handle, rotatedSide);
		const snapped = this.env.adapter()?.snapDocumentPoint(point, {
			axes,
			excludeLayerIDs: [base.id]
		});
		if (!snapped || (snapped.guideX === null && snapped.guideY === null)) return window;
		const worldDelta = {
			x: snapped.point.x - point.x,
			y: snapped.point.y - point.y
		};
		const localDelta = {
			x:
				(worldDelta.x * Math.cos(-radians) - worldDelta.y * Math.sin(-radians)) /
				Math.max(1, base.transform.width),
			y:
				(worldDelta.x * Math.sin(-radians) + worldDelta.y * Math.cos(-radians)) /
				Math.max(1, base.transform.height)
		};
		return this.updateWindow(window, handle, localDelta);
	}

	private sourceWindowForFrame(
		originFrame: ImageEditorCropWindow,
		originSource: ImageEditorCropWindow,
		nextFrame: ImageEditorCropWindow
	): ImageEditorCropWindow {
		return {
			x: Math.max(0, Math.min(1 - nextFrame.width, nextFrame.x + originSource.x - originFrame.x)),
			y: Math.max(0, Math.min(1 - nextFrame.height, nextFrame.y + originSource.y - originFrame.y)),
			width: nextFrame.width,
			height: nextFrame.height
		};
	}

	private moveSource(origin: ImageEditorCropWindow, delta: SelectionPoint): ImageEditorCropWindow {
		const preview = this.createPreviewLayer();
		const horizontal = preview?.transform.flip_x ? delta.x : -delta.x;
		const vertical = preview?.transform.flip_y ? delta.y : -delta.y;
		return {
			...origin,
			x: Math.max(0, Math.min(1 - origin.width, origin.x + horizontal)),
			y: Math.max(0, Math.min(1 - origin.height, origin.y + vertical))
		};
	}
}
