import { getAuthenticatedMediaURL } from '$lib/media-url';
import type { StudioDocument, StudioLayer, StudioPage, StudioTool } from './types';
import { createTextCurvePath, shadowColor, shadowOffset, textCurveStartOffset } from './effects';
import { createStudioCanvasGradient, gradientColorAt } from './gradient';
import {
	boundsIntersect,
	colorsWithinTolerance,
	polygonIntersectsBounds,
	type SelectionBounds,
	type SelectionPoint
} from './selection';

type FabricModule = typeof import('fabric');
type FabricCanvas = InstanceType<FabricModule['Canvas']>;
type FabricStaticCanvas = InstanceType<FabricModule['StaticCanvas']>;
type FabricObject = InstanceType<FabricModule['FabricObject']> & {
	__studioLayerID?: string;
	__studioObjectURL?: string;
	__studioSourceWidth?: number;
	__studioSourceHeight?: number;
};
type FabricTextObject = FabricObject & {
	text?: string;
	initDimensions?: () => void;
	enterEditing?: () => void;
	selectAll?: () => void;
	isEditing?: boolean;
	path?: InstanceType<FabricModule['Path']>;
	pathStartOffset?: number;
	pathSide?: 'left' | 'right';
};
type FabricCustomObject = FabricObject & {
	_render(context: CanvasRenderingContext2D): void;
};

export interface StudioImageGeometry {
	left: number;
	top: number;
	cropX: number;
	cropY: number;
	width: number;
	height: number;
	scaleX: number;
	scaleY: number;
}

interface FabricAdapterOptions {
	canvas: HTMLCanvasElement;
	document: StudioDocument;
	page: StudioPage;
	readOnly: boolean;
	staticCanvas?: boolean;
	renderScale?: number;
	onSelection(ids: string[]): void;
	onTransform(id: string, updates: Partial<StudioLayer['transform']>): void;
	onTextChange(id: string, text: string): void;
	onTextEditingChange?(editing: boolean): void;
	onImageDimensions?(id: string, width: number, height: number): void;
}

const SNAP_SCREEN_PX = 7;

export function studioLayerRenderOrder(layers: StudioLayer[]): StudioLayer[] {
	const layerIDs = new Set(layers.map((layer) => layer.id));
	const childrenByParent = new Map<string, StudioLayer[]>();
	for (const layer of layers) {
		const parentID = layer.parent_id && layerIDs.has(layer.parent_id) ? layer.parent_id : '';
		const children = childrenByParent.get(parentID) ?? [];
		children.push(layer);
		childrenByParent.set(parentID, children);
	}

	const ordered: StudioLayer[] = [];
	const visited = new Set<string>();
	const appendLayer = (layer: StudioLayer): void => {
		if (visited.has(layer.id)) return;
		visited.add(layer.id);
		for (const child of childrenByParent.get(layer.id) ?? []) appendLayer(child);
		ordered.push(layer);
	};
	for (const layer of childrenByParent.get('') ?? []) appendLayer(layer);
	for (const layer of layers) appendLayer(layer);
	return ordered;
}

export class OpenPostFabricAdapter {
	private fabric: FabricModule | null = null;
	private canvas: FabricStaticCanvas | null = null;
	private readonly element: HTMLCanvasElement;
	private objectURLs = new Set<string>();
	private objectByLayerID = new Map<string, FabricObject>();
	private decorationsByLayerID = new Map<string, FabricObject[]>();
	private layerSnapshots = new Map<string, StudioLayer>();
	private desiredSelectionIDs: string[] = [];
	private pendingTextEditingID = '';
	private guideObjects: FabricObject[] = [];
	private syncing = false;
	private renderSequence = 0;
	private document: StudioDocument;
	private page: StudioPage;
	private readOnly: boolean;
	private interactionTool: StudioTool = 'select';
	private readonly staticMode: boolean;
	private readonly renderScale: number;
	private onSelection: FabricAdapterOptions['onSelection'];
	private onTransform: FabricAdapterOptions['onTransform'];
	private onTextChange: FabricAdapterOptions['onTextChange'];
	private onTextEditingChange: NonNullable<FabricAdapterOptions['onTextEditingChange']>;
	private onImageDimensions: NonNullable<FabricAdapterOptions['onImageDimensions']>;

