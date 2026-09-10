import type { PaperShaderDefinition } from './types';

export function paperFragmentSource(shader: PaperShaderDefinition): string {
	let fragment = shader.fragment;
	if (shader.id === 'heatmap') {
		// Our mask retains the current clip's bounds. Paper's DOM preprocessor
		// adds padding, which its fragment compensates for with this scale.
		fragment = fragment.replace('imgUV *= 0.5714285714285714;', '');
	}
	if (shader.id === 'simplex-noise') {
		// Paper 0.0.80 calls fwidth inside the nonuniform outer-color branch.
		// GLSL leaves those derivatives undefined. Evaluate the blend across the
		// whole fragment quad before choosing colors so repeated frames agree.
		fragment = fragment
			.replace(
				'if (u_extraSides == true) {\n    if ((mixer < 0.)',
				`float extraLocalM = mixer > (u_colorsCount - 1.) ? mixer - (u_colorsCount - 1.) : mixer + 1.;
  float extraBlend = steppedSmooth(extraLocalM, steps, .5 * u_softness);
  if (u_extraSides == true) {
    if ((mixer < 0.)`
			)
			.replace(
				'localM = steppedSmooth(localM, steps, .5 * u_softness);\n      vec4 cFst',
				'localM = extraBlend;\n      vec4 cFst'
			);
	}
	// Paper outputs premultiplied colors; the editor's effect chain uses straight alpha.
	return (
		fragment.replace('void main()', 'void paperMain()') +
		'\nvoid main() { paperMain(); if (fragColor.a > 0.) fragColor.rgb /= fragColor.a; }'
	);
}
