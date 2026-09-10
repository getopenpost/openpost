import type { GpuParamSchema, GpuParamValues } from '../gpu/types';

export type PaperControl = GpuParamSchema & { uniform: string };

export interface PaperShaderDefinition {
	id: string;
	label: string;
	category: 'background' | 'filter' | 'logo';
	fragment: string;
	animated: boolean;
	sizing: { speed: number; scale: number; rotation: number; offsetX: number; offsetY: number };
	controls: readonly PaperControl[];
}

export interface PaperRenderSettings {
	params: GpuParamValues;
	seconds: number;
	speed: number;
	phase: number;
	scale: number;
	rotation: number;
	offsetX: number;
	offsetY: number;
}
