import {
	IMAGE_EDITOR_LIMITS,
	IMAGE_EDITOR_SCHEMA_VERSION,
	type ImageEditorDocument,
	type ImageEditorGradientValue,
	type ImageEditorImageAdjustments,
	type ImageEditorLayer,
	type ImageEditorPage,
	type ImageEditorPageBackground,
	type ImageEditorPreset,
	type ImageEditorTransform
} from './types';

const HEX_COLOR = /^#[0-9a-f]{6}([0-9a-f]{2})?$/i;

function imageEditorGradientIsValid(gradient?: ImageEditorGradientValue): boolean {
	return Boolean(
		gradient &&
		['linear', 'radial', 'angle', 'reflected', 'diamond'].includes(gradient.type) &&
		[gradient.start.x, gradient.start.y, gradient.end.x, gradient.end.y].every(Number.isFinite) &&
		gradient.stops.length >= 2 &&
		gradient.stops.length <= 32 &&
		gradient.stops.every(
			(stop) =>
				Number.isFinite(stop.offset) &&
				stop.offset >= 0 &&
				stop.offset <= 1 &&
				HEX_COLOR.test(stop.color)
		)
	);
}

export function imageEditorID(prefix: string): string {
	return `${prefix}_${crypto.randomUUID()}`;
}

export function defaultTransform(
	width: number,
	height: number,
	x = 0,
	y = 0
): ImageEditorTransform {
	return { x, y, width, height, rotation: 0, flip_x: false, flip_y: false };
}

export function defaultImageAdjustments(): ImageEditorImageAdjustments {
	return {
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
	};
}

export function isEmptyImageEditorPaintLayer(layer: ImageEditorLayer): boolean {
	return Boolean(
		layer.type === 'paint' &&
		layer.paint &&
		layer.paint.points.length === 0 &&
		layer.paint.spans.length === 0 &&
		!layer.paint.gradient
	);
}

export function blankImageEditorPage(name = 'Page 1'): ImageEditorPage {
	return {
		id: imageEditorID('page'),
		name,
		background_color: '#ffffff',
		background: defaultImageEditorPageBackground(),
		guides: { horizontal: [], vertical: [] },
		layers: []
	};
}

export function blankImageEditorDocument(preset: ImageEditorPreset): ImageEditorDocument {
	return {
		schema_version: IMAGE_EDITOR_SCHEMA_VERSION,
		title: 'Untitled design',
		preset_key: preset.key,
		width_px: preset.width_px,
		height_px: preset.height_px,
		brand_kit_revision: 0,
		export_defaults: { format: preset.default_format, quality: 0.92, matte_color: '#ffffff' },
		pages: [blankImageEditorPage()]
	};
}

export function cloneImageEditorDocument(document: ImageEditorDocument): ImageEditorDocument {
	const clone = structuredClone(document);
	clone.export_defaults = {
		...clone.export_defaults,
		matte_color: clone.export_defaults.matte_color || '#ffffff'
	};
	for (const page of clone.pages) {
		page.background = imageEditorPageBackground(page);
		page.guides = {
			horizontal: [...(page.guides?.horizontal ?? [])],
			vertical: [...(page.guides?.vertical ?? [])]
		};
		for (const layer of page.layers) {
			if (layer.text) {
				layer.text.underline = Boolean(layer.text.underline);
				layer.text.strike = Boolean(layer.text.strike);
				layer.text.wrap = layer.text.wrap === 'character' ? 'character' : 'word';
			}
			if (!layer.image) continue;
			layer.image.adjustments = {
				...defaultImageAdjustments(),
				...layer.image.adjustments
			};
		}
	}
	return clone;
}

export function defaultImageEditorPageBackground(color = '#ffffff'): ImageEditorPageBackground {
	return { type: 'solid', color, opacity: 1 };
}

