import type {
	ImageEditorColorTarget,
	ImageEditorDocument,
	ImageEditorGradientType,
	ImageEditorLayer,
	ImageEditorPage,
	ImageEditorSelectionMode
} from './types';
import { migrateImageEditorDocument } from './document';
import type { ImageEditorExportResumeEntry, ImageEditorExportResumeLedger } from './export-resume';

export interface ImageEditorToolPreferences {
	selectionMode?: ImageEditorSelectionMode;
	magicSelectTolerance?: number;
	magicSelectContiguous?: boolean;
	sampleAllLayers?: boolean;
	eyedropperTarget?: ImageEditorColorTarget;
	pencilSize?: number;
	pencilRoughness?: number;
	pencilSmoothing?: number;
	pencilPressure?: boolean;
	eraserSize?: number;
	magicEraserTolerance?: number;
	magicEraserContiguous?: boolean;
	bucketTolerance?: number;
	bucketContiguous?: boolean;
	paintOpacity?: number;
	gradientType?: ImageEditorGradientType;
	gradientReverse?: boolean;
}

export interface ImageEditorLayoutPreferences {
	assets?: number;
	inspector?: number;
	layers?: number;
	pages?: number;
}

export interface ImageEditorViewPreferences {
	snapping?: boolean;
	rulers?: boolean;
	guides?: boolean;
	grid?: boolean;
	snapToGrid?: boolean;
	gridSize?: 10 | 25 | 50 | 100 | 200;
}

export interface ImageEditorTabMessage {
	tabID?: string;
	type?: 'editing' | 'saved';
	revision?: number;
}

type ShellStorageValue =
	| string
	| number
	| boolean
	| null
	| ShellStorageValue[]
	| { [key: string]: ShellStorageValue };

function valueEntries(value: ShellStorageValue | undefined): Map<string, ShellStorageValue> {
	if (value === null || Array.isArray(value) || !(value instanceof Object)) return new Map();
	return new Map(Object.entries(value));
}

function parseEntries(source: string): Map<string, ShellStorageValue> {
	const value: ShellStorageValue = JSON.parse(source);
	return valueEntries(value);
}

function finiteNumber(value: ShellStorageValue | undefined): number | undefined {
	return Number.isFinite(value) ? Number(value) : undefined;
}

function booleanValue(value: ShellStorageValue | undefined): boolean | undefined {
	if (value === true) return true;
	if (value === false) return false;
	return undefined;
}

function stringValue(value: ShellStorageValue | undefined): string | undefined {
	return String(value) === value ? String(value) : undefined;
}

function selectionMode(value: ShellStorageValue | undefined): ImageEditorSelectionMode | undefined {
	switch (stringValue(value)) {
		case 'replace':
			return 'replace';
		case 'add':
			return 'add';
		case 'subtract':
			return 'subtract';
		case 'intersect':
			return 'intersect';
		case 'toggle':
			return 'toggle';
		default:
			return undefined;
	}
}

function eyedropperTarget(
	value: ShellStorageValue | undefined
): ImageEditorColorTarget | undefined {
	switch (stringValue(value)) {
		case 'foreground':
			return 'foreground';
		case 'selected_fill':
			return 'selected_fill';
		case 'selected_stroke':
			return 'selected_stroke';
		case 'page_background':
			return 'page_background';
		default:
			return undefined;
	}
}

function gradientType(value: ShellStorageValue | undefined): ImageEditorGradientType | undefined {
	switch (stringValue(value)) {
		case 'linear':
			return 'linear';
		case 'radial':
			return 'radial';
		case 'angle':
			return 'angle';
		case 'reflected':
			return 'reflected';
		case 'diamond':
			return 'diamond';
		default:
			return undefined;
	}
}

function gridSize(value: ShellStorageValue | undefined): ImageEditorViewPreferences['gridSize'] {
	switch (finiteNumber(value)) {
		case 10:
			return 10;
		case 25:
			return 25;
		case 50:
			return 50;
		case 100:
			return 100;
		case 200:
			return 200;
		default:
			return undefined;
	}
}

