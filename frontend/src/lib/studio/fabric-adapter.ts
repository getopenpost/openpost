import { getAuthenticatedMediaURL } from '$lib/media-url';
import type { StudioDocument, StudioLayer, StudioPage } from './types';

type FabricModule = typeof import('fabric');
type FabricCanvas = InstanceType<FabricModule['Canvas']>;
type FabricStaticCanvas = InstanceType<FabricModule['StaticCanvas']>;
type FabricObject = InstanceType<FabricModule['FabricObject']> & { __studioLayerID?: string };

interface FabricAdapterOptions {
	canvas: HTMLCanvasElement;
	document: StudioDocument;
	page: StudioPage;
	readOnly: boolean;
	staticCanvas?: boolean;
	renderScale?: number;
	onSelection(ids: string[]): void;
	onTransform(id: string, updates: Partial<StudioLayer['transform']>): void;
}

const SNAP_SCREEN_PX = 7;

export class OpenPostFabricAdapter {
	private fabric: FabricModule | null = null;
	private canvas: FabricStaticCanvas | null = null;
	private readonly element: HTMLCanvasElement;
	private objectURLs = new Set<string>();
	private objectByLayerID = new Map<string, FabricObject>();
	private guideObjects: FabricObject[] = [];
	private syncing = false;
	private renderSequence = 0;
	private document: StudioDocument;
	private page: StudioPage;
	private readOnly: boolean;
	private readonly staticMode: boolean;
	private readonly renderScale: number;
	private onSelection: FabricAdapterOptions['onSelection'];
	private onTransform: FabricAdapterOptions['onTransform'];

	constructor(options: FabricAdapterOptions) {
		this.element = options.canvas;
		this.document = options.document;
		this.page = options.page;
		this.readOnly = options.readOnly;
		this.staticMode = Boolean(options.staticCanvas);
		this.renderScale = Math.max(0.01, options.renderScale ?? 1);
		this.onSelection = options.onSelection;
		this.onTransform = options.onTransform;
	}

	async mount(): Promise<void> {
		this.fabric = await import('fabric');
		this.canvas = this.staticMode
			? new this.fabric.StaticCanvas(this.element, {
					width: Math.max(1, Math.round(this.document.width_px * this.renderScale)),
					height: Math.max(1, Math.round(this.document.height_px * this.renderScale)),
					backgroundColor: this.page.background_color,
					renderOnAddRemove: false,
					enableRetinaScaling: false
				})
			: new this.fabric.Canvas(this.element, {
					width: this.document.width_px,
					height: this.document.height_px,
					backgroundColor: this.page.background_color,
					selection: !this.readOnly,
					preserveObjectStacking: true,
					renderOnAddRemove: false,
					stopContextMenu: true,
					enableRetinaScaling: false
				});
		if (!this.staticMode) this.bindEvents();
		await this.render(this.document, this.page);
	}

	async render(document: StudioDocument, page: StudioPage): Promise<void> {
		if (!this.canvas || !this.fabric) return;
		this.document = document;
		this.page = page;
		const sequence = ++this.renderSequence;
		this.syncing = true;
		const selectedIDs = this.staticMode ? [] : this.selectedIDs();
		this.interactiveCanvas()?.discardActiveObject();
		this.canvas.clear();
		this.revokeObjectURLs();
		this.objectByLayerID.clear();
		this.guideObjects = [];
		this.canvas.setDimensions({
			width: Math.max(1, Math.round(document.width_px * this.renderScale)),
			height: Math.max(1, Math.round(document.height_px * this.renderScale))
		});
		if (this.staticMode) this.canvas.setZoom(this.renderScale);
		this.canvas.backgroundColor = page.background_color;
		for (const layer of page.layers) {
			const object = await this.createObject(layer);
			if (sequence !== this.renderSequence) return;
			if (!object) continue;
			this.objectByLayerID.set(layer.id, object);
			this.canvas.add(object);
		}
		if (!this.staticMode) this.restoreSelection(selectedIDs);
		this.canvas.requestRenderAll();
		this.syncing = false;
	}