	constructor(options: FabricAdapterOptions) {
		this.element = options.canvas;
		this.document = options.document;
		this.page = options.page;
		this.readOnly = options.readOnly;
		this.staticMode = Boolean(options.staticCanvas);
		this.renderScale = Math.max(0.01, options.renderScale ?? 1);
		this.onSelection = options.onSelection;
		this.onTransform = options.onTransform;
		this.onTextChange = options.onTextChange;
		this.onTextEditingChange = options.onTextEditingChange ?? (() => undefined);
		this.onImageDimensions = options.onImageDimensions ?? (() => undefined);
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
		this.interactiveCanvas()?.discardActiveObject();
		this.canvas.clear();
		this.revokeObjectURLs();
		this.objectByLayerID.clear();
		this.decorationsByLayerID.clear();
		this.layerSnapshots.clear();
		this.guideObjects = [];
		this.canvas.setDimensions({
			width: Math.max(1, Math.round(document.width_px * this.renderScale)),
			height: Math.max(1, Math.round(document.height_px * this.renderScale))
		});
		if (this.staticMode) this.canvas.setZoom(this.renderScale);
		this.canvas.backgroundColor = page.background_color;
		for (const layer of studioLayerRenderOrder(page.layers)) {
			const object = await this.createObject(layer);
			if (sequence !== this.renderSequence) {
				if (object) this.releaseObjectURL(object);
				return;
			}
			if (!object) continue;
			this.objectByLayerID.set(layer.id, object);
			this.layerSnapshots.set(layer.id, structuredClone(layer));
			this.canvas.add(object);
			this.refreshDecorations(layer, object);
		}
		if (!this.staticMode) this.restoreSelection(this.desiredSelectionIDs);
		this.flushPendingTextEditing();
		if (this.staticMode) this.canvas.renderAll();
		else this.canvas.requestRenderAll();
		this.syncing = false;
	}

	async sync(document: StudioDocument, page: StudioPage): Promise<void> {
		if (!this.canvas || !this.fabric) return;
		const dimensionsChanged =
			document.width_px !== this.document.width_px ||
			document.height_px !== this.document.height_px;
		const pageChanged = page.id !== this.page.id;
		if (dimensionsChanged || pageChanged) {
			await this.render(document, page);
			return;
		}

		const sequence = ++this.renderSequence;
		this.document = document;
		this.page = page;
		this.syncing = true;
		const nextLayerIDs = new Set(page.layers.map((layer) => layer.id));
		try {
			this.canvas.backgroundColor = page.background_color;
			for (const [id, object] of this.objectByLayerID) {
				if (nextLayerIDs.has(id)) continue;
				this.removeLayerObjects(id, object);
				this.objectByLayerID.delete(id);
				this.layerSnapshots.delete(id);
			}
			for (const layer of studioLayerRenderOrder(page.layers)) {
				const previous = this.layerSnapshots.get(layer.id);
				let object = this.objectByLayerID.get(layer.id);
				if (!previous || !object || this.requiresObjectRebuild(previous, layer)) {
					if (object) this.removeLayerObjects(layer.id, object);
					const replacement = await this.createObject(layer);
					if (sequence !== this.renderSequence) {
						if (replacement) this.releaseObjectURL(replacement);
						return;
					}
					if (!replacement) {
						this.objectByLayerID.delete(layer.id);
						this.layerSnapshots.delete(layer.id);
						continue;
					}
					object = replacement;
					this.objectByLayerID.set(layer.id, object);
					this.canvas.add(object);
					this.refreshDecorations(layer, object);
				} else if (JSON.stringify(previous) !== JSON.stringify(layer)) {
					this.updateObject(object, previous, layer);
					this.refreshDecorations(layer, object);
				}
				this.layerSnapshots.set(layer.id, structuredClone(layer));
			}
			this.objectByLayerID = new Map(
				studioLayerRenderOrder(page.layers)
					.map((layer) => [layer.id, this.objectByLayerID.get(layer.id)] as const)
					.filter((entry): entry is readonly [string, FabricObject] => Boolean(entry[1]))
			);
			this.syncObjectOrder();
			if (!this.staticMode) this.restoreSelection(this.desiredSelectionIDs);
			this.flushPendingTextEditing();
			if (this.staticMode) this.canvas.renderAll();
			else this.canvas.requestRenderAll();
		} finally {
			if (sequence === this.renderSequence) this.syncing = false;
		}
	}

	accept(document: StudioDocument, page: StudioPage): void {
		this.document = document;
		this.page = page;
		this.layerSnapshots = new Map(
			page.layers.map((layer) => [layer.id, structuredClone(layer)] as const)
		);
	}

	setReadOnly(readOnly: boolean): void {
		this.readOnly = readOnly;
		this.refreshInteractivity();
	}

	setInteractionTool(tool: StudioTool): void {
		if (this.interactionTool === tool) return;
		this.interactionTool = tool;
		this.refreshInteractivity();
	}

	layerIDsInRectangle(bounds: SelectionBounds): string[] {
		const ids: string[] = [];
		for (const layer of this.selectionRoots()) {
			const object = this.objectByLayerID.get(layer.id);
			if (!object || !boundsIntersect(bounds, this.objectBounds(object))) continue;
			ids.push(layer.id);
		}
		return ids;
	}

	layerIDsInPolygon(points: SelectionPoint[]): string[] {
		const ids: string[] = [];
		for (const layer of this.selectionRoots()) {
			const object = this.objectByLayerID.get(layer.id);
			if (!object || !polygonIntersectsBounds(points, this.objectBounds(object))) continue;
			ids.push(layer.id);
		}
		return ids;
	}