export function defaultImageEditorPageGradient(
	width: number,
	height: number
): ImageEditorGradientValue {
	return {
		type: 'linear',
		start: { x: 0, y: height / 2 },
		end: { x: width, y: height / 2 },
		stops: [
			{ offset: 0, color: '#f97316' },
			{ offset: 1, color: '#7c3aed' }
		],
		reverse: false
	};
}

export function imageEditorPageBackground(
	page: Pick<ImageEditorPage, 'background' | 'background_color'>
): ImageEditorPageBackground {
	if (!page.background) return defaultImageEditorPageBackground(page.background_color || '#ffffff');
	const background = structuredClone(page.background);
	if (background.type === 'transparent') {
		return { type: 'transparent', opacity: 0 };
	}
	if (background.type === 'solid') {
		return {
			type: 'solid',
			color: background.color || page.background_color || '#ffffff',
			opacity: clamp(background.opacity, 0, 1)
		};
	}
	if (background.type === 'gradient') {
		return {
			type: 'gradient',
			opacity: clamp(background.opacity, 0, 1),
			gradient: background.gradient
		};
	}
	return {
		type: 'image',
		opacity: clamp(background.opacity, 0, 1),
		image: background.image
	};
}

export function imageEditorPageHasTransparency(page: ImageEditorPage): boolean {
	const background = imageEditorPageBackground(page);
	if (background.type === 'transparent' || background.opacity < 1) return true;
	if (background.type === 'image') return true;
	if (background.type === 'solid') return colorHasTransparency(background.color);
	return Boolean(background.gradient?.stops.some((stop) => colorHasTransparency(stop.color)));
}

function colorHasTransparency(color?: string): boolean {
	const hex = color?.trim().replace('#', '') ?? '';
	return hex.length === 8 && Number.parseInt(hex.slice(6, 8), 16) < 255;
}

function clamp(value: number, minimum: number, maximum: number): number {
	return Number.isFinite(value) ? Math.max(minimum, Math.min(maximum, value)) : minimum;
}

export function cloneImageEditorPage(page: ImageEditorPage, name: string): ImageEditorPage {
	const idMap = new Map<string, string>();
	const layers = page.layers.map((layer) => {
		const nextID = imageEditorID('layer');
		idMap.set(layer.id, nextID);
		return { ...structuredClone(layer), id: nextID };
	});
	for (const layer of layers) {
		if (layer.parent_id) layer.parent_id = idMap.get(layer.parent_id);
	}
	return {
		...structuredClone(page),
		id: imageEditorID('page'),
		name,
		preview_media_id: undefined,
		latest_export_media_id: undefined,
		layers
	};
}

export function cloneImageEditorLayer(
	layer: ImageEditorLayer,
	name = `${layer.name} copy`
): ImageEditorLayer {
	return {
		...structuredClone(layer),
		id: imageEditorID('layer'),
		parent_id: undefined,
		name,
		transform: {
			...layer.transform,
			x: layer.transform.x + 24,
			y: layer.transform.y + 24
		}
	};
}