	setReadOnly(readOnly: boolean): void {
		this.readOnly = readOnly;
		const canvas = this.interactiveCanvas();
		if (!canvas) return;
		canvas.selection = !readOnly;
		for (const object of canvas.getObjects() as FabricObject[]) {
			object.selectable = !readOnly && !object.lockMovementX;
			object.evented = !readOnly;
		}
	}

	setSelection(ids: string[]): void {
		const canvas = this.interactiveCanvas();
		if (!canvas || !this.fabric || this.syncing) return;
		this.syncing = true;
		canvas.discardActiveObject();
		const objects = ids
			.map((id) => this.objectByLayerID.get(id))
			.filter((object): object is FabricObject => Boolean(object));
		if (objects.length === 1) {
			canvas.setActiveObject(objects[0]);
		} else if (objects.length > 1) {
			canvas.setActiveObject(new this.fabric.ActiveSelection(objects, { canvas }));
		}
		canvas.requestRenderAll();
		this.syncing = false;
	}

	dispose(): void {
		this.renderSequence++;
		this.revokeObjectURLs();
		this.objectByLayerID.clear();
		this.canvas?.dispose();
		this.canvas = null;
		this.fabric = null;
	}

	private bindEvents(): void {
		const canvas = this.interactiveCanvas();
		if (!canvas) return;
		canvas.on('selection:created', () => this.emitSelection());
		canvas.on('selection:updated', () => this.emitSelection());
		canvas.on('selection:cleared', () => this.emitSelection());
		canvas.on('object:moving', (event) => this.snapObject(event.target as FabricObject));
		canvas.on('object:modified', (event) => {
			this.clearGuides();
			this.emitTransform(event.target as FabricObject);
		});
	}

	private emitSelection(): void {
		if (this.syncing) return;
		this.onSelection(this.selectedIDs());
	}

	private selectedIDs(): string[] {
		const active = this.interactiveCanvas()?.getActiveObjects() as FabricObject[] | undefined;
		return (active ?? [])
			.map((object) => object.__studioLayerID)
			.filter((id): id is string => Boolean(id));
	}

	private interactiveCanvas(): FabricCanvas | null {
		return this.staticMode ? null : (this.canvas as FabricCanvas | null);
	}

	private emitTransform(target?: FabricObject): void {
		if (!target || this.syncing) return;
		if (!target.__studioLayerID && this.fabric && 'getObjects' in target) {
			const selection = target as FabricObject & { getObjects(): FabricObject[] };
			for (const object of selection.getObjects()) {
				if (!object.__studioLayerID) continue;
				const decomposition = this.fabric.util.qrDecompose(object.calcTransformMatrix());
				const width = Math.max(1, (object.width ?? 1) * Math.abs(decomposition.scaleX));
				const height = Math.max(1, (object.height ?? 1) * Math.abs(decomposition.scaleY));
				this.onTransform(object.__studioLayerID, {
					x: decomposition.translateX - width / 2,
					y: decomposition.translateY - height / 2,
					width,
					height,
					rotation: decomposition.angle,
					flip_x: decomposition.scaleX < 0,
					flip_y: decomposition.scaleY < 0
				});
			}
			return;
		}
		if (!target.__studioLayerID) return;
		const scaledWidth = Math.max(1, target.getScaledWidth());
		const scaledHeight = Math.max(1, target.getScaledHeight());
		this.onTransform(target.__studioLayerID, {
			x: target.left ?? 0,
			y: target.top ?? 0,
			width: scaledWidth,
			height: scaledHeight,
			rotation: target.angle ?? 0,
			flip_x: Boolean(target.flipX),
			flip_y: Boolean(target.flipY)
		});
		target.set({ scaleX: 1, scaleY: 1, width: scaledWidth, height: scaledHeight });
		target.setCoords();
	}

