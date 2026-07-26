import { describe, expect, it } from 'vitest';
import {
	computeImageGeometry,
	OpenPostFabricAdapter,
	studioLayerRenderOrder
} from './fabric-adapter';
import type { StudioDocument, StudioLayer, StudioPage } from './types';

function imageLayer(
	width: number,
	height: number,
	fit: NonNullable<StudioLayer['image']>['fit'] = 'cover'
): StudioLayer {
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
				exposure: 0,
				highlights: 0,
				shadows: 0,
				blur: 0
			}
		}
	};
}

describe('Studio image geometry', () => {
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
			const imageObject = {
				...initial,
				__studioSourceWidth: 1920,
				__studioSourceHeight: 1080,
				set(updates: Record<string, unknown>) {
					Object.assign(this, updates);
				},
				setCoords() {},
				applyFilters() {}
			};
			const adapter = new OpenPostFabricAdapter({
				canvas: {} as HTMLCanvasElement,
				document: { width_px: 1080, height_px: 1080 } as StudioDocument,
				page: {
					id: 'page',
					name: 'Page 1',
					background_color: '#ffffff',
					layers: [next]
				},
				readOnly: false,
				onSelection: () => undefined,
				onTransform: () => undefined,
				onTextChange: () => undefined
			});
			const internals = adapter as unknown as {
				fabric: object;
				updateObject(target: typeof imageObject, previous: StudioLayer, next: StudioLayer): void;
			};
			internals.fabric = {};

			internals.updateObject(imageObject, previous, next);

			expect(imageObject).toMatchObject(computeImageGeometry(next, 1920, 1080));
			expect(imageObject.scaleX).toBeCloseTo(imageObject.scaleY);
		}
	);
});

describe('Studio layer render order', () => {
	function interleavedGroupLayers(): StudioLayer[] {
		const rectangle: StudioLayer = {
			...imageLayer(400, 300),
			id: 'rectangle',
			type: 'shape'
		};
		const circle: StudioLayer = { ...imageLayer(160, 160), id: 'circle', type: 'shape' };
		const text: StudioLayer = { ...imageLayer(360, 120), id: 'text', type: 'text' };
		const image: StudioLayer = { ...imageLayer(240, 320), id: 'image' };
		const group: StudioLayer = { ...imageLayer(500, 400), id: 'group', type: 'group' };
		rectangle.parent_id = group.id;
		text.parent_id = group.id;
		return [rectangle, circle, text, image, group];
	}

	it('keeps every grouped child inside the group stacking slot', () => {
		const order = studioLayerRenderOrder(interleavedGroupLayers());

		expect(order.map((layer) => layer.id)).toEqual([
			'circle',
			'image',
			'rectangle',
			'text',
			'group'
		]);
	});

	it('reapplies the grouped stacking order during incremental canvas sync', () => {
		const layers = interleavedGroupLayers();
		const page: StudioPage = {
			id: 'page',
			name: 'Page 1',
			background_color: '#ffffff',
			layers
		};
		const document = {
			width_px: 1080,
			height_px: 1080
		} as StudioDocument;
		const adapter = new OpenPostFabricAdapter({
			canvas: {} as HTMLCanvasElement,
			document,
			page,
			readOnly: false,
			onSelection: () => undefined,
			onTransform: () => undefined,
			onTextChange: () => undefined
		});
		const objects = new Map(layers.map((layer) => [layer.id, { id: layer.id }]));
		const moved: string[] = [];
		const internals = adapter as unknown as {
			canvas: { moveObjectTo(object: { id: string }, index: number): void };
			objectByLayerID: Map<string, { id: string }>;
			decorationsByLayerID: Map<string, { id: string }[]>;
			syncObjectOrder(): void;
		};
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

describe('Studio group state', () => {
	it('refreshes unchanged descendants when a group becomes hidden and locked', async () => {
		const child: StudioLayer = {
			...imageLayer(400, 300),
			id: 'child',
			type: 'shape',
			parent_id: 'group',
			image: undefined,
			shape: {
				kind: 'rectangle' as const,
				fill: '#ffffff',
				stroke: '#00000000',
				stroke_width: 0,
				radius: 0
			}
		};
		const group = {
			...imageLayer(500, 400),
			id: 'group',
			type: 'group',
			image: undefined
		} as StudioLayer;
		const previousPage: StudioPage = {
			id: 'page',
			name: 'Page 1',
			background_color: '#ffffff',
			layers: [child, group]
		};
		const nextPage = structuredClone(previousPage);
		const nextGroup = nextPage.layers.find((layer) => layer.id === 'group')!;
		nextGroup.visible = false;
		nextGroup.locked = true;
		const document = { width_px: 1080, height_px: 1080 } as StudioDocument;
		const adapter = new OpenPostFabricAdapter({
			canvas: {} as HTMLCanvasElement,
			document,
			page: previousPage,
			readOnly: false,
			staticCanvas: true,
			onSelection: () => undefined,
			onTransform: () => undefined,
			onTextChange: () => undefined
		});
		const makeObject = () => ({
			visible: true,
			selectable: true,
			evented: true,
			set(updates: Record<string, unknown>) {
				Object.assign(this, updates);
			},
			setCoords() {}
		});
		const childObject = makeObject();
		const groupObject = makeObject();
		const internals = adapter as unknown as {
			fabric: object;
			canvas: {
				backgroundColor: string;
				moveObjectTo(object: object, index: number): void;
				renderAll(): void;
			};
			objectByLayerID: Map<string, ReturnType<typeof makeObject>>;
			layerSnapshots: Map<string, StudioLayer>;
			decorationsByLayerID: Map<string, object[]>;
		};
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
