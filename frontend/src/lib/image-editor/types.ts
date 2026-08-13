import type { StockMediaProvenance } from '@openpost/video-project';

export const IMAGE_EDITOR_SCHEMA_VERSION = 1 as const;
export const IMAGE_EDITOR_LIMITS = {
	minDimension: 64,
	maxDimension: 4096,
	maxPixels: 25_000_000,
	maxPages: 35,
	maxLayersPerPage: 500,
	maxDocumentBytes: 10 * 1024 * 1024
} as const;

export type ImageEditorLayerType = 'text' | 'image' | 'shape' | 'paint' | 'group';
export type ImageEditorSelectionTool =
	'select' | 'marquee' | 'ellipse_marquee' | 'lasso' | 'magic_wand';
export type ImageEditorSelectionMode = 'replace' | 'add' | 'subtract' | 'intersect' | 'toggle';
export type ImageEditorGradientType = 'linear' | 'radial' | 'angle' | 'reflected' | 'diamond';
export type ImageEditorTool =
	| ImageEditorSelectionTool
	| 'crop'
	| 'text'
	| 'shape'
	| 'image'
	| 'camera'
	| 'eyedropper'
	| 'pencil'
	| 'eraser'
	| 'magic_eraser'
	| 'bucket'
	| 'gradient'
	| 'hand'
	| 'zoom';
export type ImageEditorSaveState =
	'idle' | 'saving' | 'saved' | 'local' | 'conflict' | 'offline' | 'error';
export type ImageEditorColorTarget =
	'foreground' | 'selected_fill' | 'selected_stroke' | 'page_background';

export interface ImageEditorTransform {
	x: number;
	y: number;
	width: number;
	height: number;
	rotation: number;
	flip_x: boolean;
	flip_y: boolean;
}

export interface ImageEditorTextShadow {
	color: string;
	blur: number;
	offset_x: number;
	offset_y: number;
}

export type ImageEditorTextCurveType =
	'none' | 'arc_up' | 'arc_down' | 'wave' | 'circle' | 'ellipse';

export interface ImageEditorTextCurve {
	type: ImageEditorTextCurveType;
	strength: number;
	offset: number;
	reverse: boolean;
}

export interface ImageEditorTextValue {
	text: string;
	font_family: string;
	font_asset_id?: string;
	font_weight: number;
	font_style: 'normal' | 'italic';
	underline?: boolean;
	strike?: boolean;
	wrap?: 'word' | 'character';
	font_size: number;
	color: string;
	align: 'left' | 'center' | 'right';
	line_height: number;
	letter_spacing: number;
	highlight_color?: string;
	stroke_color?: string;
	stroke_width: number;
	shadow: ImageEditorTextShadow;
	curve?: ImageEditorTextCurve;
}

export interface ImageEditorImageAdjustments {
	brightness: number;
	contrast: number;
	saturation: number;
	temperature: number;
	tint: number;
	vibrance: number;
	hue: number;
	exposure: number;
	highlights: number;
	shadows: number;
	blur: number;
}