	private snapObject(target?: FabricObject): void {
		if (!target || !this.canvas || !this.fabric) return;
		this.clearGuides();
		const zoom = Math.max(this.canvas.getZoom(), 0.01);
		const threshold = SNAP_SCREEN_PX / zoom;
		const width = target.getScaledWidth();
		const height = target.getScaledHeight();
		const candidatesX = [0, this.document.width_px / 2, this.document.width_px];
		const candidatesY = [0, this.document.height_px / 2, this.document.height_px];
		for (const object of this.canvas.getObjects() as FabricObject[]) {
			if (object === target || this.guideObjects.includes(object)) continue;
			const left = object.left ?? 0;
			const top = object.top ?? 0;
			const objectWidth = object.getScaledWidth();
			const objectHeight = object.getScaledHeight();
			candidatesX.push(left, left + objectWidth / 2, left + objectWidth);
			candidatesY.push(top, top + objectHeight / 2, top + objectHeight);
		}
		const objectX = [target.left ?? 0, (target.left ?? 0) + width / 2, (target.left ?? 0) + width];
		const objectY = [target.top ?? 0, (target.top ?? 0) + height / 2, (target.top ?? 0) + height];
		let guideX: number | null = null;
		let guideY: number | null = null;
		for (let index = 0; index < objectX.length; index++) {
			for (const candidate of candidatesX) {
				if (Math.abs(objectX[index] - candidate) <= threshold) {
					target.left = candidate - [0, width / 2, width][index];
					guideX = candidate;
					break;
				}
			}
		}
		for (let index = 0; index < objectY.length; index++) {
			for (const candidate of candidatesY) {
				if (Math.abs(objectY[index] - candidate) <= threshold) {
					target.top = candidate - [0, height / 2, height][index];
					guideY = candidate;
					break;
				}
			}
		}
		if (guideX !== null) {
			this.addGuide([guideX, 0, guideX, this.document.height_px]);
		}
		if (guideY !== null) {
			this.addGuide([0, guideY, this.document.width_px, guideY]);
		}
	}

	private addGuide(points: [number, number, number, number]): void {
		if (!this.canvas || !this.fabric) return;
		const guide = new this.fabric.Line(points, {
			stroke: '#f97316',
			strokeWidth: 1,
			strokeDashArray: [6, 5],
			selectable: false,
			evented: false,
			excludeFromExport: true
		}) as FabricObject;
		this.guideObjects.push(guide);
		this.canvas.add(guide);
	}

	private clearGuides(): void {
		if (!this.canvas || this.guideObjects.length === 0) return;
		for (const guide of this.guideObjects) this.canvas.remove(guide);
		this.guideObjects = [];
	}

