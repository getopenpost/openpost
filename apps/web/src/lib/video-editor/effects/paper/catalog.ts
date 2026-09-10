import { BACKGROUND_SHADERS } from './background-catalog';
import { FILTER_SHADERS } from './filter-catalog';
import { LOGO_SHADERS } from './logo-catalog';
import {
	defaultGpuParams,
	normalizeGpuParam,
	type GpuParamValues,
	type GpuParamSchema
} from '../gpu/types';
import type { PaperShaderDefinition } from './types';

export { BACKGROUND_SHADERS };
export const PAPER_SHADERS: readonly PaperShaderDefinition[] = [
	...BACKGROUND_SHADERS,
	...FILTER_SHADERS,
	...LOGO_SHADERS
];
const shaders = new Map(PAPER_SHADERS.map((shader) => [shader.id, shader]));

export type PaperBackgroundId = (typeof BACKGROUND_SHADERS)[number]['id'];

export function getPaperShader(id: string): PaperShaderDefinition | undefined {
	return shaders.get(id);
}

export function paperControls(shader: PaperShaderDefinition): readonly GpuParamSchema[] {
	return shader.controls.map((control) =>
		control.uniform.startsWith('palette:')
			? {
					...control,
					visibleWhen: (params: GpuParamValues) =>
						Number(control.uniform.slice(8)) < Number(params.colorCount)
				}
			: control
	);
}

export function paperDefaultParams(shader: PaperShaderDefinition): GpuParamValues {
	return defaultGpuParams(shader.controls);
}

export function normalizePaperParams(
	shader: PaperShaderDefinition,
	params: GpuParamValues | undefined
): GpuParamValues {
	return Object.fromEntries(
		shader.controls.map((control) => [
			control.name,
			normalizeGpuParam(control, params?.[control.name] ?? control.default)
		])
	);
}
