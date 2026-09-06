export interface SpatialPointEffectConfig {
	xParam: 'centerX' | 'originX';
	yParam: 'centerY' | 'originY';
}

const CENTER_CONFIG: SpatialPointEffectConfig = {
	xParam: 'centerX',
	yParam: 'centerY'
};

const SPATIAL_POINT_EFFECT_ENTRIES = [
	['gpu-twirl', CENTER_CONFIG],
	['gpu-bulge', CENTER_CONFIG],
	['gpu-trigger-wave', CENTER_CONFIG],
	['gpu-radial-blur', CENTER_CONFIG],
	['gpu-zoom-blur', CENTER_CONFIG],
	['gpu-ripple-glass', { xParam: 'originX', yParam: 'originY' }],
	['gpu-droste', CENTER_CONFIG]
] as const satisfies readonly (readonly [string, SpatialPointEffectConfig])[];

const SPATIAL_POINT_EFFECTS = new Map<string, SpatialPointEffectConfig>(
	SPATIAL_POINT_EFFECT_ENTRIES
);

export function getSpatialPointEffectConfig(gpuEffectId: string): SpatialPointEffectConfig | null {
	return SPATIAL_POINT_EFFECTS.get(gpuEffectId) ?? null;
}

export const SPATIAL_POINT_EFFECT_IDS = Object.freeze([...SPATIAL_POINT_EFFECTS.keys()]);