	topmostLayerIDAtPoint(point: SelectionPoint): string | null {
		if (!this.fabric) return null;
		for (const layer of studioLayerRenderOrder(this.page.layers).reverse()) {
			if (layer.type === 'group' || !this.layerCanBeSelected(layer)) continue;
			const object = this.objectByLayerID.get(layer.id);
			if (!object || !this.objectContainsPoint(object, point)) continue;
			return this.selectionRootID(layer);
		}
		return null;
	}

	magicLayerIDsAtPoint(point: SelectionPoint, tolerance: number): string[] {
		if (!this.fabric) return [];
		let hitLayer: StudioLayer | null = null;
		for (const layer of studioLayerRenderOrder(this.page.layers).reverse()) {
			if (layer.type === 'group' || !this.layerCanBeSelected(layer)) continue;
			const object = this.objectByLayerID.get(layer.id);
			if (object && this.objectContainsPoint(object, point)) {
				hitLayer = layer;
				break;
			}
		}
		if (!hitLayer) return [];
		const hitColor = this.layerFlatColor(hitLayer);
		if (!hitColor) return [this.selectionRootID(hitLayer)];
		const matches: string[] = [];
		for (const layer of studioLayerRenderOrder(this.page.layers)) {
			if (layer.type === 'group' || !this.layerCanBeSelected(layer)) continue;
			const color = this.layerFlatColor(layer);
			if (!color || !colorsWithinTolerance(hitColor, color, tolerance)) continue;
			matches.push(this.selectionRootID(layer));
		}
		return [...new Set(matches)];
	}

	rasterizeLayerIDs(ids: string[]): ImageData | null {
		if (!this.canvas || this.staticMode || ids.length === 0) return null;
		const expanded = new Set(ids);
		let changed = true;
		while (changed) {
			changed = false;
			for (const layer of this.page.layers) {
				if (!layer.parent_id || !expanded.has(layer.parent_id) || expanded.has(layer.id)) continue;
				expanded.add(layer.id);
				changed = true;
			}
		}
		const visibleObjects = new Set<FabricObject>();
		for (const id of expanded) {
			const object = this.objectByLayerID.get(id);
			if (object) visibleObjects.add(object);
			for (const decoration of this.decorationsByLayerID.get(id) ?? []) {
				visibleObjects.add(decoration);
			}
		}
		const objects = this.canvas.getObjects() as FabricObject[];
		const visibility = objects.map((object) => object.visible);
		const background = this.canvas.backgroundColor;
		try {
			this.canvas.backgroundColor = 'rgba(0,0,0,0)';
			for (const object of objects) object.visible = visibleObjects.has(object);
			this.canvas.renderAll();
			return this.canvas
				.getContext()
				.getImageData(0, 0, this.document.width_px, this.document.height_px);
		} finally {
			this.canvas.backgroundColor = background;
			objects.forEach((object, index) => (object.visible = visibility[index]));
			this.canvas.renderAll();
		}
	}

	private refreshInteractivity(): void {
		const canvas = this.interactiveCanvas();
		if (!canvas) return;
		const areaSelection = this.usesAreaSelection();
		canvas.selection = !this.readOnly && !areaSelection;
		canvas.defaultCursor = areaSelection ? 'crosshair' : 'default';
		canvas.hoverCursor = areaSelection ? 'crosshair' : 'move';
		for (const object of canvas.getObjects() as FabricObject[]) {
			if (!object.__studioLayerID) {
				object.selectable = false;
				object.evented = false;
				continue;
			}
			const layer = this.page.layers.find((candidate) => candidate.id === object.__studioLayerID);
			const interactive =
				Boolean(layer) && !this.readOnly && !areaSelection && !this.layerIsLocked(layer!);
			object.selectable = interactive;
			object.evented = interactive;
		}
		canvas.requestRenderAll();
	}

	setSelection(ids: string[]): void {
		this.desiredSelectionIDs = [...ids];
		if (this.syncing) return;
		this.restoreSelection(ids);
	}

	enterTextEditing(id: string): void {
		if (this.readOnly || this.staticMode) return;
		this.pendingTextEditingID = id;
		this.flushPendingTextEditing();
	}

	dispose(): void {
		this.renderSequence++;
		this.revokeObjectURLs();
		this.objectByLayerID.clear();
		this.decorationsByLayerID.clear();
		this.layerSnapshots.clear();
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
		canvas.on('object:moving', (event) => {
			const target = event.target as FabricObject;
			this.snapObject(target);
			this.syncDecorationTransform(target);
		});
		canvas.on('object:scaling', (event) =>
			this.syncDecorationTransform(event.target as FabricObject)
		);
		canvas.on('object:rotating', (event) =>
			this.syncDecorationTransform(event.target as FabricObject)
		);
		canvas.on('object:modified', (event) => {
			this.clearGuides();
			this.emitTransform(event.target as FabricObject);
		});
		canvas.on('text:changed', (event) => this.emitTextChange(event.target as FabricTextObject));
		canvas.on('text:editing:entered', () => this.onTextEditingChange(true));
		canvas.on('text:editing:exited', () => this.onTextEditingChange(false));
	}

