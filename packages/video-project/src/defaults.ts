import {
	VIDEO_PROJECT_SCHEMA_VERSION,
	VIDEO_TICKS_PER_SECOND,
	type CaptionStyle,
	type ClipAudioSettings,
	type ExportDefaults,
	type VideoPresentation,
	type VideoProjectDocumentV1,
	type VideoVariant
} from './types.js';

export const VIDEO_VARIANTS: readonly VideoVariant[] = [
	{
		id: 'portrait',
		name: 'Portrait',
		width: 1080,
		height: 1920,
		safe_area: { top: 180, right: 96, bottom: 320, left: 96 },
		background_color: '#0d0d0d'
	},
	{
		id: 'feed-portrait',
		name: 'Feed portrait',
		width: 1080,
		height: 1350,
		safe_area: { top: 72, right: 72, bottom: 108, left: 72 },
		background_color: '#0d0d0d'
	},
	{
		id: 'square',
		name: 'Square',
		width: 1080,
		height: 1080,
		safe_area: { top: 64, right: 64, bottom: 96, left: 64 },
		background_color: '#0d0d0d'
	},
	{
		id: 'landscape',
		name: 'Landscape',
		width: 1920,
		height: 1080,
		safe_area: { top: 64, right: 96, bottom: 96, left: 96 },
		background_color: '#0d0d0d'
	}
] as const;

export function defaultVideoPresentation(): VideoPresentation {
	return {
		position_x: 0.5,
		position_y: 0.5,
		scale: 1,
		rotation: 0,
		opacity: 1,
		crop: { x: 0, y: 0, width: 1, height: 1 },
		flip_x: false,
		flip_y: false,
		corner_radius: 0,
		border_width: 0,
		border_color: '#ffffff',
		shadow_blur: 0,
		shadow_opacity: 0,
		background_color: '#000000'
	};
}

export function defaultClipAudio(): ClipAudioSettings {
	return {
		muted: false,
		gain_db: 0,
		fade_in_us: 0,
		fade_out_us: 0,
		duck_others: false
	};
}

export function defaultCaptionStyle(): CaptionStyle {
	return {
		preset: 'clean',
		font_family: 'Geist Variable',
		font_size: 58,
		font_weight: 700,
		color: '#ffffff',
		emphasis_color: '#fb923c',
		background_color: '#000000b8',
		position: 'bottom',
		max_lines: 2
	};
}

export function defaultExportSettings(): ExportDefaults {
	return {
		variant_ids: ['portrait'],
		format: 'mp4',
		video_codec: 'avc',
		audio_codec: 'aac',
		frame_rate: { numerator: 30, denominator: 1 },
		video_bitrate: 12_000_000,
		audio_bitrate: 192_000,
		loudness_normalization: true
	};
}

export function createBlankVideoProject(
	title = 'Untitled video',
	editingMode: 'quick-cut' | 'editor' = 'editor'
): VideoProjectDocumentV1 {
	return {
		schema_version: VIDEO_PROJECT_SCHEMA_VERSION,
		editing_mode: editingMode,
		title,
		timebase: {
			ticks_per_second: VIDEO_TICKS_PER_SECOND,
			fps_numerator: 30,
			fps_denominator: 1
		},
		sources: {},
		primary_sequence: [],
		visual_tracks: [],
		audio_tracks: [],
		caption_tracks: [],
		variants: VIDEO_VARIANTS.map((variant) => ({
			...variant,
			safe_area: { ...variant.safe_area }
		})),
		markers: [],
		export_defaults: defaultExportSettings()
	};
}