export function validateImageEditorDocument(document: ImageEditorDocument): string[] {
	const errors: string[] = [];
	if (document.schema_version !== IMAGE_EDITOR_SCHEMA_VERSION) {
		errors.push('This OpenPost Image Editor document version is not supported.');
	}
	if (!document.title.trim() || document.title.length > 160) {
		errors.push('The design title must be between 1 and 160 characters.');
	}
	if (
		!['png', 'jpeg', 'webp'].includes(document.export_defaults.format) ||
		!Number.isFinite(document.export_defaults.quality) ||
		document.export_defaults.quality < 0.1 ||
		document.export_defaults.quality > 1 ||
		!HEX_COLOR.test(document.export_defaults.matte_color)
	) {
		errors.push('The export settings are invalid.');
	}
	if (
		document.width_px < IMAGE_EDITOR_LIMITS.minDimension ||
		document.height_px < IMAGE_EDITOR_LIMITS.minDimension ||
		document.width_px > IMAGE_EDITOR_LIMITS.maxDimension ||
		document.height_px > IMAGE_EDITOR_LIMITS.maxDimension ||
		document.width_px * document.height_px > IMAGE_EDITOR_LIMITS.maxPixels
	) {
		errors.push('The design dimensions are outside the supported range.');
	}
	if (document.pages.length === 0 || document.pages.length > IMAGE_EDITOR_LIMITS.maxPages) {
		errors.push(`A design must have between 1 and ${IMAGE_EDITOR_LIMITS.maxPages} pages.`);
	}
	const pageIDs = new Set<string>();
	const layerIDs = new Set<string>();
	for (const page of document.pages) {
		if (!page.id || pageIDs.has(page.id)) errors.push('Every page must have a unique ID.');
		pageIDs.add(page.id);
		if (!HEX_COLOR.test(page.background_color))
			errors.push(`${page.name} has an invalid background.`);
		if (
			(page.guides?.horizontal.length ?? 0) > 100 ||
			(page.guides?.vertical.length ?? 0) > 100 ||
			(page.guides?.horizontal ?? []).some(
				(value) => !Number.isFinite(value) || value < 0 || value > document.height_px
			) ||
			(page.guides?.vertical ?? []).some(
				(value) => !Number.isFinite(value) || value < 0 || value > document.width_px
			)
		) {
			errors.push(`${page.name} has invalid guides.`);
		}
		const background = imageEditorPageBackground(page);
		if (
			!Number.isFinite(background.opacity) ||
			background.opacity < 0 ||
			background.opacity > 1 ||
			(background.type === 'solid' && !HEX_COLOR.test(background.color ?? '')) ||
			(background.type === 'gradient' && !imageEditorGradientIsValid(background.gradient)) ||
			(background.type === 'image' &&
				(!background.image?.media_id ||
					!['cover', 'contain', 'stretch'].includes(background.image.fit)))
		) {
			errors.push(`${page.name} has an invalid background.`);
		}
		if (page.layers.length > IMAGE_EDITOR_LIMITS.maxLayersPerPage) {
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
			if (layer.text?.wrap && !['word', 'character'].includes(layer.text.wrap)) {
				errors.push(`${layer.name} has an invalid text wrapping mode.`);
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
					adjustments.tint,
					adjustments.vibrance,
					adjustments.hue,
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
			if (layer.type === 'paint' && !layer.paint) errors.push(`${layer.name} has no paint data.`);
			if (
				layer.paint &&
				(!['stroke', 'fill', 'gradient'].includes(layer.paint.kind) ||
					!HEX_COLOR.test(layer.paint.color) ||
					!Number.isFinite(layer.paint.size) ||
					layer.paint.size <= 0 ||
					layer.paint.size > 512 ||
					!Number.isFinite(layer.paint.opacity) ||
					layer.paint.opacity < 0 ||
					layer.paint.opacity > 1 ||
					!Number.isFinite(layer.paint.source_width) ||
					!Number.isFinite(layer.paint.source_height) ||
					layer.paint.source_width <= 0 ||
					layer.paint.source_height <= 0 ||
					layer.paint.points.length > 100_000 ||
					layer.paint.spans.length > 250_000 ||
					layer.paint.points.some(
						(point) => !Number.isFinite(point.x) || !Number.isFinite(point.y)
					) ||
					layer.paint.spans.some(
						(span) =>
							!Number.isFinite(span.x) ||
							!Number.isFinite(span.y) ||
							!Number.isFinite(span.width) ||
							span.width <= 0
					) ||
					(layer.paint.kind === 'gradient' &&
						(!layer.paint.gradient ||
							!['linear', 'radial', 'angle', 'reflected', 'diamond'].includes(
								layer.paint.gradient.type
							) ||
							![
								layer.paint.gradient.start.x,
								layer.paint.gradient.start.y,
								layer.paint.gradient.end.x,
								layer.paint.gradient.end.y
							].every(Number.isFinite) ||
							layer.paint.gradient.stops.length < 2 ||
							layer.paint.gradient.stops.length > 32 ||
							layer.paint.gradient.stops.some(
								(stop) =>
									!Number.isFinite(stop.offset) ||
									stop.offset < 0 ||
									stop.offset > 1 ||
									!HEX_COLOR.test(stop.color)
							))))
			) {
				errors.push(`${layer.name} has invalid paint data.`);
			}
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
			if (
				layer.erase_mask &&
				(!['image', 'paint'].includes(layer.type) ||
					![layer.erase_mask.source_width, layer.erase_mask.source_height].every(Number.isFinite) ||
					layer.erase_mask.source_width <= 0 ||
					layer.erase_mask.source_height <= 0 ||
					layer.erase_mask.source_width > IMAGE_EDITOR_LIMITS.maxDimension ||
					layer.erase_mask.source_height > IMAGE_EDITOR_LIMITS.maxDimension ||
					layer.erase_mask.strokes.length > 10_000 ||
					layer.erase_mask.spans.length > 250_000 ||
					layer.erase_mask.strokes.some(
						(stroke) =>
							!Number.isFinite(stroke.size) ||
							stroke.size <= 0 ||
							stroke.size > 512 ||
							stroke.points.length > 100_000 ||
							stroke.points.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y))
					) ||
					layer.erase_mask.spans.some(
						(span) => ![span.x, span.y, span.width].every(Number.isFinite) || span.width <= 0
					))
			) {
				errors.push(`${layer.name} has an invalid erase mask.`);
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
				const stroke = layer.effects.stroke;
				if (
					stroke &&
					(!HEX_COLOR.test(stroke.color) ||
						!Number.isFinite(stroke.opacity) ||
						stroke.opacity < 0 ||
						stroke.opacity > 1 ||
						!Number.isFinite(stroke.width) ||
						stroke.width <= 0 ||
						stroke.width > 500 ||
						!['inside', 'center', 'outside'].includes(stroke.position))
				) {
					errors.push(`${layer.name} has an invalid stroke effect.`);
				}
			}
		}
		for (const layer of page.layers) {
			const visited = new Set<string>();
			let current: ImageEditorLayer | undefined = layer;
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
		new TextEncoder().encode(JSON.stringify(document)).byteLength >
		IMAGE_EDITOR_LIMITS.maxDocumentBytes
	) {
		errors.push('The design is larger than the 10 MiB document limit.');
	}
	return [...new Set(errors)];
}