	private flushPendingTextEditing(): void {
		const id = this.pendingTextEditingID;
		const canvas = this.interactiveCanvas();
		const object = id ? (this.objectByLayerID.get(id) as FabricTextObject | undefined) : undefined;
		if (!canvas || !object?.enterEditing) return;
		this.pendingTextEditingID = '';
		canvas.setActiveObject(object);
		if (!object.isEditing) {
			object.enterEditing();
			object.selectAll?.();
		}
		canvas.requestRenderAll();
	}

	private emitSelection(): void {
		if (this.syncing) return;
		const ids = this.selectedIDs();
		this.desiredSelectionIDs = ids;
		this.onSelection(ids);
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
	}

	private emitTextChange(target?: FabricTextObject): void {
		if (!target?.__studioLayerID || this.syncing || typeof target.text !== 'string') return;
		this.onTextChange(target.__studioLayerID, target.text);
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
			if (object === target || !object.__studioLayerID || this.guideObjects.includes(object))
				continue;
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
			const curve = layer.text.curve;
			const pathData = curve
				? createTextCurvePath(layer.transform.width, layer.transform.height, curve)
				: null;
			const textOptions = {
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
				backgroundColor: layer.text.highlight_color
			};
			if (pathData && curve) {
				const path = new this.fabric.Path(pathData, {
					fill: '',
					stroke: '',
					visible: false
				});
				object = new this.fabric.IText(layer.text.text.replaceAll('\n', ' '), {
					...textOptions,
					path,
					pathAlign: 'center',
					pathSide: curve.reverse ? 'right' : 'left',
					pathStartOffset: textCurveStartOffset(layer.transform.width, curve)
				}) as FabricObject;
			} else {
				object = new this.fabric.Textbox(layer.text.text, textOptions) as FabricObject;
			}
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
		if (layer.type === 'paint' && layer.paint) {
			const paint = structuredClone(layer.paint);
			const width = Math.max(1, layer.transform.width);
			const height = Math.max(1, layer.transform.height);
			const gradientBitmap =
				paint.kind === 'gradient' && paint.gradient ? createGradientBitmap(paint) : null;
			object = new this.fabric.FabricObject({
				...options,
				width,
				height,
				objectCaching: false
			}) as FabricCustomObject;
			object._render = (context: CanvasRenderingContext2D) => {
				context.save();
				context.translate(-width / 2, -height / 2);
				context.scale(
					width / Math.max(1, paint.source_width),
					height / Math.max(1, paint.source_height)
				);
				if (gradientBitmap) {
					context.globalAlpha = paint.opacity;
					context.drawImage(gradientBitmap, 0, 0);
					context.restore();
					return;
				}
				context.fillStyle = paint.color;
				context.strokeStyle = paint.color;
				context.globalAlpha = paint.opacity;
				if (paint.kind === 'fill') {
					for (const span of paint.spans) {
						context.fillRect(span.x, span.y, span.width, 1);
					}
				} else if (paint.points.length === 1) {
					const point = paint.points[0];
					context.beginPath();
					context.arc(point.x, point.y, paint.size / 2, 0, Math.PI * 2);
					context.fill();
				} else if (paint.points.length > 1) {
					context.lineWidth = paint.size;
					context.lineCap = 'round';
					context.lineJoin = 'round';
					context.beginPath();
					context.moveTo(paint.points[0].x, paint.points[0].y);
					for (const point of paint.points.slice(1)) context.lineTo(point.x, point.y);
					context.stroke();
				}
				context.restore();
			};
		}
		if (layer.type === 'image' && layer.image) {
			const response = await fetch(getAuthenticatedMediaURL(`/media/${layer.image.media_id}`), {
				credentials: 'include'
			});
			if (!response.ok) return null;
			const objectURL = URL.createObjectURL(await response.blob());
			this.objectURLs.add(objectURL);
			let image: InstanceType<FabricModule['FabricImage']>;
			try {
				image = await this.fabric.FabricImage.fromURL(objectURL);
			} catch (cause) {
				this.revokeObjectURL(objectURL);
				throw cause;
			}
			const sourceWidth = Math.max(1, image.width);
			const sourceHeight = Math.max(1, image.height);
			if (layer.image.intrinsic_pending) {
				queueMicrotask(() => this.onImageDimensions(layer.id, sourceWidth, sourceHeight));
			}
			const geometry = computeImageGeometry(layer, sourceWidth, sourceHeight);
			image.set({
				...options,
				...geometry
			});
			this.applyImageFilters(image, layer);
			object = image as FabricObject;
			object.__studioObjectURL = objectURL;
			object.__studioSourceWidth = sourceWidth;
			object.__studioSourceHeight = sourceHeight;
		}
		if (!object) return null;
		object.__studioLayerID = layer.id;
		this.applyLayerEffects(object, layer);
		const effectivelyLocked = this.layerIsLocked(layer);
		const interactive = !this.readOnly && !this.usesAreaSelection() && !effectivelyLocked;
		object.set({
			visible: this.layerIsVisible(layer),
			selectable: interactive,
			evented: interactive,
			lockMovementX: effectivelyLocked,
			lockMovementY: effectivelyLocked,
			lockRotation: effectivelyLocked,
			lockScalingX: effectivelyLocked,
			lockScalingY: effectivelyLocked
		});
		return object;
	}

