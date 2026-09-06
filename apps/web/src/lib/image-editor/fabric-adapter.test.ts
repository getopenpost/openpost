import { describe, expect, it } from 'vitest';
import {
	computeImageGeometry,
	type ImageEditorImageGeometry,
	imageEditorScreenZoom,
	imageEditorPixelGrid,
	imageEditorPixelIsOpaque,
	OpenPostFabricAdapter,
	imageEditorLayerRenderOrder,
	snapImageEditorPoint,
	snapImageEditorResize
} from './fabric-adapter';
import type { ImageEditorDocument, ImageEditorLayer, ImageEditorPage } from './types';

// SAFETY: the adapter constructor only stores this element; tests that mount Fabric use browser tests.
const TEST_CANVAS = {} as HTMLCanvasElement;

function pageFixture(layers: ImageEditorLayer[] = []): ImageEditorPage {
	return {
		id: 'page',
		name: 'Page 1',
		background_color: '#ffffff',
		layers
	};
}

function documentFixture(page: ImageEditorPage = pageFixture()): ImageEditorDocument {
	return {
		schema_version: 1,
		title: 'Test image',
		preset_key: 'square',
		width_px: 1080,
		height_px: 1080,
		brand_kit_revision: 0,
		export_defaults: {
			format: 'png',
			quality: 0.9,
			matte_color: '#ffffff'
		},
		pages: [page]
	};
}

function adapterInternals<T extends object>(adapter: OpenPostFabricAdapter): T {
	// SAFETY: named test contracts expose only the adapter members exercised by each focused test.
	return adapter as T;
}

class PointerInputFixture extends Event {
	constructor(
		readonly shiftKey = false,
		readonly ctrlKey = false,
		readonly altKey = false,
		readonly metaKey = false,
		readonly button = 0
	) {
		super('pointer');
	}
}

function imageLayer(
	width: number,
	height: number,
	fit: NonNullable<ImageEditorLayer['image']>['fit'] = 'cover'
): ImageEditorLayer {
	return {
		id: 'layer-image',
		type: 'image',
		name: 'Image',
		visible: true,
		locked: false,
		opacity: 1,
		transform: {
			x: 40,
			y: 80,
			width,
			height,
			rotation: 0,
			flip_x: false,
			flip_y: false
		},
		image: {
			media_id: 'media-image',
			source_width: 1920,
			source_height: 1080,
			fit,
			crop: { x: 0, y: 0, width: 1, height: 1 },
			adjustments: {
				brightness: 0,
				contrast: 0,
				saturation: 0,
				temperature: 0,
				tint: 0,
				vibrance: 0,
				hue: 0,
				exposure: 0,
				highlights: 0,
				shadows: 0,
				blur: 0
			}
		}
	};
}

interface ImageObjectFixture extends ImageEditorImageGeometry {
	__imageEditorSourceWidth: number;
	__imageEditorSourceHeight: number;
	filters?: never[];
	set(updates: Partial<ImageObjectFixture>): void;
	setCoords(): void;
	applyFilters(): void;
}

interface ImageGeometryAdapterInternals {
	fabric: object;
	updateObject(
		target: ImageObjectFixture,
		previous: ImageEditorLayer,
		next: ImageEditorLayer
	): void;
}

