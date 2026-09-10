// Paper Shaders 0.0.80 defaults and ranges, adapted from its Apache-2.0 package.
// See static/licenses/paper-shaders for LICENSE and NOTICE.
import {
	flutedGlassFragmentShader,
	halftoneCmykFragmentShader,
	halftoneDotsFragmentShader,
	imageDitheringFragmentShader,
	lensDistortionFragmentShader,
	paperTextureFragmentShader,
	waterFragmentShader
} from '@paper-design/shaders';
import type { PaperShaderDefinition } from './types';

export const FILTER_SHADERS = [
	{
		id: 'fluted-glass',
		label: 'Fluted glass',
		category: 'filter',
		fragment: flutedGlassFragmentShader,
		animated: false,
		sizing: { speed: 0, scale: 1, rotation: 0, offsetX: 0, offsetY: 0 },
		controls: [
			{
				name: 'colorBack',
				label: 'Background color',
				uniform: 'u_colorBack',
				type: 'color',
				default: '#00000000'
			},
			{
				name: 'colorShadow',
				label: 'Shadow color',
				uniform: 'u_colorShadow',
				type: 'color',
				default: '#000000'
			},
			{
				name: 'colorHighlight',
				label: 'Highlight color',
				uniform: 'u_colorHighlight',
				type: 'color',
				default: '#ffffff'
			},
			{
				name: 'shadows',
				label: 'Shadows',
				uniform: 'u_shadows',
				min: 0.0,
				max: 1.0,
				step: 0.01,
				default: 0.25
			},
			{
				name: 'size',
				label: 'Size',
				uniform: 'u_size',
				min: 0.0,
				max: 1.0,
				step: 0.01,
				default: 0.5
			},
			{
				name: 'angle',
				label: 'Angle',
				uniform: 'u_angle',
				min: 0.0,
				max: 180.0,
				step: 0.01,
				default: 0
			},
			{
				name: 'distortionShape',
				label: 'Distortion shape',
				uniform: 'u_distortionShape',
				type: 'select',
				default: '1',
				options: [
					{ value: '1', label: 'Prism' },
					{ value: '2', label: 'Lens' },
					{ value: '3', label: 'Contour' },
					{ value: '4', label: 'Cascade' },
					{ value: '5', label: 'Flat' }
				]
			},
			{
				name: 'highlights',
				label: 'Highlights',
				uniform: 'u_highlights',
				min: 0.0,
				max: 1.0,
				step: 0.01,
				default: 0.1
			},
			{
				name: 'shape',
				label: 'Shape',
				uniform: 'u_shape',
				type: 'select',
				default: '1',
				options: [
					{ value: '1', label: 'Lines' },
					{ value: '2', label: 'Lines irregular' },
					{ value: '3', label: 'Wave' },
					{ value: '4', label: 'Zigzag' },
					{ value: '5', label: 'Pattern' }
				]
			},
			{
				name: 'distortion',
				label: 'Distortion',
				uniform: 'u_distortion',
				min: 0.0,
				max: 1.0,
				step: 0.01,
				default: 0.5
			},
			{
				name: 'shift',
				label: 'Shift',
				uniform: 'u_shift',
				min: -1.0,
				max: 1.0,
				step: 0.01,
				default: 0
			},
			{
				name: 'blur',
				label: 'Blur',
				uniform: 'u_blur',
				min: 0.0,
				max: 1.0,
				step: 0.01,
				default: 0
			},
			{
				name: 'edges',
				label: 'Edges',
				uniform: 'u_edges',
				min: 0.0,
				max: 1.0,
				step: 0.01,
				default: 0.25
			},
			{
				name: 'stretch',
				label: 'Stretch',
				uniform: 'u_stretch',
				min: 0.0,
				max: 1.0,
				step: 0.01,
				default: 0
			},
			{
				name: 'marginLeft',
				label: 'Margin left',
				uniform: 'u_marginLeft',
				min: 0.0,
				max: 1.0,
				step: 0.01,
				default: 0
			},
			{
				name: 'marginRight',
				label: 'Margin right',
				uniform: 'u_marginRight',
				min: 0.0,
				max: 1.0,
				step: 0.01,
				default: 0
			},
			{
				name: 'marginTop',
				label: 'Margin top',
				uniform: 'u_marginTop',
				min: 0.0,
				max: 1.0,
				step: 0.01,
				default: 0
			},
			{
				name: 'marginBottom',
				label: 'Margin bottom',
				uniform: 'u_marginBottom',
				min: 0.0,
				max: 1.0,
				step: 0.01,
				default: 0
			},
			{
				name: 'grainMixer',
				label: 'Grain mixer',
				uniform: 'u_grainMixer',
				min: 0.0,
				max: 1.0,
				step: 0.01,
				default: 0
			},
			{
				name: 'grainOverlay',
				label: 'Grain overlay',
				uniform: 'u_grainOverlay',
				min: 0.0,
				max: 1.0,
				step: 0.01,
				default: 0
			}
		]
	},
	{
		id: 'halftone-cmyk',
		label: 'Halftone CMYK',
		category: 'filter',
		fragment: halftoneCmykFragmentShader,
		animated: false,
		sizing: { speed: 0, scale: 1, rotation: 0, offsetX: 0, offsetY: 0 },
		controls: [
			{
				name: 'colorBack',
				label: 'Background color',
				uniform: 'u_colorBack',
				type: 'color',
				default: '#fbfaf5'
			},
			{ name: 'colorC', label: 'Cyan', uniform: 'u_colorC', type: 'color', default: '#00b4ff' },
			{ name: 'colorM', label: 'Magenta', uniform: 'u_colorM', type: 'color', default: '#fc519f' },
			{ name: 'colorY', label: 'Yellow', uniform: 'u_colorY', type: 'color', default: '#ffd800' },
			{ name: 'colorK', label: 'Black', uniform: 'u_colorK', type: 'color', default: '#231f20' },
			{
				name: 'size',
				label: 'Size',
				uniform: 'u_size',
				min: 0.0,
				max: 1.0,
				step: 0.01,
				default: 0.2
			},
			{
				name: 'contrast',
				label: 'Contrast',
				uniform: 'u_contrast',
				min: 0.0,
				max: 2.0,
				step: 0.01,
				default: 1
			},
			{
				name: 'softness',
				label: 'Softness',
				uniform: 'u_softness',
				min: 0.0,
				max: 1.0,
				step: 0.01,
				default: 1
			},
			{
				name: 'grainSize',
				label: 'Grain size',
				uniform: 'u_grainSize',
				min: 0.0,
				max: 1.0,
				step: 0.01,
				default: 0.5
			},
			{
				name: 'grainMixer',
				label: 'Grain mixer',
				uniform: 'u_grainMixer',
				min: 0.0,
				max: 1.0,
				step: 0.01,
				default: 0
			},
			{
				name: 'grainOverlay',
				label: 'Grain overlay',
				uniform: 'u_grainOverlay',
				min: 0.0,
				max: 1.0,
				step: 0.01,
				default: 0
			},
			{
				name: 'gridNoise',
				label: 'Grid noise',
				uniform: 'u_gridNoise',
				min: 0.0,
				max: 1.0,
				step: 0.01,
				default: 0.2
			},
			{
				name: 'floodC',
				label: 'Cyan flood',
				uniform: 'u_floodC',
				min: -1.0,
				max: 1.0,
				step: 0.01,
				default: 0.15
			},
			{
				name: 'floodM',
				label: 'Magenta flood',
				uniform: 'u_floodM',
				min: -1.0,
				max: 1.0,
				step: 0.01,
				default: 0
			},
			{
				name: 'floodY',
				label: 'Yellow flood',
				uniform: 'u_floodY',
				min: -1.0,
				max: 1.0,
				step: 0.01,
				default: 0
			},
			{
				name: 'floodK',
				label: 'Black flood',
				uniform: 'u_floodK',
				min: -1.0,
				max: 1.0,
				step: 0.01,
				default: 0
			},
			{
				name: 'gainC',
				label: 'Cyan gain',
				uniform: 'u_gainC',
				min: 0,
				max: 1,
				step: 0.01,
				default: 0.3
			},
			{
				name: 'gainM',
				label: 'Magenta gain',
				uniform: 'u_gainM',
				min: 0,
				max: 1,
				step: 0.01,
				default: 0
			},
			{
				name: 'gainY',
				label: 'Yellow gain',
				uniform: 'u_gainY',
				min: 0,
				max: 1,
				step: 0.01,
				default: 0.2
			},
			{
				name: 'gainK',
				label: 'Black gain',
				uniform: 'u_gainK',
				min: 0,
				max: 1,
				step: 0.01,
				default: 0
			},
			{
				name: 'type',
				label: 'Type',
				uniform: 'u_type',
				type: 'select',
				default: '1',
				options: [
					{ value: '0', label: 'Dots' },
					{ value: '1', label: 'Ink' },
					{ value: '2', label: 'Sharp' }
				]
			}
		]
	},
	{
		id: 'halftone-dots',
		label: 'Halftone dots',
		category: 'filter',
		fragment: halftoneDotsFragmentShader,
		animated: true,
		sizing: { speed: 0, scale: 1, rotation: 0, offsetX: 0, offsetY: 0 },
		controls: [
			{
				name: 'colorBack',
				label: 'Background color',
				uniform: 'u_colorBack',
				type: 'color',
				default: '#f2f1e8'
			},
			{
				name: 'colorFront',
				label: 'Foreground color',
				uniform: 'u_colorFront',
				type: 'color',
				default: '#2b2b2b'
			},
			{
				name: 'size',
				label: 'Size',
				uniform: 'u_size',
				min: 0.0,
				max: 1.0,
				step: 0.01,
				default: 0.5
			},
			{
				name: 'radius',
				label: 'Radius',
				uniform: 'u_radius',
				min: 0.0,
				max: 2.0,
				step: 0.01,
				default: 1.25
			},
			{
				name: 'contrast',
				label: 'Contrast',
				uniform: 'u_contrast',
				min: 0.0,
				max: 1.0,
				step: 0.01,
				default: 0.4
			},
			{
				name: 'originalColors',
				label: 'Original colors',
				uniform: 'u_originalColors',
				type: 'boolean',
				default: false
			},
			{
				name: 'inverted',
				label: 'Inverted',
				uniform: 'u_inverted',
				type: 'boolean',
				default: false
			},
			{
				name: 'grainMixer',
				label: 'Grain mixer',
				uniform: 'u_grainMixer',
				min: 0.0,
				max: 1.0,
				step: 0.01,
				default: 0.2
			},
			{
				name: 'grainOverlay',
				label: 'Grain overlay',
				uniform: 'u_grainOverlay',
				min: 0.0,
				max: 1.0,
				step: 0.01,
				default: 0.2
			},
			{
				name: 'grainSize',
				label: 'Grain size',
				uniform: 'u_grainSize',
				min: 0.0,
				max: 1.0,
				step: 0.01,
				default: 0.5
			},
			{
				name: 'grid',
				label: 'Grid',
				uniform: 'u_grid',
				type: 'select',
				default: '1',
				options: [
					{ value: '0', label: 'Square' },
					{ value: '1', label: 'Hex' }
				]
			},
			{
				name: 'type',
				label: 'Type',
				uniform: 'u_type',
				type: 'select',
				default: '1',
				options: [
					{ value: '0', label: 'Classic' },
					{ value: '1', label: 'Gooey' },
					{ value: '2', label: 'Holes' },
					{ value: '3', label: 'Soft' }
				]
			}
		]
	},
	{
		id: 'image-dithering',
		label: 'Image dithering',
		category: 'filter',
		fragment: imageDitheringFragmentShader,
		animated: false,
		sizing: { speed: 0, scale: 1, rotation: 0, offsetX: 0, offsetY: 0 },
		controls: [
			{
				name: 'colorFront',
				label: 'Foreground color',
				uniform: 'u_colorFront',
				type: 'color',
				default: '#94ffaf'
			},
			{
				name: 'colorBack',
				label: 'Background color',
				uniform: 'u_colorBack',
				type: 'color',
				default: '#000c38'
			},
			{
				name: 'colorHighlight',
				label: 'Highlight color',
				uniform: 'u_colorHighlight',
				type: 'color',
				default: '#eaff94'
			},
			{
				name: 'type',
				label: 'Type',
				uniform: 'u_type',
				type: 'select',
				default: '4',
				options: [
					{ value: '1', label: 'Random' },
					{ value: '2', label: '2x2' },
					{ value: '3', label: '4x4' },
					{ value: '4', label: '8x8' }
				]
			},
			{
				name: 'size',
				label: 'Size',
				uniform: 'u_pxSize',
				min: 0.5,
				max: 20.0,
				step: 0.01,
				default: 2
			},
			{
				name: 'colorSteps',
				label: 'Color steps',
				uniform: 'u_colorSteps',
				min: 2,
				max: 7,
				step: 1,
				default: 2
			},
			{
				name: 'originalColors',
				label: 'Original colors',
				uniform: 'u_originalColors',
				type: 'boolean',
				default: false
			},
			{
				name: 'inverted',
				label: 'Inverted',
				uniform: 'u_inverted',
				type: 'boolean',
				default: false
			}
		]
	},
	{
		id: 'lens-distortion',
		label: 'Lens distortion',
		category: 'filter',
		fragment: lensDistortionFragmentShader,
		animated: false,
		sizing: { speed: 0, scale: 1, rotation: 0, offsetX: 0, offsetY: 0 },
		controls: [
			{
				name: 'spread',
				label: 'Spread',
				uniform: 'u_spread',
				min: 0.0,
				max: 1.0,
				step: 0.01,
				default: 0.6
			},
			{
				name: 'bias',
				label: 'Bias',
				uniform: 'u_bias',
				min: -1.0,
				max: 1.0,
				step: 0.01,
				default: 1
			},
			{
				name: 'angle',
				label: 'Angle',
				uniform: 'u_angle',
				min: 0.0,
				max: 360.0,
				step: 0.01,
				default: 0
			},
			{
				name: 'perspective',
				label: 'Perspective',
				uniform: 'u_perspective',
				min: 0.0,
				max: 1.0,
				step: 0.01,
				default: 0.1
			},
			{
				name: 'count',
				label: 'Count',
				uniform: 'u_count',
				min: 2.0,
				max: 50.0,
				step: 1,
				default: 35
			},
			{
				name: 'dispersion',
				label: 'Dispersion',
				uniform: 'u_dispersion',
				min: 0.0,
				max: 1.0,
				step: 0.01,
				default: 1
			},
			{
				name: 'dispersionShift',
				label: 'Dispersion shift',
				uniform: 'u_dispersionShift',
				min: -1.0,
				max: 1.0,
				step: 0.01,
				default: 0
			},
			{
				name: 'dispersionColor',
				label: 'Dispersion color',
				uniform: 'u_dispersionColor',
				min: 0,
				max: 1,
				step: 0.01,
				default: 0.6
			},
			{
				name: 'focusCenter',
				label: 'Focus center',
				uniform: 'u_focusCenter',
				min: 0.0,
				max: 1.0,
				step: 0.01,
				default: 0.8
			},
			{
				name: 'focusEdges',
				label: 'Focus edges',
				uniform: 'u_focusEdges',
				min: 0.0,
				max: 1.0,
				step: 0.01,
				default: 1
			},
			{
				name: 'swirl',
				label: 'Swirl',
				uniform: 'u_swirl',
				min: -1.0,
				max: 1.0,
				step: 0.01,
				default: 0.35
			},
			{
				name: 'noise',
				label: 'Noise',
				uniform: 'u_noise',
				min: 0.0,
				max: 1.0,
				step: 0.01,
				default: 0
			},
			{
				name: 'noiseFrequency',
				label: 'Noise frequency',
				uniform: 'u_noiseFrequency',
				min: 0,
				max: 1,
				step: 0.01,
				default: 0.25
			},
			{
				name: 'noiseOffset',
				label: 'Noise offset',
				uniform: 'u_noiseOffset',
				min: 0,
				max: 1,
				step: 0.01,
				default: 0
			},
			{
				name: 'lensBulge',
				label: 'Lens bulge',
				uniform: 'u_lensBulge',
				min: -1.0,
				max: 1.0,
				step: 0.01,
				default: 0
			},
			{
				name: 'lensCircle',
				label: 'Lens circle',
				uniform: 'u_lensCircle',
				min: 0.0,
				max: 1.0,
				step: 0.01,
				default: 0
			},
			{
				name: 'grainMixer',
				label: 'Grain mixer',
				uniform: 'u_grainMixer',
				min: 0.0,
				max: 1.0,
				step: 0.01,
				default: 0
			},
			{
				name: 'grainOverlay',
				label: 'Grain overlay',
				uniform: 'u_grainOverlay',
				min: 0.0,
				max: 1.0,
				step: 0.01,
				default: 0
			},
			{
				name: 'imageX',
				label: 'Image X',
				uniform: 'u_imageX',
				min: -1.0,
				max: 1.0,
				step: 0.01,
				default: 0
			},
			{
				name: 'imageY',
				label: 'Image Y',
				uniform: 'u_imageY',
				min: -1.0,
				max: 1.0,
				step: 0.01,
				default: 0
			}
		]
	},
	{
		id: 'paper-texture',
		label: 'Paper texture',
		category: 'filter',
		fragment: paperTextureFragmentShader,
		animated: false,
		sizing: { speed: 0, scale: 0.6, rotation: 0, offsetX: 0, offsetY: 0 },
		controls: [
			{
				name: 'colorFront',
				label: 'Foreground color',
				uniform: 'u_colorFront',
				type: 'color',
				default: '#9fadbc'
			},
			{
				name: 'colorBack',
				label: 'Background color',
				uniform: 'u_colorBack',
				type: 'color',
				default: '#ffffff'
			},
			{
				name: 'contrast',
				label: 'Contrast',
				uniform: 'u_contrast',
				min: 0.0,
				max: 1.0,
				step: 0.01,
				default: 0.3
			},
			{
				name: 'roughness',
				label: 'Roughness',
				uniform: 'u_roughness',
				min: 0.0,
				max: 1.0,
				step: 0.01,
				default: 0.4
			},
			{
				name: 'fiber',
				label: 'Fiber',
				uniform: 'u_fiber',
				min: 0.0,
				max: 1.0,
				step: 0.01,
				default: 0.3
			},
			{
				name: 'fiberSize',
				label: 'Fiber size',
				uniform: 'u_fiberSize',
				min: 0.0,
				max: 1.0,
				step: 0.01,
				default: 0.2
			},
			{
				name: 'crumples',
				label: 'Crumples',
				uniform: 'u_crumples',
				min: 0.0,
				max: 1.0,
				step: 0.01,
				default: 0.3
			},
			{
				name: 'crumpleSize',
				label: 'Crumple size',
				uniform: 'u_crumpleSize',
				min: 0.0,
				max: 1.0,
				step: 0.01,
				default: 0.35
			},
			{
				name: 'folds',
				label: 'Folds',
				uniform: 'u_folds',
				min: 0.0,
				max: 1.0,
				step: 0.01,
				default: 0.65
			},
			{
				name: 'foldCount',
				label: 'Fold count',
				uniform: 'u_foldCount',
				min: 1.0,
				max: 15.0,
				step: 1,
				default: 5
			},
			{
				name: 'fade',
				label: 'Fade',
				uniform: 'u_fade',
				min: 0.0,
				max: 1.0,
				step: 0.01,
				default: 0
			},
			{
				name: 'drops',
				label: 'Drops',
				uniform: 'u_drops',
				min: 0.0,
				max: 1.0,
				step: 0.01,
				default: 0.2
			},
			{
				name: 'seed',
				label: 'Seed',
				uniform: 'u_seed',
				min: 0.0,
				max: 1000.0,
				step: 0.01,
				default: 5.8
			}
		]
	},
	{
		id: 'water',
		label: 'Water',
		category: 'filter',
		fragment: waterFragmentShader,
		animated: true,
		sizing: { speed: 1, scale: 0.8, rotation: 0, offsetX: 0, offsetY: 0 },
		controls: [
			{
				name: 'colorBack',
				label: 'Background color',
				uniform: 'u_colorBack',
				type: 'color',
				default: '#909090'
			},
			{
				name: 'colorHighlight',
				label: 'Highlight color',
				uniform: 'u_colorHighlight',
				type: 'color',
				default: '#ffffff'
			},
			{
				name: 'highlights',
				label: 'Highlights',
				uniform: 'u_highlights',
				min: 0.0,
				max: 1.0,
				step: 0.01,
				default: 0.07
			},
			{
				name: 'layering',
				label: 'Layering',
				uniform: 'u_layering',
				min: 0.0,
				max: 1.0,
				step: 0.01,
				default: 0.5
			},
			{
				name: 'edges',
				label: 'Edges',
				uniform: 'u_edges',
				min: 0.0,
				max: 1.0,
				step: 0.01,
				default: 0.8
			},
			{
				name: 'waves',
				label: 'Waves',
				uniform: 'u_waves',
				min: 0.0,
				max: 1.0,
				step: 0.01,
				default: 0.3
			},
			{
				name: 'caustic',
				label: 'Caustic',
				uniform: 'u_caustic',
				min: 0.0,
				max: 1.0,
				step: 0.01,
				default: 0.1
			},
			{
				name: 'size',
				label: 'Size',
				uniform: 'u_size',
				min: 0.01,
				max: 7.0,
				step: 0.01,
				default: 1
			}
		]
	}
] as const satisfies readonly PaperShaderDefinition[];