export function parseImageEditorToolPreferences(source: string): ImageEditorToolPreferences {
	const values = parseEntries(source);
	return {
		selectionMode: selectionMode(values.get('selectionMode')),
		magicSelectTolerance: finiteNumber(values.get('magicSelectTolerance')),
		magicSelectContiguous: booleanValue(values.get('magicSelectContiguous')),
		sampleAllLayers: booleanValue(values.get('sampleAllLayers')),
		eyedropperTarget: eyedropperTarget(values.get('eyedropperTarget')),
		pencilSize: finiteNumber(values.get('pencilSize')),
		pencilRoughness: finiteNumber(values.get('pencilRoughness')),
		pencilSmoothing: finiteNumber(values.get('pencilSmoothing')),
		pencilPressure: booleanValue(values.get('pencilPressure')),
		eraserSize: finiteNumber(values.get('eraserSize')),
		magicEraserTolerance: finiteNumber(values.get('magicEraserTolerance')),
		magicEraserContiguous: booleanValue(values.get('magicEraserContiguous')),
		bucketTolerance: finiteNumber(values.get('bucketTolerance')),
		bucketContiguous: booleanValue(values.get('bucketContiguous')),
		paintOpacity: finiteNumber(values.get('paintOpacity')),
		gradientType: gradientType(values.get('gradientType')),
		gradientReverse: booleanValue(values.get('gradientReverse'))
	};
}

export function parseImageEditorLayoutPreferences(source: string): ImageEditorLayoutPreferences {
	const values = parseEntries(source);
	return {
		assets: finiteNumber(values.get('assets')),
		inspector: finiteNumber(values.get('inspector')),
		layers: finiteNumber(values.get('layers')),
		pages: finiteNumber(values.get('pages'))
	};
}

export function parseImageEditorViewPreferences(source: string): ImageEditorViewPreferences {
	const values = parseEntries(source);
	return {
		snapping: booleanValue(values.get('snapping')),
		rulers: booleanValue(values.get('rulers')),
		guides: booleanValue(values.get('guides')),
		grid: booleanValue(values.get('grid')),
		snapToGrid: booleanValue(values.get('snapToGrid')),
		gridSize: gridSize(values.get('gridSize'))
	};
}

export function parseImageEditorRecentColors(source: string): string[] {
	const value: ShellStorageValue = JSON.parse(source);
	if (!Array.isArray(value)) return [];
	const colors: string[] = [];
	for (const color of value) {
		const parsed = stringValue(color);
		if (parsed !== undefined) colors.push(parsed);
	}
	return colors;
}

export function parseImageEditorExportResumeLedger(source: string): ImageEditorExportResumeLedger {
	const entries: Array<[string, ImageEditorExportResumeEntry]> = [];
	for (const [pageID, value] of parseEntries(source)) {
		const fields = valueEntries(value);
		const mediaID = stringValue(fields.get('mediaID'));
		const fingerprint = stringValue(fields.get('fingerprint'));
		if (pageID && mediaID && fingerprint) entries.push([pageID, { mediaID, fingerprint }]);
	}
	return Object.fromEntries(entries);
}

export function parseImageEditorTabMessage(value: ShellStorageValue): ImageEditorTabMessage {
	const fields = valueEntries(value);
	const typeValue = stringValue(fields.get('type'));
	return {
		tabID: stringValue(fields.get('tabID')),
		type: typeValue === 'editing' || typeValue === 'saved' ? typeValue : undefined,
		revision: finiteNumber(fields.get('revision'))
	};
}

export function parseImageEditorClipboardLayers(
	source: string,
	document: ImageEditorDocument,
	page: ImageEditorPage
): ImageEditorLayer[] {
	const fields = parseEntries(source);
	const layers = fields.get('layers');
	if (fields.get('version') !== 1 || !Array.isArray(layers)) return [];
	const normalizedLayers = layers.map((layer, index) => {
		const layerFields = valueEntries(layer);
		layerFields.set('id', `clipboard-${index}`);
		layerFields.delete('parent_id');
		return Object.fromEntries(layerFields);
	});
	const candidate = {
		...structuredClone(document),
		pages: [{ ...structuredClone(page), layers: normalizedLayers }]
	};
	const migrated = migrateImageEditorDocument(candidate);
	return migrated.document?.pages[0]?.layers ?? [];
}