describe('OpenPost Image Editor image geometry', () => {
	it('builds a centered pixel grid with transparent padding at image edges', () => {
		const image = {
			width: 2,
			height: 2,
			data: new Uint8ClampedArray([
				255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255
			])
		};

		const grid = imageEditorPixelGrid(image, { x: 0, y: 0 }, 1);

		expect(grid.width).toBe(3);
		expect(grid.height).toBe(3);
		expect(Array.from(grid.centerPixel)).toEqual([255, 0, 0, 255]);
		expect(Array.from(grid.data.slice(0, 4))).toEqual([0, 0, 0, 0]);
		expect(Array.from(grid.data.slice(16, 20))).toEqual([255, 0, 0, 255]);
		expect(Array.from(grid.data.slice(32, 36))).toEqual([255, 255, 255, 255]);
	});

	it('treats transparent image padding as click-through while keeping visible edge pixels selectable', () => {
		const image = {
			width: 2,
			height: 2,
			data: new Uint8ClampedArray([255, 0, 0, 0, 255, 0, 0, 7, 255, 0, 0, 8, 255, 0, 0, 255])
		};

		expect(imageEditorPixelIsOpaque(image, { x: 0, y: 0 })).toBe(false);
		expect(imageEditorPixelIsOpaque(image, { x: 1, y: 0 })).toBe(false);
		expect(imageEditorPixelIsOpaque(image, { x: 0, y: 1 })).toBe(true);
		expect(imageEditorPixelIsOpaque(image, { x: 2, y: 1 })).toBe(false);
	});

	it('keeps cover pixels flush with a resized frame', () => {
		const geometry = computeImageGeometry(imageLayer(1200, 1200), 1920, 1080);

		expect(geometry.left).toBe(40);
		expect(geometry.top).toBe(80);
		expect(geometry.width * geometry.scaleX).toBeCloseTo(1200);
		expect(geometry.height * geometry.scaleY).toBeCloseTo(1200);
		expect(geometry.cropX).toBeCloseTo(420);
		expect(geometry.cropY).toBe(0);
	});

	it('recomputes stretch scale from source pixels after repeated resizes', () => {
		const first = computeImageGeometry(imageLayer(960, 540, 'stretch'), 1920, 1080);
		const second = computeImageGeometry(imageLayer(1440, 810, 'stretch'), 1920, 1080);

		expect(first.width).toBe(1920);
		expect(first.scaleX).toBe(0.5);
		expect(second.width).toBe(1920);
		expect(second.scaleX).toBe(0.75);
		expect(second.width * second.scaleX).toBe(1440);
		expect(second.height * second.scaleY).toBe(810);
	});

	it.each(['cover', 'contain'] as const)(
		'recomputes %s object geometry after a frame aspect-ratio change',
		(fit) => {
			const previous = imageLayer(800, 800, fit);
			const next = imageLayer(1200, 600, fit);
			const initial = computeImageGeometry(previous, 1920, 1080);
			const imageObject: ImageObjectFixture = {
				...initial,
				__imageEditorSourceWidth: 1920,
				__imageEditorSourceHeight: 1080,
				set(updates: Partial<ImageObjectFixture>) {
					Object.assign(this, updates);
				},
				setCoords() {},
				applyFilters() {}
			};
			const page = pageFixture([next]);
			const adapter = new OpenPostFabricAdapter({
				canvas: TEST_CANVAS,
				document: documentFixture(page),
				page,
				readOnly: false,
				onSelection: () => undefined,
				onTransform: () => undefined,
				onTextChange: () => undefined
			});
			const internals = adapterInternals<ImageGeometryAdapterInternals>(adapter);
			internals.fabric = {};

			internals.updateObject(imageObject, previous, next);

			expect(imageObject).toMatchObject(computeImageGeometry(next, 1920, 1080));
			expect(imageObject.scaleX).toBeCloseTo(imageObject.scaleY);
		}
	);
});

