/** One-click export targets that bundle container/codec/quality/resolution. */

import type { VideoCodec } from 'mediabunny';

export type ExportPresetId = 'master' | 'web' | 'social' | 'draft';

export interface ExportPresetSelection {
	format: 'mp4' | 'webm' | 'mkv' | 'mov';
	codec: VideoCodec;
	quality: 'draft' | 'standard' | 'high';
	resolution: string;
}

export interface ExportPreset extends ExportPresetSelection {
	id: ExportPresetId;
}

/**
 * Presets keep the project's aspect ratio (source resolution or a landscape
 * cap that only downsizes) so output is never distorted; they vary the
 * quality/size tradeoff, which is the part users shouldn't need codec
 * knowledge for. Social relies on the project canvas preset (vertical
 * projects stay vertical) instead of forcing dimensions here.
 */
export const EXPORT_PRESETS: readonly ExportPreset[] = [
	{ id: 'master', format: 'mp4', codec: 'avc', quality: 'high', resolution: 'source' },
	{ id: 'web', format: 'mp4', codec: 'avc', quality: 'standard', resolution: '1920x1080' },
	{ id: 'social', format: 'mp4', codec: 'avc', quality: 'standard', resolution: 'source' },
	{ id: 'draft', format: 'webm', codec: 'vp9', quality: 'draft', resolution: '854x480' }
];

/** Resolve a preset id to the four export fields it sets atomically. */
export function applyExportPreset(id: ExportPresetId): ExportPresetSelection {
	const preset = EXPORT_PRESETS.find((candidate) => candidate.id === id);
	if (!preset) throw new Error(`Unknown export preset: ${id}`);
	return {
		format: preset.format,
		codec: preset.codec,
		quality: preset.quality,
		resolution: preset.resolution
	};
}

/** Return the preset id when the current fields match one exactly, else null. */
export function matchExportPreset(selection: ExportPresetSelection): ExportPresetId | null {
	return (
		EXPORT_PRESETS.find(
			(candidate) =>
				candidate.format === selection.format &&
				candidate.codec === selection.codec &&
				candidate.quality === selection.quality &&
				candidate.resolution === selection.resolution
		)?.id ?? null
	);
}
