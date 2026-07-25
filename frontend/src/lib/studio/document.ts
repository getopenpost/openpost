import {
	STUDIO_LIMITS,
	STUDIO_SCHEMA_VERSION,
	type StudioDocument,
	type StudioImageAdjustments,
	type StudioLayer,
	type StudioPage,
	type StudioPreset,
	type StudioTransform
} from './types';

const HEX_COLOR = /^#[0-9a-f]{6}([0-9a-f]{2})?$/i;

export function studioID(prefix: string): string {
	return `${prefix}_${crypto.randomUUID()}`;
}

export function defaultTransform(width: number, height: number, x = 0, y = 0): StudioTransform {
	return { x, y, width, height, rotation: 0, flip_x: false, flip_y: false };
}

export function defaultImageAdjustments(): StudioImageAdjustments {
	return {
		brightness: 0,
		contrast: 0,
		saturation: 0,
		temperature: 0,
		exposure: 0,
		highlights: 0,
		shadows: 0,
		blur: 0
	};
}

export function blankStudioPage(name = 'Page 1'): StudioPage {
	return {
		id: studioID('page'),
		name,
		background_color: '#ffffff',
		layers: []
	};
}

export function blankStudioDocument(preset: StudioPreset): StudioDocument {
	return {
		schema_version: STUDIO_SCHEMA_VERSION,
		title: 'Untitled design',
		preset_key: preset.key,
		width_px: preset.width_px,
		height_px: preset.height_px,
		brand_kit_revision: 0,
		export_defaults: { format: preset.default_format, quality: 0.92 },
		pages: [blankStudioPage()]
	};
}

export function cloneStudioDocument(document: StudioDocument): StudioDocument {
	return structuredClone(document);
}

export function cloneStudioPage(page: StudioPage, name: string): StudioPage {
	const idMap = new Map<string, string>();
	const layers = page.layers.map((layer) => {
		const nextID = studioID('layer');
		idMap.set(layer.id, nextID);
		return { ...structuredClone(layer), id: nextID };
	});
	for (const layer of layers) {
		if (layer.parent_id) layer.parent_id = idMap.get(layer.parent_id);
	}
	return {
		...structuredClone(page),
		id: studioID('page'),
		name,
		preview_media_id: undefined,
		latest_export_media_id: undefined,
		layers
	};
}

export function cloneStudioLayer(layer: StudioLayer, name = `${layer.name} copy`): StudioLayer {
	return {
		...structuredClone(layer),
		id: studioID('layer'),
		parent_id: undefined,
		name,
		transform: {
			...layer.transform,
			x: layer.transform.x + 24,
			y: layer.transform.y + 24
		}
	};
}