describe('OpenPost Image Editor rotation gestures', () => {
	it('configures snapping before Fabric calculates the angle without rewriting the live angle', () => {
		interface RotationTargetFixture {
			angle: number;
			snapAngle?: number;
			snapThreshold?: number;
		}
		interface FabricEventFixture {
			e: Event;
			target?: RotationTargetFixture;
			transform?: { action: string; target: RotationTargetFixture };
		}
		interface EventCanvasFixture {
			on(eventName: string, handler: (event: FabricEventFixture) => void): void;
			getActiveObject(): RotationTargetFixture;
		}
		interface RotationAdapterInternals {
			canvas: EventCanvasFixture;
			bindEvents(): void;
		}

		const page = pageFixture();
		const adapter = new OpenPostFabricAdapter({
			canvas: TEST_CANVAS,
			document: documentFixture(page),
			page,
			readOnly: false,
			onSelection: () => undefined,
			onTransform: () => undefined,
			onTextChange: () => undefined
		});
		const handlers = new Map<string, (event: FabricEventFixture) => void>();
		const target = { angle: 22, snapAngle: undefined, snapThreshold: undefined };
		const canvas: EventCanvasFixture = {
			on(eventName, handler) {
				handlers.set(eventName, handler);
			},
			getActiveObject() {
				return target;
			}
		};
		const internals = adapterInternals<RotationAdapterInternals>(adapter);
		internals.canvas = canvas;
		internals.bindEvents();
		const dispatch = (eventName: string, event: FabricEventFixture) => {
			const handler = handlers.get(eventName);
			if (!handler) throw new Error(`Missing Fabric event handler: ${eventName}`);
			handler(event);
		};

		dispatch('mouse:move:before', {
			e: new PointerInputFixture(true),
			transform: { action: 'rotate', target }
		});
		expect(target).toMatchObject({ angle: 22, snapAngle: 15, snapThreshold: 7.5 });

		dispatch('object:rotating', { e: new PointerInputFixture(true), target });
		expect(target.angle).toBe(22);

		dispatch('mouse:move:before', {
			e: new PointerInputFixture(false),
			transform: { action: 'rotate', target }
		});
		expect(target).toMatchObject({
			angle: 22,
			snapAngle: undefined,
			snapThreshold: undefined
		});

		adapter.setSnapping(false);
		dispatch('mouse:move:before', {
			e: new PointerInputFixture(true),
			transform: { action: 'rotate', target }
		});
		expect(target).toMatchObject({ snapAngle: undefined, snapThreshold: undefined });

		adapter.setSnapping(true);
		dispatch('mouse:move:before', {
			e: new PointerInputFixture(true, true),
			transform: { action: 'rotate', target }
		});
		expect(target).toMatchObject({ snapAngle: undefined, snapThreshold: undefined });
	});
});

describe('OpenPost Image Editor multi-selection movement', () => {
	it('does not snap an active selection against its own relative child coordinates', () => {
		interface SelectionChildFixture {
			__imageEditorLayerID: string;
			left: number;
			top: number;
			getScaledWidth(): number;
			getScaledHeight(): number;
		}
		interface SelectionFixture {
			left: number;
			top: number;
			getScaledWidth(): number;
			getScaledHeight(): number;
			getObjects(): SelectionChildFixture[];
		}
		interface SelectionCanvasFixture {
			getZoom(): number;
			getWidth(): number;
			getElement(): { getBoundingClientRect(): { width: number } };
			getObjects(): SelectionChildFixture[];
			remove(): void;
		}
		interface SelectionAdapterInternals {
			fabric: object;
			canvas: SelectionCanvasFixture;
			snapObject(target: SelectionFixture): void;
		}

		const page = pageFixture();
		const adapter = new OpenPostFabricAdapter({
			canvas: TEST_CANVAS,
			document: documentFixture(page),
			page,
			readOnly: false,
			onSelection: () => undefined,
			onTransform: () => undefined,
			onTextChange: () => undefined
		});
		const child: SelectionChildFixture = {
			__imageEditorLayerID: 'text',
			left: 105,
			top: 105,
			getScaledWidth: () => 80,
			getScaledHeight: () => 40
		};
		const selection: SelectionFixture = {
			left: 100,
			top: 100,
			getScaledWidth: () => 200,
			getScaledHeight: () => 160,
			getObjects: () => [child]
		};
		const canvas: SelectionCanvasFixture = {
			getZoom: () => 1,
			getWidth: () => 1080,
			getElement: () => ({ getBoundingClientRect: () => ({ width: 1080 }) }),
			getObjects: () => [child],
			remove: () => undefined
		};
		const internals = adapterInternals<SelectionAdapterInternals>(adapter);
		internals.fabric = {};
		internals.canvas = canvas;

		internals.snapObject(selection);

		expect(selection).toMatchObject({ left: 100, top: 100 });
	});
});

