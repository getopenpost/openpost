import type {
	ImageEditorDocument,
	ImageEditorGradientValue,
	ImageEditorLayer,
	ImageEditorPaintPoint
} from './types';

export type ImageEditorResizeMode = 'preserve' | 'fit' | 'fill' | 'stretch';

export interface ImageEditorResizeOptions {
	width: number;
	height: number;
	mode: ImageEditorResizeMode;
}

interface ResizeGeometry {
	scaleX: number;
	scaleY: number;
	styleScale: number;
	sourceCenterX: number;
	sourceCenterY: number;
	targetCenterX: number;
	targetCenterY: number;
}

const MAX_EFFECT_BLUR = 100;
const MAX_EFFECT_DISTANCE = 500;
const MAX_EFFECT_STROKE = 500;

export function resizeImageEditorDocument(
	document: ImageEditorDocument,
	options: ImageEditorResizeOptions
): ImageEditorDocument {
	const geometry = resizeGeometry(document, options);
	return {
		...document,
		width_px: options.width,
		height_px: options.height,
		preset_key: 'custom',
		pages: document.pages.map((page) => {
			const resizedPage = {
				...page,
				layers: page.layers.map((layer) => resizeLayer(layer, geometry))
			};
			if (page.background) {
				resizedPage.background = resizeBackgroundGradient(page.background, geometry);
			}
			if (page.guides) {
				resizedPage.guides = {
					horizontal: page.guides.horizontal.map((position) =>
						clamp(resizeY(position, geometry), 0, options.height)
					),
					vertical: page.guides.vertical.map((position) =>
						clamp(resizeX(position, geometry), 0, options.width)
					)
				};
			}
			return resizedPage;
		})
	};
}

function resizeGeometry(
	document: Pick<ImageEditorDocument, 'width_px' | 'height_px'>,
	options: ImageEditorResizeOptions
): ResizeGeometry {
	const widthScale = options.width / document.width_px;
	const heightScale = options.height / document.height_px;
	let scaleX = 1;
	let scaleY = 1;

	if (options.mode === 'fit') {
		scaleX = scaleY = Math.min(widthScale, heightScale);
	} else if (options.mode === 'fill') {
		scaleX = scaleY = Math.max(widthScale, heightScale);
	} else if (options.mode === 'stretch') {
		scaleX = widthScale;
		scaleY = heightScale;
	}

	return {
		scaleX,
		scaleY,
		styleScale: Math.min(scaleX, scaleY),
		sourceCenterX: document.width_px / 2,
		sourceCenterY: document.height_px / 2,
		targetCenterX: options.width / 2,
		targetCenterY: options.height / 2
	};
}

function resizeLayer(layer: ImageEditorLayer, geometry: ResizeGeometry): ImageEditorLayer {
	const styleScale = geometry.styleScale;
	const resized: ImageEditorLayer = {
		...layer,
		transform: {
			...layer.transform,
			x: resizeX(layer.transform.x, geometry),
			y: resizeY(layer.transform.y, geometry),
			width: layer.transform.width * geometry.scaleX,
			height: layer.transform.height * geometry.scaleY
		}
	};
	if (layer.text) {
		resized.text = {
			...layer.text,
			font_size: layer.text.font_size * styleScale,
			stroke_width: layer.text.stroke_width * styleScale,
			shadow: {
				...layer.text.shadow,
				blur: layer.text.shadow.blur * styleScale,
				offset_x: layer.text.shadow.offset_x * styleScale,
				offset_y: layer.text.shadow.offset_y * styleScale
			}
		};
	}
	if (layer.shape) {
		resized.shape = {
			...layer.shape,
			stroke_width: layer.shape.stroke_width * styleScale,
			radius: layer.shape.radius * styleScale
		};
	}
	if (layer.effects) {
		const effects = { ...layer.effects };
		if (layer.effects.drop_shadow) {
			effects.drop_shadow = resizeEffectShadow(layer.effects.drop_shadow, styleScale);
		}
		if (layer.effects.inner_shadow) {
			effects.inner_shadow = resizeEffectShadow(layer.effects.inner_shadow, styleScale);
		}
		if (layer.effects.stroke) {
			effects.stroke = {
				...layer.effects.stroke,
				width: Math.min(MAX_EFFECT_STROKE, layer.effects.stroke.width * styleScale)
			};
		}
		resized.effects = effects;
	}
	if (layer.mask) {
		resized.mask = {
			...layer.mask,
			inset: layer.mask.inset * styleScale,
			radius: layer.mask.radius * styleScale
		};
	}
	return resized;
}

function resizeEffectShadow<T extends { blur: number; distance: number }>(
	shadow: T,
	scale: number
): T {
	return {
		...shadow,
		blur: Math.min(MAX_EFFECT_BLUR, shadow.blur * scale),
		distance: Math.min(MAX_EFFECT_DISTANCE, shadow.distance * scale)
	};
}

function resizeBackgroundGradient(
	background: NonNullable<ImageEditorDocument['pages'][number]['background']>,
	geometry: ResizeGeometry
): NonNullable<ImageEditorDocument['pages'][number]['background']> {
	if (background?.type !== 'gradient' || !background.gradient) return background;
	return {
		...background,
		gradient: resizeGradient(background.gradient, geometry)
	};
}

function resizeGradient(
	gradient: ImageEditorGradientValue,
	geometry: ResizeGeometry
): ImageEditorGradientValue {
	return {
		...gradient,
		start: resizePoint(gradient.start, geometry),
		end: resizePoint(gradient.end, geometry)
	};
}

function resizePoint(
	point: ImageEditorPaintPoint,
	geometry: ResizeGeometry
): ImageEditorPaintPoint {
	return {
		x: resizeX(point.x, geometry),
		y: resizeY(point.y, geometry)
	};
}

function resizeX(value: number, geometry: ResizeGeometry): number {
	return geometry.targetCenterX + (value - geometry.sourceCenterX) * geometry.scaleX;
}

function resizeY(value: number, geometry: ResizeGeometry): number {
	return geometry.targetCenterY + (value - geometry.sourceCenterY) * geometry.scaleY;
}

function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}
