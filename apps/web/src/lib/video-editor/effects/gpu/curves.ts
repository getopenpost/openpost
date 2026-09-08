/** CPU-baked RGB curves LUT. Ported from FreeCut (MIT). */
import type { GpuParamSchema, GpuShaderDefinition } from './types';

import {
	buildCurvesLut,
	curvesLutKey,
	CURVE_CHANNELS,
	curvePointsParamKey
} from '$lib/editor-color-grade/curves';
export * from '$lib/editor-color-grade/curves';
const defaults = { shadowX: 0.25, shadowY: 0.25, highlightX: 0.75, highlightY: 0.75 };

const schema: GpuParamSchema[] = CURVE_CHANNELS.flatMap((channel) => {
	const label = `${channel.slice(0, 1).toUpperCase()}${channel.slice(1)}`;
	return [
		{
			name: `${channel}ShadowX`,
			label: `${label} shadow X`,
			min: 0.02,
			max: 0.94,
			step: 0.01,
			default: defaults.shadowX
		},
		{
			name: `${channel}ShadowY`,
			label: `${label} shadow Y`,
			min: 0,
			max: 1,
			step: 0.01,
			default: defaults.shadowY
		},
		{
			name: `${channel}HighlightX`,
			label: `${label} highlight X`,
			min: 0.06,
			max: 0.98,
			step: 0.01,
			default: defaults.highlightX
		},
		{
			name: `${channel}HighlightY`,
			label: `${label} highlight Y`,
			min: 0,
			max: 1,
			step: 0.01,
			default: defaults.highlightY
		},
		{
			name: curvePointsParamKey(channel),
			label: `${label} points`,
			type: 'text' as const,
			default: '',
			maxLength: 1024,
			visibleWhen: () => false
		}
	];
});

export const curves: GpuShaderDefinition = {
	id: 'gpu-curves',
	label: 'Curves',
	category: 'color',
	entryPoint: 'curvesFragment',
	fragmentSource: `
uniform sampler2D uDataTex;
vec3 sampleCurveLut(float value) {
  float u = (clamp(value, 0.0, 1.0) * 255.0 + 0.5) / 256.0;
  return texture(uDataTex, vec2(u, 0.5)).rgb;
}
vec4 curvesFragment(vec2 vUv) {
  vec4 color = texture(uInputTex, vUv);
  return vec4(sampleCurveLut(color.r).r, sampleCurveLut(color.g).g, sampleCurveLut(color.b).b, color.a);
}`,
	schema,
	uniformValues: () => ({}),
	dataTexture: {
		key: curvesLutKey,
		build: (params) => ({ width: 256, height: 1, data: buildCurvesLut(params) })
	}
};