describe('OpenPost Image Editor point snapping', () => {
	it('uses the nearest axis target without changing pointer metadata', () => {
		const snapped = snapImageEditorPoint(
			{ x: 104, y: 197, pressure: 0.75 },
			[0, 100, 200],
			[0, 200, 400],
			6
		);

		expect(snapped).toEqual({
			point: { x: 100, y: 200, pressure: 0.75 },
			guideX: 100,
			guideY: 200
		});
	});

	it('can restrict snapping to the axis used by a guide', () => {
		const snapped = snapImageEditorPoint({ x: 104, y: 197 }, [100], [200], 6, 'x');
		expect(snapped.point).toEqual({ x: 100, y: 197 });
		expect(snapped.guideY).toBeNull();
	});
});

describe('OpenPost Image Editor screen zoom', () => {
	it('combines Fabric and CSS scaling so tolerances remain stable on screen', () => {
		expect(imageEditorScreenZoom(1, 464.4, 1080)).toBeCloseTo(0.43);
		expect(imageEditorScreenZoom(2, 540, 1080)).toBe(1);
		// A 2160 px backing store displayed at 540 CSS px remains a 0.5x screen zoom
		// even on a 2x display; device pixels must not double snapping tolerances.
		expect(imageEditorScreenZoom(2, 540, 2160)).toBe(0.5);
	});

	it('falls back to the internal zoom when layout dimensions are unavailable', () => {
		expect(imageEditorScreenZoom(1.5, 0, 1080)).toBe(1.5);
		expect(imageEditorScreenZoom(1.5, 100, 0)).toBe(1.5);
	});
});

describe('OpenPost Image Editor resize snapping', () => {
	it('snaps a horizontal resize to the document edge', () => {
		const snapped = snapImageEditorResize(
			{ left: 30, top: 40, width: 1044, height: 500 },
			'mr',
			[0, 540, 1080],
			[0, 540, 1080],
			10
		);

		expect(snapped.bounds).toEqual({ left: 30, top: 40, width: 1050, height: 500 });
		expect(snapped.guideX).toBe(1080);
	});

	it('preserves aspect ratio when a corner resize snaps to the document edge', () => {
		const snapped = snapImageEditorResize(
			{ left: 30, top: 40, width: 1044, height: 522 },
			'br',
			[0, 540, 1080],
			[0, 540, 1080],
			10
		);

		expect(snapped.bounds.width).toBe(1050);
		expect(snapped.bounds.height).toBe(525);
		expect(snapped.bounds.left + snapped.bounds.width).toBe(1080);
	});
});

describe('OpenPost Image Editor layer render order', () => {
	function interleavedGroupLayers(): ImageEditorLayer[] {
		const rectangle: ImageEditorLayer = {
			...imageLayer(400, 300),
			id: 'rectangle',
			type: 'shape'
		};
		const circle: ImageEditorLayer = { ...imageLayer(160, 160), id: 'circle', type: 'shape' };
		const text: ImageEditorLayer = { ...imageLayer(360, 120), id: 'text', type: 'text' };
		const image: ImageEditorLayer = { ...imageLayer(240, 320), id: 'image' };
		const group: ImageEditorLayer = { ...imageLayer(500, 400), id: 'group', type: 'group' };
		rectangle.parent_id = group.id;
		text.parent_id = group.id;
		return [rectangle, circle, text, image, group];
	}

	it('keeps every grouped child inside the group stacking slot', () => {
		const order = imageEditorLayerRenderOrder(interleavedGroupLayers());

		expect(order.map((layer) => layer.id)).toEqual([
			'circle',
			'image',
			'rectangle',
			'text',
			'group'
		]);
	});

	it('reapplies the grouped stacking order during incremental canvas sync', () => {
		interface OrderedObjectFixture {
			id: string;
		}
		interface ObjectOrderCanvasFixture {
			moveObjectTo(object: OrderedObjectFixture, index: number): void;
		}
		interface ObjectOrderAdapterInternals {
			canvas: ObjectOrderCanvasFixture;
			objectByLayerID: Map<string, OrderedObjectFixture>;
			decorationsByLayerID: Map<string, OrderedObjectFixture[]>;
			syncObjectOrder(): void;
		}

		const layers = interleavedGroupLayers();
		const page = pageFixture(layers);
		const document = documentFixture(page);
		const adapter = new OpenPostFabricAdapter({
			canvas: TEST_CANVAS,
			document,
			page,
			readOnly: false,
			onSelection: () => undefined,
			onTransform: () => undefined,
			onTextChange: () => undefined
		});
		const objects = new Map(layers.map((layer) => [layer.id, { id: layer.id }]));
		const moved: string[] = [];
		const internals = adapterInternals<ObjectOrderAdapterInternals>(adapter);
		internals.canvas = {
			moveObjectTo(object, index) {
				moved[index] = object.id;
			}
		};
		internals.objectByLayerID = objects;
		internals.decorationsByLayerID = new Map();

		internals.syncObjectOrder();

		expect(moved).toEqual(['circle', 'image', 'rectangle', 'text', 'group']);
	});
});