	private requiresObjectRebuild(previous: StudioLayer, next: StudioLayer): boolean {
		if (previous.type !== next.type) return true;
		if (next.type === 'shape') return previous.shape?.kind !== next.shape?.kind;
		if (next.type === 'paint') return JSON.stringify(previous.paint) !== JSON.stringify(next.paint);
		if (next.type === 'text') {
			return JSON.stringify(previous.text?.curve) !== JSON.stringify(next.text?.curve);
		}
		if (next.type !== 'image') return false;
		return (
			previous.image?.media_id !== next.image?.media_id ||
			previous.image?.fit !== next.image?.fit ||
			JSON.stringify(previous.image?.crop) !== JSON.stringify(next.image?.crop)
		);
	}

	private updateObject(object: FabricObject, _previous: StudioLayer, layer: StudioLayer): void {
		if (!this.fabric) return;
		const effectivelyLocked = this.layerIsLocked(layer);
		const interactive = !this.readOnly && !this.usesAreaSelection() && !effectivelyLocked;
		const common = {
			angle: layer.transform.rotation,
			flipX: layer.transform.flip_x,
			flipY: layer.transform.flip_y,
			opacity: layer.opacity,
			visible: this.layerIsVisible(layer),
			selectable: interactive,
			evented: interactive,
			lockMovementX: effectivelyLocked,
			lockMovementY: effectivelyLocked,
			lockRotation: effectivelyLocked,
			lockScalingX: effectivelyLocked,
			lockScalingY: effectivelyLocked
		};

		if (layer.type === 'image' && layer.image) {
			object.set({
				...common
			});
			this.applyImageGeometry(object, layer);
			this.applyImageFilters(object as InstanceType<FabricModule['FabricImage']>, layer);
		} else if (layer.type === 'text' && layer.text) {
			const textObject = object as FabricTextObject;
			textObject.set({
				...common,
				scaleX: 1,
				scaleY: 1,
				left: layer.transform.x,
				top: layer.transform.y,
				width: layer.transform.width,
				text: layer.text.text,
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
				backgroundColor: layer.text.highlight_color
			});
			textObject.initDimensions?.();
		} else if (layer.type === 'shape' && layer.shape) {
			object.set({
				...common,
				scaleX: 1,
				scaleY: 1,
				left: layer.transform.x,
				top: layer.transform.y,
				width: layer.transform.width,
				height: layer.transform.height,
				fill: layer.shape.fill,
				stroke: layer.shape.stroke,
				strokeWidth: layer.shape.stroke_width,
				...(layer.shape.kind === 'rounded_rectangle'
					? { rx: layer.shape.radius, ry: layer.shape.radius }
					: {}),
				...(layer.shape.kind === 'ellipse'
					? { rx: layer.transform.width / 2, ry: layer.transform.height / 2 }
					: {}),
				...(layer.shape.kind === 'line' ? { x2: layer.transform.width, y2: 0 } : {})
			});
		} else {
			object.set({
				...common,
				scaleX: 1,
				scaleY: 1,
				left: layer.transform.x,
				top: layer.transform.y,
				width: layer.transform.width,
				height: layer.transform.height
			});
		}
		this.applyLayerEffects(object, layer);
		object.setCoords();
	}

	private applyLayerEffects(object: FabricObject, layer: StudioLayer): void {
		if (!this.fabric) return;
		const blendMode = layer.effects?.blend_mode ?? 'normal';
		object.globalCompositeOperation =
			blendMode === 'normal'
				? 'source-over'
				: blendMode === 'soft_light'
					? 'soft-light'
					: blendMode;
		const effect = layer.effects?.drop_shadow;
		if (effect) {
			const offset = shadowOffset(effect);
			object.shadow = new this.fabric.Shadow({
				color: shadowColor(effect),
				blur: effect.blur,
				offsetX: offset.x,
				offsetY: offset.y,
				nonScaling: true
			});
		} else if (
			layer.type === 'text' &&
			layer.text &&
			(layer.text.shadow.blur ||
				layer.text.shadow.offset_x ||
				layer.text.shadow.offset_y ||
				layer.text.shadow.color !== '#00000000')
		) {
			object.shadow = new this.fabric.Shadow({
				color: layer.text.shadow.color,
				blur: layer.text.shadow.blur,
				offsetX: layer.text.shadow.offset_x,
				offsetY: layer.text.shadow.offset_y,
				nonScaling: true
			});
		} else {
			object.shadow = null;
		}
		object.clipPath = this.createMaskClip(layer, object);
		object.dirty = true;
	}

