export const STUDIO_SCHEMA_VERSION = 1 as const;
export const STUDIO_LIMITS = {
	minDimension: 64,
	maxDimension: 4096,
	maxPixels: 25_000_000,
	maxPages: 35,
	maxLayersPerPage: 500,
	maxDocumentBytes: 10 * 1024 * 1024
} as const;

export type StudioLayerType = 'text' | 'image' | 'shape' | 'paint' | 'group';
export type StudioSelectionTool = 'select' | 'marquee' | 'ellipse_marquee' | 'lasso' | 'magic_wand';
export type StudioSelectionMode = 'replace' | 'add' | 'subtract' | 'intersect' | 'toggle';
export type StudioGradientType = 'linear' | 'radial' | 'angle' | 'reflected' | 'diamond';
export type StudioTool =
	| StudioSelectionTool
	| 'crop'
	| 'text'
	| 'shape'
	| 'image'
	| 'camera'
	| 'eyedropper'
	| 'pencil'
	| 'bucket'
	| 'gradient'
	| 'hand'
	| 'zoom';
export type StudioSaveState =
	'idle' | 'saving' | 'saved' | 'local' | 'conflict' | 'offline' | 'error';

export interface StudioTransform {
	x: number;
	y: number;
	width: number;
	height: number;
	rotation: number;
	flip_x: boolean;
	flip_y: boolean;
}

export interface StudioTextShadow {
	color: string;
	blur: number;
	offset_x: number;
	offset_y: number;
}

export type StudioTextCurveType = 'none' | 'arc_up' | 'arc_down' | 'wave' | 'circle' | 'ellipse';

export interface StudioTextCurve {
	type: StudioTextCurveType;
	strength: number;
	offset: number;
	reverse: boolean;
}

export interface StudioTextValue {
	text: string;
	font_family: string;
	font_asset_id?: string;
	font_weight: number;
	font_style: 'normal' | 'italic';
	font_size: number;
	color: string;
	align: 'left' | 'center' | 'right';
	line_height: number;
	letter_spacing: number;
	highlight_color?: string;
	stroke_color?: string;
	stroke_width: number;
	shadow: StudioTextShadow;
	curve?: StudioTextCurve;
}

export interface StudioImageAdjustments {
	brightness: number;
	contrast: number;
	saturation: number;
	temperature: number;
	exposure: number;
	highlights: number;
	shadows: number;
	blur: number;
}

export interface StudioCrop {
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface StudioImageValue {
	media_id: string;
	source_width: number;
	source_height: number;
	intrinsic_pending?: boolean;
	fit: 'cover' | 'contain' | 'stretch';
	crop: StudioCrop;
	adjustments: StudioImageAdjustments;
}

export interface StudioShapeValue {
	kind: 'rectangle' | 'rounded_rectangle' | 'ellipse' | 'line';
	fill: string;
	stroke: string;
	stroke_width: number;
	radius: number;
}

export interface StudioPaintPoint {
	x: number;
	y: number;
}

export interface StudioPaintSpan {
	y: number;
	x: number;
	width: number;
}

export interface StudioGradientStop {
	offset: number;
	color: string;
}

export interface StudioGradientValue {
	type: StudioGradientType;
	start: StudioPaintPoint;
	end: StudioPaintPoint;
	stops: StudioGradientStop[];
	reverse: boolean;
}

export interface StudioPaintValue {
	kind: 'stroke' | 'fill' | 'gradient';
	color: string;
	size: number;
	opacity: number;
	source_width: number;
	source_height: number;
	points: StudioPaintPoint[];
	spans: StudioPaintSpan[];
	gradient?: StudioGradientValue;
}

export type StudioBlendMode =
	'normal' | 'multiply' | 'screen' | 'overlay' | 'darken' | 'lighten' | 'soft_light';

export interface StudioShadowEffect {
	color: string;
	opacity: number;
	blur: number;
	angle: number;
	distance: number;
}

export interface StudioLayerStrokeEffect {
	color: string;
	opacity: number;
	width: number;
	position: 'inside' | 'center' | 'outside';
}

export interface StudioLayerEffects {
	blend_mode: StudioBlendMode;
	drop_shadow?: StudioShadowEffect;
	inner_shadow?: StudioShadowEffect;
	stroke?: StudioLayerStrokeEffect;
}

export interface StudioLayerMask {
	shape: 'rectangle' | 'rounded_rectangle' | 'circle' | 'ellipse' | 'diamond';
	inset: number;
	radius: number;
}

export interface StudioLayer {
	id: string;
	type: StudioLayerType;
	name: string;
	parent_id?: string;
	visible: boolean;
	locked: boolean;
	opacity: number;
	transform: StudioTransform;
	text?: StudioTextValue;
	image?: StudioImageValue;
	shape?: StudioShapeValue;
	paint?: StudioPaintValue;
	effects?: StudioLayerEffects;
	mask?: StudioLayerMask;
}

export interface StudioPage {
	id: string;
	name: string;
	background_color: string;
	layers: StudioLayer[];
	preview_media_id?: string;
	latest_export_media_id?: string;
}

export interface StudioDocument {
	schema_version: typeof STUDIO_SCHEMA_VERSION;
	title: string;
	preset_key: string;
	width_px: number;
	height_px: number;
	brand_kit_id?: string;
	brand_kit_revision: number;
	export_defaults: {
		format: 'png' | 'jpeg' | 'webp';
		quality: number;
	};
	pages: StudioPage[];
}

export interface StudioDocumentResponse {
	id: string;
	workspace_id: string;
	created_by_id: string;
	revision: number;
	can_edit: boolean;
	cover_preview_media_id?: string;
	created_at: string;
	updated_at: string;
	document: StudioDocument;
}

export interface StudioPreset {
	key: string;
	name: string;
	width_px: number;
	height_px: number;
	default_format: 'png' | 'jpeg' | 'webp';
	profiles: string[];
}

export interface StudioDesignSummary {
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

export interface StudioRevisionSummary {
	id: string;
	revision: number;
	kind: 'autosave' | 'checkpoint' | string;
	name?: string;
	created_at: string;
	expires_at?: string;
}

export interface StudioTemplate {
	id: string;
	workspace_id?: string;
	built_in: boolean;
	name: string;
	category: string;
	preset_key: string;
	preview_media_id?: string;
	document: StudioDocument;
	created_at?: string;
	updated_at?: string;
}

export interface StudioBrandColor {
	id: string;
	name: string;
	value: string;
}

export interface StudioBrandTextStyle {
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

export interface StudioBrandAsset {
	id: string;
	media_id: string;
	role: 'primary_logo' | 'secondary_logo' | 'mark' | 'watermark';
	name: string;
}

export interface StudioBrandFont {
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

export interface StudioBrandKit {
	id: string;
	workspace_id: string;
	name: string;
	revision: number;
	exists: boolean;
	can_edit: boolean;
	colors: StudioBrandColor[];
	text_styles: StudioBrandTextStyle[];
	backgrounds: string[];
	assets: StudioBrandAsset[];
	fonts: StudioBrandFont[];
	updated_at?: string;
}

export interface StudioMediaItem {
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
	source: string;
	asset_kind: string;
	parent_media_id?: string;
	design_document_id?: string;
	design_page_id?: string;
	collections: string[];
	tags: string[];
}

export interface ComposerRecoverySnapshot {
	version: 1;
	workspace_id: string;
	return_url: string;
	purpose: string;
	created_at: string;
	expires_at: string;
	payload: unknown;
}
