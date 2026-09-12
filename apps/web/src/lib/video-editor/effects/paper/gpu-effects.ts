import { PAPER_SHADERS, paperControls } from './catalog';
import type { GpuParamSchema, GpuParamValues, PaperGpuShaderDefinition } from '../gpu/types';

function paperPreviewParams(shaderId: string): GpuParamValues {
	return shaderId === 'heatmap' ? { innerGlow: 1, outerGlow: 1, phase: 3 } : {};
}

const maskSource: GpuParamSchema = {
	name: 'maskSource',
	label: 'Logo source',
	type: 'select',
	default: 'alpha',
	animatable: false,
	options: [
		{ value: 'alpha', label: 'Transparency' },
		{ value: 'dark', label: 'Dark areas' },
		{ value: 'light', label: 'Light areas' }
	]
};

export const PAPER_GPU_EFFECTS: readonly PaperGpuShaderDefinition[] = PAPER_SHADERS.filter(
	(shader) => shader.category !== 'background'
).map((shader) => ({
	id: `gpu-paper-${shader.id}`,
	label: shader.label,
	category: 'shader',
	paperShader: shader.id,
	preview: {
		sample: shader.category === 'logo' ? 'logo' : undefined,
		params: paperPreviewParams(shader.id)
	},
	schema: [
		...(shader.category === 'logo' ? [maskSource] : []),
		...(shader.animated
			? [
					{
						name: 'speed',
						label: 'Speed',
						min: 0,
						max: 3,
						step: 0.05,
						default: shader.sizing.speed,
						animatable: false
					},
					{
						name: 'phase',
						label: 'Starting phase',
						min: 0,
						max: 60,
						step: 0.1,
						default: 0,
						animatable: false
					}
				]
			: []),
		{ name: 'scale', label: 'Scale', min: 0.25, max: 4, step: 0.01, default: shader.sizing.scale },
		{
			name: 'rotation',
			label: 'Rotation',
			min: -360,
			max: 360,
			step: 1,
			default: shader.sizing.rotation
		},
		{
			name: 'offsetX',
			label: 'Offset X',
			min: -1,
			max: 1,
			step: 0.01,
			default: shader.sizing.offsetX
		},
		{
			name: 'offsetY',
			label: 'Offset Y',
			min: -1,
			max: 1,
			step: 0.01,
			default: shader.sizing.offsetY
		},
		...paperControls(shader)
	]
}));