	private createMaskClip(layer: StudioLayer, object: FabricObject): FabricObject | undefined {
		if (!this.fabric || !layer.mask) return undefined;
		const scaleX = Math.max(0.01, Math.abs(object.scaleX ?? 1));
		const scaleY = Math.max(0.01, Math.abs(object.scaleY ?? 1));
		const width = Math.max(
			1,
			(object.width ?? layer.transform.width) - (layer.mask.inset * 2) / scaleX
		);
		const height = Math.max(
			1,
			(object.height ?? layer.transform.height) - (layer.mask.inset * 2) / scaleY
		);
		const common = {
			left: 0,
			top: 0,
			originX: 'center' as const,
			originY: 'center' as const,
			fill: '#000000',
			strokeWidth: 0,
			selectable: false,
			evented: false
		};
		if (layer.mask.shape === 'circle') {
			return new this.fabric.Circle({
				...common,
				radius: Math.min(width, height) / 2
			}) as FabricObject;
		}
		if (layer.mask.shape === 'ellipse') {
			return new this.fabric.Ellipse({
				...common,
				rx: width / 2,
				ry: height / 2
			}) as FabricObject;
		}
		if (layer.mask.shape === 'diamond') {
			return new this.fabric.Path(
				`M 0 ${-height / 2} L ${width / 2} 0 L 0 ${height / 2} L ${-width / 2} 0 Z`,
				common
			) as FabricObject;
		}
		const radius =
			layer.mask.shape === 'rounded_rectangle'
				? Math.min(layer.mask.radius / Math.max(scaleX, scaleY), width / 2, height / 2)
				: 0;
		return new this.fabric.Rect({
			...common,
			width,
			height,
			rx: radius,
			ry: radius
		}) as FabricObject;
	}

	private refreshDecorations(layer: StudioLayer, object: FabricObject): void {
		if (!this.canvas) return;
		for (const decoration of this.decorationsByLayerID.get(layer.id) ?? []) {
			this.canvas.remove(decoration);
		}
		this.decorationsByLayerID.delete(layer.id);
		if (layer.type === 'group') return;
		const decorations = [
			layer.effects?.stroke
				? this.createStrokeDecoration(layer, object, layer.effects.stroke)
				: null,
			layer.effects?.inner_shadow
				? this.createInnerShadowDecoration(layer, object, layer.effects.inner_shadow)
				: null
		].filter((decoration): decoration is FabricObject => Boolean(decoration));
		if (decorations.length === 0) return;
		this.decorationsByLayerID.set(layer.id, decorations);
		for (const decoration of decorations) this.canvas.add(decoration);
	}

	private createStrokeDecoration(
		layer: StudioLayer,
		object: FabricObject,
		effect: NonNullable<NonNullable<StudioLayer['effects']>['stroke']>
	): FabricObject | null {
		if (!this.fabric || layer.shape?.kind === 'line') return null;
		const width = Math.max(1, object.width ?? layer.transform.width);
		const height = Math.max(1, object.height ?? layer.transform.height);
		const decoration = new this.fabric.FabricObject({
			left: object.left,
			top: object.top,
			width,
			height,
			scaleX: object.scaleX,
			scaleY: object.scaleY,
			angle: object.angle,
			flipX: object.flipX,
			flipY: object.flipY,
			originX: object.originX,
			originY: object.originY,
			opacity: layer.opacity * effect.opacity,
			visible: this.layerIsVisible(layer),
			selectable: false,
			evented: false,
			objectCaching: false
		}) as FabricCustomObject;
		const mask = effectiveMask(layer, object);
		decoration._render = (context: CanvasRenderingContext2D) => {
			context.save();
			if (effect.position === 'inside') {
				context.beginPath();
				appendMaskPath(context, width, height, mask);
				context.clip();
			} else if (effect.position === 'outside') {
				context.beginPath();
				context.rect(-width * 2, -height * 2, width * 4, height * 4);
				appendMaskPath(context, width, height, mask);
				context.clip('evenodd');
			}
			context.strokeStyle = effect.color;
			context.lineWidth = effect.position === 'center' ? effect.width : effect.width * 2;
			context.lineJoin = 'round';
			context.beginPath();
			appendMaskPath(context, width, height, mask);
			context.stroke();
			context.restore();
		};
		return decoration;
	}

	private createInnerShadowDecoration(
		layer: StudioLayer,
		object: FabricObject,
		effect: NonNullable<NonNullable<StudioLayer['effects']>['inner_shadow']>
	): FabricObject | null {
		if (!this.fabric || layer.shape?.kind === 'line') return null;
		const width = Math.max(1, object.width ?? layer.transform.width);
		const height = Math.max(1, object.height ?? layer.transform.height);
		const decoration = new this.fabric.FabricObject({
			left: object.left,
			top: object.top,
			width,
			height,
			scaleX: object.scaleX,
			scaleY: object.scaleY,
			angle: object.angle,
			flipX: object.flipX,
			flipY: object.flipY,
			originX: object.originX,
			originY: object.originY,
			opacity: layer.opacity,
			visible: this.layerIsVisible(layer),
			selectable: false,
			evented: false,
			objectCaching: false
		}) as FabricCustomObject;
		const mask = effectiveMask(layer, object);
		const offset = shadowOffset(effect);
		const color = shadowColor(effect);
		decoration._render = (context: CanvasRenderingContext2D) => {
			context.save();
			context.beginPath();
			appendMaskPath(context, width, height, mask);
			context.clip();
			context.shadowColor = color;
			context.shadowBlur = effect.blur;
			context.shadowOffsetX = offset.x;
			context.shadowOffsetY = offset.y;
			context.fillStyle = color;
			context.beginPath();
			context.rect(-width * 2, -height * 2, width * 4, height * 4);
			appendMaskPath(context, width, height, mask);
			context.fill('evenodd');
			context.restore();
		};
		return decoration;
	}