export function validateStudioDocument(document: StudioDocument): string[] {
	const errors: string[] = [];
	if (document.schema_version !== STUDIO_SCHEMA_VERSION) {
		errors.push('This Studio document version is not supported.');
	}
	if (!document.title.trim() || document.title.length > 160) {
		errors.push('The design title must be between 1 and 160 characters.');
	}
	if (
		document.width_px < STUDIO_LIMITS.minDimension ||
		document.height_px < STUDIO_LIMITS.minDimension ||
		document.width_px > STUDIO_LIMITS.maxDimension ||
		document.height_px > STUDIO_LIMITS.maxDimension ||
		document.width_px * document.height_px > STUDIO_LIMITS.maxPixels
	) {
		errors.push('The design dimensions are outside the supported range.');
	}
	if (document.pages.length === 0 || document.pages.length > STUDIO_LIMITS.maxPages) {
		errors.push(`A design must have between 1 and ${STUDIO_LIMITS.maxPages} pages.`);
	}
	const pageIDs = new Set<string>();
	const layerIDs = new Set<string>();
	for (const page of document.pages) {
		if (!page.id || pageIDs.has(page.id)) errors.push('Every page must have a unique ID.');
		pageIDs.add(page.id);
		if (!HEX_COLOR.test(page.background_color))
			errors.push(`${page.name} has an invalid background.`);
		if (page.layers.length > STUDIO_LIMITS.maxLayersPerPage) {
			errors.push(`${page.name} has too many layers.`);
		}
		const pageLayerIDs = new Set(page.layers.map((layer) => layer.id));
		for (const layer of page.layers) {
			if (!layer.id || layerIDs.has(layer.id)) errors.push('Every layer must have a unique ID.');
			layerIDs.add(layer.id);
			if (layer.parent_id && !pageLayerIDs.has(layer.parent_id)) {
				errors.push(`${layer.name} has a missing parent.`);
			}
			if (!Number.isFinite(layer.opacity) || layer.opacity < 0 || layer.opacity > 1) {
				errors.push(`${layer.name} has invalid opacity.`);
			}
			if (layer.type === 'text' && !layer.text) errors.push(`${layer.name} has no text data.`);
			if (
				layer.text?.curve &&
				(!['none', 'arc_up', 'arc_down', 'wave', 'circle', 'ellipse'].includes(
					layer.text.curve.type
				) ||
					!Number.isFinite(layer.text.curve.strength) ||
					layer.text.curve.strength < 0.05 ||
					layer.text.curve.strength > 1 ||
					!Number.isFinite(layer.text.curve.offset) ||
					layer.text.curve.offset < -1 ||
					layer.text.curve.offset > 1)
			) {
				errors.push(`${layer.name} has an invalid text curve.`);
			}
			if (layer.type === 'image' && !layer.image?.media_id) {
				errors.push(`${layer.name} has no media.`);
			}
			if (layer.image) {
				const { crop, adjustments } = layer.image;
				if (
					!['cover', 'contain', 'stretch'].includes(layer.image.fit) ||
					![crop.x, crop.y, crop.width, crop.height].every(Number.isFinite) ||
					crop.x < 0 ||
					crop.y < 0 ||
					crop.width <= 0 ||
					crop.height <= 0 ||
					crop.x + crop.width > 1.000001 ||
					crop.y + crop.height > 1.000001
				) {
					errors.push(`${layer.name} has an invalid crop.`);
				}
				const tonalAdjustments = [
					adjustments.brightness,
					adjustments.contrast,
					adjustments.saturation,
					adjustments.temperature,
					adjustments.exposure,
					adjustments.highlights,
					adjustments.shadows
				];
				if (
					tonalAdjustments.some((value) => !Number.isFinite(value) || value < -1 || value > 1) ||
					!Number.isFinite(adjustments.blur) ||
					adjustments.blur < 0 ||
					adjustments.blur > 1
				) {
					errors.push(`${layer.name} has invalid adjustments.`);
				}
			}
			if (layer.type === 'shape' && !layer.shape) errors.push(`${layer.name} has no shape data.`);
			if (
				layer.mask &&
				(!['rectangle', 'rounded_rectangle', 'circle', 'ellipse', 'diamond'].includes(
					layer.mask.shape
				) ||
					![layer.mask.inset, layer.mask.radius].every(Number.isFinite) ||
					layer.mask.inset < 0 ||
					layer.mask.radius < 0)
			) {
				errors.push(`${layer.name} has an invalid mask.`);
			}
			if (layer.effects) {
				if (
					!['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'soft_light'].includes(
						layer.effects.blend_mode
					)
				) {
					errors.push(`${layer.name} has an invalid blend mode.`);
				}
				for (const shadow of [layer.effects.drop_shadow, layer.effects.inner_shadow].filter(
					Boolean
				)) {
					if (
						!shadow ||
						!HEX_COLOR.test(shadow.color) ||
						![shadow.opacity, shadow.blur, shadow.angle, shadow.distance].every(Number.isFinite) ||
						shadow.opacity < 0 ||
						shadow.opacity > 1 ||
						shadow.blur < 0 ||
						shadow.blur > 100 ||
						shadow.angle < -360 ||
						shadow.angle > 360 ||
						shadow.distance < 0 ||
						shadow.distance > 500
					) {
						errors.push(`${layer.name} has an invalid shadow effect.`);
						break;
					}
				}
			}
		}
		for (const layer of page.layers) {
			const visited = new Set<string>();
			let current: StudioLayer | undefined = layer;
			while (current?.parent_id) {
				if (visited.has(current.parent_id) || current.parent_id === layer.id) {
					errors.push(`${layer.name} belongs to a cyclic group.`);
					break;
				}
				visited.add(current.parent_id);
				current = page.layers.find((candidate) => candidate.id === current?.parent_id);
			}
		}
	}
	if (
		new TextEncoder().encode(JSON.stringify(document)).byteLength > STUDIO_LIMITS.maxDocumentBytes
	) {
		errors.push('The design is larger than the 10 MiB document limit.');
	}
	return [...new Set(errors)];
}

export function migrateStudioDocument(raw: unknown): {
	document?: StudioDocument;
	readOnly: boolean;
	error?: string;
} {
	if (!raw || typeof raw !== 'object') {
		return { readOnly: true, error: 'The Studio document is missing.' };
	}
	const version = Number((raw as { schema_version?: unknown }).schema_version);
	if (version > STUDIO_SCHEMA_VERSION) {
		const document = structuredClone(raw) as StudioDocument;
		if (
			!Array.isArray(document.pages) ||
			!Number.isFinite(document.width_px) ||
			!Number.isFinite(document.height_px)
		) {
			return { readOnly: true, error: 'The newer Studio document cannot be displayed safely.' };
		}
		return {
			document,
			readOnly: true,
			error: 'This design was created by a newer OpenPost version and is read-only here.'
		};
	}
	if (version !== STUDIO_SCHEMA_VERSION) {
		return { readOnly: true, error: 'This Studio document version cannot be migrated.' };
	}
	const document = structuredClone(raw) as StudioDocument;
	const errors = validateStudioDocument(document);
	return errors.length > 0 ? { readOnly: true, error: errors[0] } : { document, readOnly: false };
}