describe('OpenPost Image Editor group state', () => {
	it('refreshes unchanged descendants when a group becomes hidden and locked', async () => {
		interface LayerObjectFixture {
			visible: boolean;
			selectable: boolean;
			evented: boolean;
			lockMovementX?: boolean;
			lockMovementY?: boolean;
			lockRotation?: boolean;
			lockScalingX?: boolean;
			lockScalingY?: boolean;
			set(updates: Partial<LayerObjectFixture>): void;
			setCoords(): void;
		}
		interface GroupStateCanvasFixture {
			backgroundColor: string;
			moveObjectTo(object: LayerObjectFixture, index: number): void;
			renderAll(): void;
		}
		interface GroupStateAdapterInternals {
			fabric: object;
			canvas: GroupStateCanvasFixture;
			objectByLayerID: Map<string, LayerObjectFixture>;
			layerSnapshots: Map<string, ImageEditorLayer>;
			decorationsByLayerID: Map<string, LayerObjectFixture[]>;
		}

		const child: ImageEditorLayer = {
			...imageLayer(400, 300),
			id: 'child',
			type: 'shape',
			parent_id: 'group',
			image: undefined,
			shape: {
				kind: 'rectangle',
				fill: '#ffffff',
				stroke: '#00000000',
				stroke_width: 0,
				radius: 0
			}
		};
		const group: ImageEditorLayer = {
			...imageLayer(500, 400),
			id: 'group',
			type: 'group',
			image: undefined
		};
		const previousPage: ImageEditorPage = {
			id: 'page',
			name: 'Page 1',
			background_color: '#ffffff',
			layers: [child, group]
		};
		const nextPage = structuredClone(previousPage);
		const nextGroup = nextPage.layers.find((layer) => layer.id === 'group');
		if (!nextGroup) throw new Error('Missing group fixture');
		nextGroup.visible = false;
		nextGroup.locked = true;
		const document = documentFixture(previousPage);
		const adapter = new OpenPostFabricAdapter({
			canvas: TEST_CANVAS,
			document,
			page: previousPage,
			readOnly: false,
			staticCanvas: true,
			onSelection: () => undefined,
			onTransform: () => undefined,
			onTextChange: () => undefined
		});
		const makeObject = (): LayerObjectFixture => ({
			visible: true,
			selectable: true,
			evented: true,
			set(updates: Partial<LayerObjectFixture>) {
				Object.assign(this, updates);
			},
			setCoords() {}
		});
		const childObject = makeObject();
		const groupObject = makeObject();
		const internals = adapterInternals<GroupStateAdapterInternals>(adapter);
		internals.fabric = {};
		internals.canvas = {
			backgroundColor: previousPage.background_color,
			moveObjectTo() {},
			renderAll() {}
		};
		internals.objectByLayerID = new Map([
			['child', childObject],
			['group', groupObject]
		]);
		internals.layerSnapshots = new Map(
			previousPage.layers.map((layer) => [layer.id, structuredClone(layer)])
		);
		internals.decorationsByLayerID = new Map();

		await adapter.sync(document, nextPage);

		expect(childObject).toMatchObject({
			visible: false,
			selectable: false,
			evented: false,
			lockMovementX: true,
			lockMovementY: true,
			lockRotation: true,
			lockScalingX: true,
			lockScalingY: true
		});
	});
});