export function migrateImageEditorDocument(raw: unknown): {
	document?: ImageEditorDocument;
	readOnly: boolean;
	error?: string;
} {
	if (!raw || typeof raw !== 'object') {
		return { readOnly: true, error: 'The OpenPost Image Editor document is missing.' };
	}
	const version = Number((raw as { schema_version?: unknown }).schema_version);
	if (version > IMAGE_EDITOR_SCHEMA_VERSION) {
		const document = structuredClone(raw) as ImageEditorDocument;
		if (
			!Array.isArray(document.pages) ||
			!Number.isFinite(document.width_px) ||
			!Number.isFinite(document.height_px)
		) {
			return {
				readOnly: true,
				error: 'The newer OpenPost Image Editor document cannot be displayed safely.'
			};
		}
		return {
			document,
			readOnly: true,
			error: 'This design was created by a newer OpenPost version and is read-only here.'
		};
	}
	if (version !== IMAGE_EDITOR_SCHEMA_VERSION) {
		return {
			readOnly: true,
			error: 'This OpenPost Image Editor document version cannot be migrated.'
		};
	}
	const document = cloneImageEditorDocument(raw as ImageEditorDocument);
	const errors = validateImageEditorDocument(document);
	return errors.length > 0 ? { readOnly: true, error: errors[0] } : { document, readOnly: false };
}