	private syncDecorationTransform(target: FabricObject): void {
		if (!target.__studioLayerID) return;
		for (const decoration of this.decorationsByLayerID.get(target.__studioLayerID) ?? []) {
			decoration.set({
				left: target.left,
				top: target.top,
				width: target.width,
				height: target.height,
				scaleX: target.scaleX,
				scaleY: target.scaleY,
				angle: target.angle,
				flipX: target.flipX,
				flipY: target.flipY,
				originX: target.originX,
				originY: target.originY
			});
			decoration.setCoords();
		}
	}

	private syncObjectOrder(): void {
		if (!this.canvas) return;
		let index = 0;
		for (const layer of studioLayerRenderOrder(this.page.layers)) {
			const object = this.objectByLayerID.get(layer.id);
			if (object) this.canvas.moveObjectTo(object, index++);
			for (const decoration of this.decorationsByLayerID.get(layer.id) ?? []) {
				this.canvas.moveObjectTo(decoration, index++);
			}
		}
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

	private usesAreaSelection(): boolean {
		return [
			'marquee',
			'ellipse_marquee',
			'lasso',
			'magic_wand',
			'pencil',
			'bucket',
			'gradient'
		].includes(this.interactionTool);
	}

	private layerCanBeSelected(layer: StudioLayer): boolean {
		return this.layerIsVisible(layer) && !this.layerIsLocked(layer);
	}

	private selectionRoots(): StudioLayer[] {
		return this.page.layers.filter((layer) => !layer.parent_id && this.layerCanBeSelected(layer));
	}

	private selectionRootID(layer: StudioLayer): string {
		let current = layer;
		const visited = new Set<string>();
		while (current.parent_id && !visited.has(current.parent_id)) {
			visited.add(current.parent_id);
			const parent = this.page.layers.find((candidate) => candidate.id === current.parent_id);
			if (!parent) break;
			current = parent;
		}
		return current.id;
	}

	private layerFlatColor(layer: StudioLayer): string | null {
		if (layer.type === 'shape') return layer.shape?.fill ?? null;
		if (layer.type === 'text') return layer.text?.color ?? null;
		if (layer.type === 'paint') return layer.paint?.color ?? null;
		return null;
	}

	private objectBounds(object: FabricObject): SelectionBounds {
		const bounds = object.getBoundingRect();
		return {
			x: bounds.left,
			y: bounds.top,
			width: bounds.width,
			height: bounds.height
		};
	}

	private objectContainsPoint(object: FabricObject, point: SelectionPoint): boolean {
		const bounds = this.objectBounds(object);
		return (
			point.x >= bounds.x &&
			point.x <= bounds.x + bounds.width &&
			point.y >= bounds.y &&
			point.y <= bounds.y + bounds.height
		);
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
			touchCornerSize: 44,
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

	private applyImageGeometry(object: FabricObject, layer: StudioLayer): void {
		if (!layer.image) return;
		const sourceWidth = Math.max(
			1,
			object.__studioSourceWidth ?? layer.image.source_width ?? object.width ?? 1
		);
		const sourceHeight = Math.max(
			1,
			object.__studioSourceHeight ?? layer.image.source_height ?? object.height ?? 1
		);
		object.set(computeImageGeometry(layer, sourceWidth, sourceHeight));
	}

	private restoreSelection(ids: string[]): void {
		const canvas = this.interactiveCanvas();
		if (!canvas || !this.fabric) return;
		const wasSyncing = this.syncing;
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
		this.syncing = wasSyncing;
	}

	private revokeObjectURLs(): void {
		for (const url of this.objectURLs) URL.revokeObjectURL(url);
		this.objectURLs.clear();
	}

	private removeLayerObjects(id: string, object: FabricObject): void {
		this.canvas?.remove(object);
		for (const decoration of this.decorationsByLayerID.get(id) ?? []) {
			this.canvas?.remove(decoration);
		}
		this.decorationsByLayerID.delete(id);
		this.releaseObjectURL(object);
	}

	private releaseObjectURL(object: FabricObject): void {
		if (!object.__studioObjectURL) return;
		this.revokeObjectURL(object.__studioObjectURL);
		delete object.__studioObjectURL;
	}

	private revokeObjectURL(url: string): void {
		URL.revokeObjectURL(url);
		this.objectURLs.delete(url);
	}
}

interface StudioRenderMask {
	shape: 'rectangle' | 'rounded_rectangle' | 'circle' | 'ellipse' | 'diamond';
	insetX: number;
	insetY: number;
	radius: number;
}

function effectiveMask(layer: StudioLayer, object: FabricObject): StudioRenderMask {
	const scaleX = Math.max(0.01, Math.abs(object.scaleX ?? 1));
	const scaleY = Math.max(0.01, Math.abs(object.scaleY ?? 1));
	if (layer.mask) {
		return {
			shape: layer.mask.shape,
			insetX: layer.mask.inset / scaleX,
			insetY: layer.mask.inset / scaleY,
			radius: layer.mask.radius / Math.max(scaleX, scaleY)
		};
	}
	if (layer.shape?.kind === 'ellipse') {
		return { shape: 'ellipse', insetX: 0, insetY: 0, radius: 0 };
	}
	if (layer.shape?.kind === 'rounded_rectangle') {
		return {
			shape: 'rounded_rectangle',
			insetX: 0,
			insetY: 0,
			radius: layer.shape.radius / Math.max(scaleX, scaleY)
		};
	}
	return { shape: 'rectangle', insetX: 0, insetY: 0, radius: 0 };
}

function appendMaskPath(
	context: CanvasRenderingContext2D,
	width: number,
	height: number,
	mask: StudioRenderMask
): void {
	const maskedWidth = Math.max(1, width - mask.insetX * 2);
	const maskedHeight = Math.max(1, height - mask.insetY * 2);
	const left = -maskedWidth / 2;
	const top = -maskedHeight / 2;
	if (mask.shape === 'circle') {
		context.arc(0, 0, Math.min(maskedWidth, maskedHeight) / 2, 0, Math.PI * 2);
		return;
	}
	if (mask.shape === 'ellipse') {
		context.ellipse(0, 0, maskedWidth / 2, maskedHeight / 2, 0, 0, Math.PI * 2);
		return;
	}
	if (mask.shape === 'diamond') {
		context.moveTo(0, top);
		context.lineTo(maskedWidth / 2, 0);
		context.lineTo(0, maskedHeight / 2);
		context.lineTo(left, 0);
		context.closePath();
		return;
	}
	const radius =
		mask.shape === 'rounded_rectangle'
			? Math.min(mask.radius, maskedWidth / 2, maskedHeight / 2)
			: 0;
	if (radius <= 0) {
		context.rect(left, top, maskedWidth, maskedHeight);
		return;
	}
	context.moveTo(left + radius, top);
	context.lineTo(left + maskedWidth - radius, top);
	context.quadraticCurveTo(left + maskedWidth, top, left + maskedWidth, top + radius);
	context.lineTo(left + maskedWidth, top + maskedHeight - radius);
	context.quadraticCurveTo(
		left + maskedWidth,
		top + maskedHeight,
		left + maskedWidth - radius,
		top + maskedHeight
	);
	context.lineTo(left + radius, top + maskedHeight);
	context.quadraticCurveTo(left, top + maskedHeight, left, top + maskedHeight - radius);
	context.lineTo(left, top + radius);
	context.quadraticCurveTo(left, top, left + radius, top);
	context.closePath();
}

function createGradientBitmap(paint: NonNullable<StudioLayer['paint']>): HTMLCanvasElement | null {
	if (!paint.gradient || typeof globalThis.document === 'undefined') return null;
	const width = Math.max(1, Math.ceil(paint.source_width));
	const height = Math.max(1, Math.ceil(paint.source_height));
	const canvas = globalThis.document.createElement('canvas');
	canvas.width = width;
	canvas.height = height;
	const context = canvas.getContext('2d');
	if (!context) return null;
	if (paint.gradient.type !== 'diamond') {
		context.fillStyle = createStudioCanvasGradient(context, paint.gradient);
		for (const span of paint.spans) context.fillRect(span.x, span.y, span.width, 1);
		return canvas;
	}

	const sampleStep = Math.max(1, Math.ceil(Math.max(width, height) / 1024));
	for (const span of paint.spans) {
		for (let x = span.x; x < span.x + span.width; x += sampleStep) {
			context.fillStyle = gradientColorAt(paint.gradient, {
				x: x + sampleStep / 2,
				y: span.y + 0.5
			});
			context.fillRect(x, span.y, Math.min(sampleStep, span.x + span.width - x), 1);
		}
	}
	return canvas;
}

function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}

export function computeImageGeometry(
	layer: Pick<StudioLayer, 'transform' | 'image'>,
	sourceWidth: number,
	sourceHeight: number
): StudioImageGeometry {
	if (!layer.image) throw new Error('Image geometry requires image data.');
	const crop = layer.image.crop;
	let cropX = clamp(crop.x, 0, 0.99) * sourceWidth;
	let cropY = clamp(crop.y, 0, 0.99) * sourceHeight;
	let cropWidth = clamp(crop.width, 0.01, 1 - crop.x) * sourceWidth;
	let cropHeight = clamp(crop.height, 0.01, 1 - crop.y) * sourceHeight;
	let left = layer.transform.x;
	let top = layer.transform.y;
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
	return {
		left,
		top,
		cropX,
		cropY,
		width: cropWidth,
		height: cropHeight,
		scaleX,
		scaleY
	};
}