	private async createObject(layer: StudioLayer): Promise<FabricObject | null> {
		if (!this.fabric) return null;
		const options = this.baseObjectOptions(layer);
		let object: FabricObject | null = null;
		if (layer.type === 'group') {
			object = new this.fabric.Rect({
				...options,
				width: layer.transform.width,
				height: layer.transform.height,
				fill: 'rgba(0,0,0,0)',
				strokeWidth: 0
			}) as FabricObject;
		}
		if (layer.type === 'text' && layer.text) {
			object = new this.fabric.Textbox(layer.text.text, {
				...options,
				width: layer.transform.width,
				fontFamily: layer.text.font_family,
				fontWeight: layer.text.font_weight,
				fontStyle: layer.text.font_style,
				fontSize: layer.text.font_size,
				fill: layer.text.color,
				textAlign: layer.text.align,
				lineHeight: layer.text.line_height,
				charSpacing: layer.text.letter_spacing * 10,
				stroke: layer.text.stroke_color,
				strokeWidth: layer.text.stroke_width,
				backgroundColor: layer.text.highlight_color,
				shadow:
					layer.text.shadow.blur ||
					layer.text.shadow.offset_x ||
					layer.text.shadow.offset_y ||
					layer.text.shadow.color !== '#00000000'
						? new this.fabric.Shadow({
								color: layer.text.shadow.color,
								blur: layer.text.shadow.blur,
								offsetX: layer.text.shadow.offset_x,
								offsetY: layer.text.shadow.offset_y
							})
						: undefined
			}) as FabricObject;
		}
		if (layer.type === 'shape' && layer.shape) {
			const shapeOptions = {
				...options,
				width: layer.transform.width,
				height: layer.transform.height,
				fill: layer.shape.fill,
				stroke: layer.shape.stroke,
				strokeWidth: layer.shape.stroke_width
			};
			if (layer.shape.kind === 'ellipse') {
				object = new this.fabric.Ellipse({
					...shapeOptions,
					rx: layer.transform.width / 2,
					ry: layer.transform.height / 2
				}) as FabricObject;
			} else if (layer.shape.kind === 'line') {
				object = new this.fabric.Line(
					[0, 0, layer.transform.width, 0],
					shapeOptions
				) as FabricObject;
			} else {
				object = new this.fabric.Rect({
					...shapeOptions,
					rx: layer.shape.kind === 'rounded_rectangle' ? layer.shape.radius : 0,
					ry: layer.shape.kind === 'rounded_rectangle' ? layer.shape.radius : 0
				}) as FabricObject;
			}
		}
		if (layer.type === 'image' && layer.image) {
			const response = await fetch(getAuthenticatedMediaURL(`/media/${layer.image.media_id}`), {
				credentials: 'include'
			});
			if (!response.ok) return null;
			const objectURL = URL.createObjectURL(await response.blob());
			this.objectURLs.add(objectURL);
			const image = await this.fabric.FabricImage.fromURL(objectURL);
			const sourceWidth = Math.max(1, image.width);
			const sourceHeight = Math.max(1, image.height);
			const crop = layer.image.crop;
			let cropX = clamp(crop.x, 0, 0.99) * sourceWidth;
			let cropY = clamp(crop.y, 0, 0.99) * sourceHeight;
			let cropWidth = clamp(crop.width, 0.01, 1 - crop.x) * sourceWidth;
			let cropHeight = clamp(crop.height, 0.01, 1 - crop.y) * sourceHeight;
			let left = options.left;
			let top = options.top;
			let scaleX = layer.transform.width / cropWidth;
			let scaleY = layer.transform.height / cropHeight;
			if (layer.image.fit === 'cover') {
				const targetRatio = layer.transform.width / Math.max(1, layer.transform.height);
				const sourceRatio = cropWidth / cropHeight;
				if (sourceRatio > targetRatio) {
					const nextWidth = cropHeight * targetRatio;
					cropX += (cropWidth - nextWidth) / 2;
					cropWidth = nextWidth;
				} else {
					const nextHeight = cropWidth / targetRatio;
					cropY += (cropHeight - nextHeight) / 2;
					cropHeight = nextHeight;
				}
				scaleX = layer.transform.width / cropWidth;
				scaleY = layer.transform.height / cropHeight;
			}
			if (layer.image.fit === 'contain') {
				const scale = Math.min(scaleX, scaleY);
				left += (layer.transform.width - cropWidth * scale) / 2;
				top += (layer.transform.height - cropHeight * scale) / 2;
				scaleX = scale;
				scaleY = scale;
			}
			image.set({
				...options,
				left,
				top,
				cropX,
				cropY,
				width: cropWidth,
				height: cropHeight,
				scaleX,
				scaleY
			});
			this.applyImageFilters(image, layer);
			object = image as FabricObject;
		}
		if (!object) return null;
		object.__studioLayerID = layer.id;
		const effectivelyLocked = this.layerIsLocked(layer);
		object.set({
			visible: this.layerIsVisible(layer),
			selectable: !this.readOnly && !effectivelyLocked,
			evented: !this.readOnly && !effectivelyLocked,
			lockMovementX: effectivelyLocked,
			lockMovementY: effectivelyLocked,
			lockRotation: effectivelyLocked,
			lockScalingX: effectivelyLocked,
			lockScalingY: effectivelyLocked
		});
		return object;
	}

