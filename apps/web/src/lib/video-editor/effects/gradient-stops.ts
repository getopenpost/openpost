/**
 * Gradient-stop list model for the gradient-map bespoke panel.
 * Ported from FreeCut (MIT) `GpuGradientMapPanel` in
 * features/effects/components/panels/gpu-gradient-map-panel.tsx:
 * custom stops persist as a comma-separated string, lists below two
 * entries fall back to black/white, and the preview bar resolves the
 * active preset (or the custom list) to ordered hex stops.
 */
import { GRADIENT_MAP_PRESETS } from './gpu/shaders/color';
import { readString, type GpuParamValues } from './gpu/types';

export const GRADIENT_FALLBACK_STOPS = ['#000000', '#ffffff'] as const;

export function parseGradientStops(value: string): string[] {
	const stops = value
		.split(',')
		.map((stop) => stop.trim())
		.filter((stop) => stop.length > 0);
	return stops.length >= 2 ? stops : [...GRADIENT_FALLBACK_STOPS];
}

/** Read the stored custom-stops string through the param boundary. */
export function customStopsList(params: GpuParamValues): string[] {
	return parseGradientStops(readString(params, 'customStops', ''));
}

export function serializeGradientStops(stops: readonly string[]): string {
	return stops.join(', ');
}

export function resolveGradientPreviewHexes(
	preset: string,
	customStops: string,
	presets: Record<string, readonly string[]> = GRADIENT_MAP_PRESETS
): string[] {
	if (preset === 'custom') return parseGradientStops(customStops);
	return [...(presets[preset] ?? presets.inferno ?? GRADIENT_FALLBACK_STOPS)];
}