export interface ImageEditorCrop {
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface ImageEditorImageValue {
	media_id: string;
	source_width: number;
	source_height: number;
	intrinsic_pending?: boolean;
	fit: 'cover' | 'contain' | 'stretch';
	crop: ImageEditorCrop;
	adjustments: ImageEditorImageAdjustments;
}

export interface ImageEditorShapeValue {
	kind: 'rectangle' | 'rounded_rectangle' | 'ellipse' | 'line';
	fill: string;
	stroke: string;
	stroke_width: number;
	radius: number;
}

export interface ImageEditorPaintPoint {
	x: number;
	y: number;
}

export interface ImageEditorPaintSpan {
	y: number;
	x: number;
	width: number;
}

export interface ImageEditorEraseStroke {
	size: number;
	points: ImageEditorPaintPoint[];
}

export interface ImageEditorEraseMask {
	source_width: number;
	source_height: number;
	strokes: ImageEditorEraseStroke[];
	spans: ImageEditorPaintSpan[];
}

export interface ImageEditorGradientStop {
	offset: number;
	color: string;
}

export interface ImageEditorGradientValue {
	type: ImageEditorGradientType;
	start: ImageEditorPaintPoint;
	end: ImageEditorPaintPoint;
	stops: ImageEditorGradientStop[];
	reverse: boolean;
}

export interface ImageEditorPageBackgroundImage {
	media_id: string;
	fit: 'cover' | 'contain' | 'stretch';
}

export interface ImageEditorPageBackground {
	type: 'transparent' | 'solid' | 'gradient' | 'image';
	color?: string;
	opacity: number;
	gradient?: ImageEditorGradientValue;
	image?: ImageEditorPageBackgroundImage;
}

export interface ImageEditorPaintValue {
	kind: 'stroke' | 'fill' | 'gradient';
	color: string;
	size: number;
	opacity: number;
	source_width: number;
	source_height: number;
	points: ImageEditorPaintPoint[];
	spans: ImageEditorPaintSpan[];
	gradient?: ImageEditorGradientValue;
}

export type ImageEditorBlendMode =
	'normal' | 'multiply' | 'screen' | 'overlay' | 'darken' | 'lighten' | 'soft_light';

export interface ImageEditorShadowEffect {
	color: string;
	opacity: number;
	blur: number;
	angle: number;
	distance: number;
}

export interface ImageEditorLayerStrokeEffect {
	color: string;
	opacity: number;
	width: number;
	position: 'inside' | 'center' | 'outside';
}

export interface ImageEditorLayerEffects {
	blend_mode: ImageEditorBlendMode;
	drop_shadow?: ImageEditorShadowEffect;
	inner_shadow?: ImageEditorShadowEffect;
	stroke?: ImageEditorLayerStrokeEffect;
}

export interface ImageEditorLayerMask {
	shape: 'rectangle' | 'rounded_rectangle' | 'circle' | 'ellipse' | 'diamond';
	inset: number;
	radius: number;
}

export interface ImageEditorLayer {
	id: string;
	type: ImageEditorLayerType;
	name: string;
	parent_id?: string;
	visible: boolean;
	locked: boolean;
	opacity: number;
	transform: ImageEditorTransform;
	text?: ImageEditorTextValue;
	image?: ImageEditorImageValue;
	shape?: ImageEditorShapeValue;
	paint?: ImageEditorPaintValue;
	effects?: ImageEditorLayerEffects;
	mask?: ImageEditorLayerMask;
	erase_mask?: ImageEditorEraseMask;
}

export interface ImageEditorPage {
	id: string;
	name: string;
	background_color: string;
	background?: ImageEditorPageBackground;
	guides?: {
		horizontal: number[];
		vertical: number[];
	};
	layers: ImageEditorLayer[];
	preview_media_id?: string;
	latest_export_media_id?: string;
}

export interface ImageEditorDocument {
	schema_version: typeof IMAGE_EDITOR_SCHEMA_VERSION;
	title: string;
	preset_key: string;
	width_px: number;
	height_px: number;
	brand_kit_id?: string;
	brand_kit_revision: number;
	export_defaults: {
		format: 'png' | 'jpeg' | 'webp';
		quality: number;
		matte_color: string;
	};
	pages: ImageEditorPage[];
}

export interface ImageEditorDocumentResponse {
	id: string;
	workspace_id: string;
	created_by_id: string;
	revision: number;
	can_edit: boolean;
	cover_preview_media_id?: string;
	created_at: string;
	updated_at: string;
	document: ImageEditorDocument;
	missing_local_media_ids?: string[];
}

export interface ImageEditorPreset {
	key: string;
	name: string;
	width_px: number;
	height_px: number;
	default_format: 'png' | 'jpeg' | 'webp';
	profiles: string[];
}

export interface ImageEditorDesignSummary {
	id: string;
	title: string;
	preset_key: string;
	width_px: number;
	height_px: number;
	page_count: number;
	revision: number;
	cover_preview_media_id?: string;
	is_favorite: boolean;
	created_at: string;
	updated_at: string;
}

export interface ImageEditorRevisionSummary {
	id: string;
	revision: number;
	kind: 'autosave' | 'checkpoint' | 'restore_point' | string;
	name?: string;
	created_at: string;
	expires_at?: string;
	actor: {
		name: string;
		is_current_user: boolean;
	};
}

export interface ImageEditorRevisionResponse {
	summary: ImageEditorRevisionSummary;
	cover_preview_media_id?: string;
	document: ImageEditorDocument;
}

export interface ImageEditorTemplate {
	id: string;
	workspace_id?: string;
	built_in: boolean;
	name: string;
	category: string;
	preset_key: string;
	preview_media_id?: string;
	document: ImageEditorDocument;
	created_at?: string;
	updated_at?: string;
}

export interface ImageEditorBrandColor {
	id: string;
	name: string;
	value: string;
}

export interface ImageEditorBrandTextStyle {
	id: string;
	name: string;
	font_family: string;
	font_asset_id?: string;
	font_weight: number;
	font_style: string;
	font_size: number;
	color: string;
	line_height: number;
	letter_spacing: number;
}

export interface ImageEditorBrandFont {
	id: string;
	media_id: string;
	family: string;
	css_family?: string;
	weight: number;
	style: 'normal' | 'italic';
	license_acknowledged?: boolean;
	license_acknowledged_by?: string;
	license_acknowledged_at?: string;
}

export interface ImageEditorBrandKit {
	id: string;
	workspace_id: string;
	name: string;
	revision: number;
	exists: boolean;
	can_edit: boolean;
	colors: ImageEditorBrandColor[];
	text_styles: ImageEditorBrandTextStyle[];
	backgrounds: string[];
	fonts: ImageEditorBrandFont[];
	updated_at?: string;
}

export interface ImageEditorMediaItem {
	id: string;
	workspace_id: string;
	mime_type: string;
	size: number;
	original_filename: string;
	width: number;
	height: number;
	alt_text: string;
	is_favorite: boolean;
	created_at: string;
	url: string;
	thumbnail_url: string;
	usage_count: number;
	can_delete: boolean;
	processing_status: string;
	processing_progress: number;
	analysis_status: string;
	analysis_error?: string;
	provenance?: StockMediaProvenance;
	poster_thumbnail_url?: string;
	duration_ms: number;
	frame_rate: number;
	container_format?: string;
	video_codec?: string;
	audio_codec?: string;
	source: string;
	asset_kind: string;
	parent_media_id?: string;
	design_document_id?: string;
	design_page_id?: string;
	tags: string[];
}
