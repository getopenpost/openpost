import type { ProceduralBackground } from './types';
import { cloneBackground } from './types';

export interface BackgroundPreset {
	id: string;
	label: string;
	background: ProceduralBackground;
}

/**
 * Compact preset catalog — 8 entries (4 mesh, 4 pattern).
 * Immutable entries; callers must clone before assigning to a timeline item.
 */
export const BACKGROUND_PRESETS: readonly BackgroundPreset[] = [
	{
		id: 'mesh-sunset',
		label: 'Sunset mesh',
		background: {
			kind: 'mesh-gradient',
			colors: ['#ff7a18', '#af002d', '#319197', '#1a1a2e'],
			smoothness: 0.55,
			rotation: 0,
			scale: 1,
			offsetX: 0,
			offsetY: 0
		}
	},
	{
		id: 'mesh-ocean',
		label: 'Ocean mesh',
		background: {
			kind: 'mesh-gradient',
			colors: ['#0ea5e9', '#06b6d4', '#1e3a8a', '#020617'],
			smoothness: 0.62,
			rotation: 12,
			scale: 1.05,
			offsetX: 0,
			offsetY: 0
		}
	},
	{
		id: 'mesh-forest',
		label: 'Forest mesh',
		background: {
			kind: 'mesh-gradient',
			colors: ['#22c55e', '#15803d', '#a3e635', '#052e16'],
			smoothness: 0.5,
			rotation: -8,
			scale: 0.95,
			offsetX: 0,
			offsetY: 0
		}
	},
	{
		id: 'mesh-neon',
		label: 'Neon mesh',
		background: {
			kind: 'mesh-gradient',
			colors: ['#ff00a0', '#7c3aed', '#00e5ff', '#0a0a0a'],
			smoothness: 0.7,
			rotation: 18,
			scale: 1.12,
			offsetX: 0,
			offsetY: 0
		}
	},
	{
		id: 'pattern-dots',
		label: 'Dots',
		background: {
			kind: 'pattern',
			pattern: 'dots',
			foreground: '#ff7a18',
			background: '#0f0f0f',
			scale: 1,
			rotation: 0,
			offsetX: 0,
			offsetY: 0,
			density: 0.5,
			foregroundOpacity: 1
		}
	},
	{
		id: 'pattern-grid',
		label: 'Grid',
		background: {
			kind: 'pattern',
			pattern: 'grid',
			foreground: '#ffffff',
			background: '#18181b',
			scale: 1,
			rotation: 0,
			offsetX: 0,
			offsetY: 0,
			density: 0.45,
			foregroundOpacity: 0.9
		}
	},
	{
		id: 'pattern-stripes',
		label: 'Stripes',
		background: {
			kind: 'pattern',
			pattern: 'stripes',
			foreground: '#ff7a18',
			background: '#1a1a2e',
			scale: 1,
			rotation: 28,
			offsetX: 0,
			offsetY: 0,
			density: 0.5,
			foregroundOpacity: 1
		}
	},
	{
		id: 'pattern-checker',
		label: 'Checker',
		background: {
			kind: 'pattern',
			pattern: 'checker',
			foreground: '#e4e4e7',
			background: '#09090b',
			scale: 1,
			rotation: 0,
			offsetX: 0,
			offsetY: 0,
			density: 0.5,
			foregroundOpacity: 1
		}
	}
] as const;

const PRESET_BY_ID = new Map(BACKGROUND_PRESETS.map((p) => [p.id, p]));

export function getBackgroundPreset(id: string): BackgroundPreset | undefined {
	return PRESET_BY_ID.get(id);
}

export function clonePresetBackground(id: string): ProceduralBackground | null {
	const preset = PRESET_BY_ID.get(id);
	return preset ? cloneBackground(preset.background) : null;
}