	private layerIsVisible(layer: StudioLayer): boolean {
		let current: StudioLayer | undefined = layer;
		const visited = new Set<string>();
		while (current) {
			if (!current.visible) return false;
			if (!current.parent_id || visited.has(current.parent_id)) break;
			visited.add(current.parent_id);
			current = this.page.layers.find((candidate) => candidate.id === current?.parent_id);
		}
		return true;
	}

	private layerIsLocked(layer: StudioLayer): boolean {
		let current: StudioLayer | undefined = layer;
		const visited = new Set<string>();
		while (current) {
			if (current.locked) return true;
			if (!current.parent_id || visited.has(current.parent_id)) break;
			visited.add(current.parent_id);
			current = this.page.layers.find((candidate) => candidate.id === current?.parent_id);
		}
		return false;
	}

	private baseObjectOptions(layer: StudioLayer) {
		return {
			left: layer.transform.x,
			top: layer.transform.y,
			angle: layer.transform.rotation,
			flipX: layer.transform.flip_x,
			flipY: layer.transform.flip_y,
			opacity: layer.opacity,
			originX: 'left' as const,
			originY: 'top' as const,
			transparentCorners: false,
			cornerColor: '#f97316',
			cornerStrokeColor: '#ffffff',
			borderColor: '#f97316',
			cornerSize: 12,
			touchCornerSize: 28,
			padding: 1
		};
	}

	private applyImageFilters(
		image: InstanceType<FabricModule['FabricImage']>,
		layer: StudioLayer
	): void {
		if (!this.fabric || !layer.image) return;
		const adjustment = layer.image.adjustments;
		const filters: InstanceType<FabricModule['filters']['BaseFilter']>[] = [];
		if (adjustment.brightness || adjustment.exposure) {
			filters.push(
				new this.fabric.filters.Brightness({
					brightness: clamp(adjustment.brightness + adjustment.exposure * 0.6, -1, 1)
				})
			);
		}
		if (adjustment.contrast) {
			filters.push(
				new this.fabric.filters.Contrast({ contrast: clamp(adjustment.contrast, -1, 1) })
			);
		}
		if (adjustment.saturation) {
			filters.push(
				new this.fabric.filters.Saturation({ saturation: clamp(adjustment.saturation, -1, 1) })
			);
		}
		if (adjustment.temperature) {
			const warm = clamp(adjustment.temperature * 0.18, -0.18, 0.18);
			filters.push(
				new this.fabric.filters.ColorMatrix({
					matrix: [1 + warm, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1 - warm, 0, 0, 0, 0, 0, 1, 0]
				})
			);
		}
		if (adjustment.highlights || adjustment.shadows) {
			const shadowLift = clamp(adjustment.shadows * 0.3, -0.3, 0.3);
			const highlightShift = clamp(adjustment.highlights * 0.25, -0.25, 0.25);
			filters.push(
				new this.fabric.filters.Gamma({
					gamma: [
						clamp(1 - shadowLift + highlightShift, 0.2, 2.2),
						clamp(1 - shadowLift + highlightShift, 0.2, 2.2),
						clamp(1 - shadowLift + highlightShift, 0.2, 2.2)
					]
				})
			);
		}
		if (adjustment.blur) {
			filters.push(new this.fabric.filters.Blur({ blur: clamp(adjustment.blur, 0, 1) }));
		}
		image.filters = filters;
		image.applyFilters();
	}

	private restoreSelection(ids: string[]): void {
		if (ids.length > 0) this.setSelection(ids);
	}

	private revokeObjectURLs(): void {
		for (const url of this.objectURLs) URL.revokeObjectURL(url);
		this.objectURLs.clear();
	}
}

function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}
