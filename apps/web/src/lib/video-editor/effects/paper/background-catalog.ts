// Paper Shaders 0.0.80 defaults and ranges, adapted from its Apache-2.0 package.
// See static/licenses/paper-shaders for LICENSE and NOTICE.
import {
	colorPanelsFragmentShader,
	ditheringFragmentShader,
	dotGridFragmentShader,
	dotOrbitFragmentShader,
	godRaysFragmentShader,
	grainGradientFragmentShader,
	meshGradientFragmentShader,
	metaballsFragmentShader,
	neuroNoiseFragmentShader,
	perlinNoiseFragmentShader,
	pulsingBorderFragmentShader,
	simplexNoiseFragmentShader,
	smokeRingFragmentShader,
	spiralFragmentShader,
	staticMeshGradientFragmentShader,
	staticRadialGradientFragmentShader,
	swirlFragmentShader,
	voronoiFragmentShader,
	warpFragmentShader,
	wavesFragmentShader
} from '@paper-design/shaders';
import type { PaperShaderDefinition } from './types';

export const BACKGROUND_SHADERS = [
	{
		id: 'color-panels',
		label: 'Color panels',
		category: 'background',
		fragment: colorPanelsFragmentShader,
		animated: true,
		sizing: { speed: 0.5, scale: 0.8, rotation: 0, offsetX: 0, offsetY: 0 },
		controls: [
			{
				name: 'colorCount',
				label: 'Colors',
				min: 1,
				max: 7,
				step: 1,
				default: 7,
				uniform: 'u_colorsCount'
			},
			{ name: 'color1', label: 'Color 1', type: 'color', default: '#ff9d00', uniform: 'palette:0' },
			{ name: 'color2', label: 'Color 2', type: 'color', default: '#fd4f30', uniform: 'palette:1' },
			{ name: 'color3', label: 'Color 3', type: 'color', default: '#809bff', uniform: 'palette:2' },
			{ name: 'color4', label: 'Color 4', type: 'color', default: '#6d2eff', uniform: 'palette:3' },
			{ name: 'color5', label: 'Color 5', type: 'color', default: '#333aff', uniform: 'palette:4' },
			{ name: 'color6', label: 'Color 6', type: 'color', default: '#f15cff', uniform: 'palette:5' },
			{ name: 'color7', label: 'Color 7', type: 'color', default: '#ffd557', uniform: 'palette:6' },
			{
				name: 'colorBack',
				label: 'Background color',
				uniform: 'u_colorBack',
				type: 'color',
				default: '#000000'
			},
			{
				name: 'angle1',
				label: 'Panel skew X',
				uniform: 'u_angle1',
				min: -1.0,
				max: 1.0,
				step: 0.01,
				default: 0
			},
			{
				name: 'angle2',
				label: 'Panel skew Y',
				uniform: 'u_angle2',
				min: -1.0,
				max: 1.0,
				step: 0.01,
				default: 0
			},
			{
				name: 'length',
				label: 'Length',
				uniform: 'u_length',
				min: 0.0,
				max: 3.0,
				step: 0.01,
				default: 1.1
			},
			{ name: 'edges', label: 'Edges', uniform: 'u_edges', type: 'boolean', default: false },
			{
				name: 'blur',
				label: 'Blur',
				uniform: 'u_blur',
				min: 0.0,
				max: 0.5,
				step: 0.01,
				default: 0
			},
			{
				name: 'fadeIn',
				label: 'Fade in',
				uniform: 'u_fadeIn',
				min: 0.0,
				max: 1.0,
				step: 0.01,
				default: 1
			},
			{
				name: 'fadeOut',
				label: 'Fade out',
				uniform: 'u_fadeOut',
				min: 0.0,
				max: 1.0,
				step: 0.01,
				default: 0.3
			},
			{
				name: 'gradient',
				label: 'Gradient',
				uniform: 'u_gradient',
				min: 0.0,
				max: 1.0,
				step: 0.01,
				default: 0
			},
			{
				name: 'density',
				label: 'Density',
				uniform: 'u_density',
				min: 0.25,
				max: 7.0,
				step: 0.01,
				default: 3
			}
		]
	},
	{
		id: 'dithering',
		label: 'Dithering',
		category: 'background',
		fragment: ditheringFragmentShader,
		animated: true,
		sizing: { speed: 1, scale: 0.6, rotation: 0, offsetX: 0, offsetY: 0 },
		controls: [
			{
				name: 'colorBack',
				label: 'Background color',
				uniform: 'u_colorBack',
				type: 'color',
				default: '#000000'
			},
			{
				name: 'colorFront',
				label: 'Foreground color',
				uniform: 'u_colorFront',
				type: 'color',
				default: '#00b2ff'
			},
			{
				name: 'shape',
				label: 'Shape',
				uniform: 'u_shape',
				type: 'select',
				default: '7',
				options: [
					{ value: '1', label: 'Simplex' },
					{ value: '2', label: 'Warp' },
					{ value: '3', label: 'Dots' },
					{ value: '4', label: 'Wave' },
					{ value: '5', label: 'Ripple' },
					{ value: '6', label: 'Swirl' },
					{ value: '7', label: 'Sphere' }
				]
			},
			{
				name: 'type',
				label: 'Type',
				uniform: 'u_type',
				type: 'select',
				default: '3',
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
			}
		]
	},
	{
		id: 'dot-grid',
		label: 'Dot grid',
		category: 'background',
		fragment: dotGridFragmentShader,
		animated: false,
		sizing: { speed: 0, scale: 1, rotation: 0, offsetX: 0, offsetY: 0 },
		controls: [
			{
				name: 'colorBack',
				label: 'Background color',
				uniform: 'u_colorBack',
				type: 'color',
				default: '#000000'
			},
			{
				name: 'colorFill',
				label: 'Fill color',
				uniform: 'u_colorFill',
				type: 'color',
				default: '#ffffff'
			},
			{
				name: 'colorStroke',
				label: 'Stroke color',
				uniform: 'u_colorStroke',
				type: 'color',
				default: '#ffaa00'
			},
			{
				name: 'size',
				label: 'Size',
				uniform: 'u_dotSize',
				min: 1.0,
				max: 100.0,
				step: 0.01,
				default: 2
			},
			{
				name: 'gapX',
				label: 'Gap x',
				uniform: 'u_gapX',
				min: 2.0,
				max: 500.0,
				step: 0.01,
				default: 32
			},
			{
				name: 'gapY',
				label: 'Gap y',
				uniform: 'u_gapY',
				min: 2.0,
				max: 500.0,
				step: 0.01,
				default: 32
			},
			{
				name: 'strokeWidth',
				label: 'Stroke width',
				uniform: 'u_strokeWidth',
				min: 0.0,
				max: 50.0,
				step: 0.01,
				default: 0
			},
			{
				name: 'sizeRange',
				label: 'Size range',
				uniform: 'u_sizeRange',
				min: 0.0,
				max: 1.0,
				step: 0.01,
				default: 0
			},
			{
				name: 'opacityRange',
				label: 'Opacity range',
				uniform: 'u_opacityRange',
				min: 0.0,
				max: 1.0,
				step: 0.01,
				default: 0
			},
			{
				name: 'shape',
				label: 'Shape',
				uniform: 'u_shape',
				type: 'select',
				default: '0',
				options: [
					{ value: '0', label: 'Circle' },
					{ value: '1', label: 'Diamond' },
					{ value: '2', label: 'Square' },
					{ value: '3', label: 'Triangle' }
				]
			}
		]
	},
	{
		id: 'dot-orbit',
		label: 'Dot orbit',
		category: 'background',
		fragment: dotOrbitFragmentShader,
		animated: true,
		sizing: { speed: 1.5, scale: 1, rotation: 0, offsetX: 0, offsetY: 0 },
		controls: [
			{
				name: 'colorCount',
				label: 'Colors',
				min: 1,
				max: 10,
				step: 1,
				default: 5,
				uniform: 'u_colorsCount'
			},
			{ name: 'color1', label: 'Color 1', type: 'color', default: '#ffc96b', uniform: 'palette:0' },
			{ name: 'color2', label: 'Color 2', type: 'color', default: '#ff6200', uniform: 'palette:1' },
			{ name: 'color3', label: 'Color 3', type: 'color', default: '#ff2f00', uniform: 'palette:2' },
			{ name: 'color4', label: 'Color 4', type: 'color', default: '#421100', uniform: 'palette:3' },
			{ name: 'color5', label: 'Color 5', type: 'color', default: '#1a0000', uniform: 'palette:4' },
			{ name: 'color6', label: 'Color 6', type: 'color', default: '#ffc96b', uniform: 'palette:5' },
			{ name: 'color7', label: 'Color 7', type: 'color', default: '#ff6200', uniform: 'palette:6' },
			{ name: 'color8', label: 'Color 8', type: 'color', default: '#ff2f00', uniform: 'palette:7' },
			{ name: 'color9', label: 'Color 9', type: 'color', default: '#421100', uniform: 'palette:8' },
			{
				name: 'color10',
				label: 'Color 10',
				type: 'color',
				default: '#1a0000',
				uniform: 'palette:9'
			},
			{
				name: 'colorBack',
				label: 'Background color',
				uniform: 'u_colorBack',
				type: 'color',
				default: '#000000'
			},
			{
				name: 'size',
				label: 'Size',
				uniform: 'u_size',
				min: 0.0,
				max: 1.0,
				step: 0.01,
				default: 1
			},
			{
				name: 'sizeRange',
				label: 'Size range',
				uniform: 'u_sizeRange',
				min: 0.0,
				max: 1.0,
				step: 0.01,
				default: 0
			},
			{
				name: 'spreading',
				label: 'Spreading',
				uniform: 'u_spreading',
				min: 0.0,
				max: 1.0,
				step: 0.01,
				default: 1
			},
			{
				name: 'stepsPerColor',
				label: 'Steps per color',
				uniform: 'u_stepsPerColor',
				min: 1.0,
				max: 4.0,
				step: 1,
				default: 4
			}
		]
	},
	{
		id: 'god-rays',
		label: 'God rays',
		category: 'background',
		fragment: godRaysFragmentShader,
		animated: true,
		sizing: { speed: 0.75, scale: 1, rotation: 0, offsetX: 0, offsetY: -0.55 },
		controls: [
			{
				name: 'colorCount',
				label: 'Colors',
				min: 1,
				max: 5,
				step: 1,
				default: 4,
				uniform: 'u_colorsCount'
			},
			{
				name: 'color1',
				label: 'Color 1',
				type: 'color',
				default: '#a600ff6e',
				uniform: 'palette:0'
			},
			{
				name: 'color2',
				label: 'Color 2',
				type: 'color',
				default: '#6200fff0',
				uniform: 'palette:1'
			},
			{ name: 'color3', label: 'Color 3', type: 'color', default: '#ffffff', uniform: 'palette:2' },
			{ name: 'color4', label: 'Color 4', type: 'color', default: '#33fff5', uniform: 'palette:3' },
			{
				name: 'color5',
				label: 'Color 5',
				type: 'color',
				default: '#a600ff6e',
				uniform: 'palette:4'
			},
			{
				name: 'colorBack',
				label: 'Background color',
				uniform: 'u_colorBack',
				type: 'color',
				default: '#000000'
			},
			{
				name: 'colorBloom',
				label: 'Bloom color',
				uniform: 'u_colorBloom',
				type: 'color',
				default: '#0000ff'
			},
			{
				name: 'density',
				label: 'Density',
				uniform: 'u_density',
				min: 0.0,
				max: 1.0,
				step: 0.01,
				default: 0.3
			},
			{
				name: 'spotty',
				label: 'Spotty',
				uniform: 'u_spotty',
				min: 0.0,
				max: 1.0,
				step: 0.01,
				default: 0.3
			},
			{
				name: 'midIntensity',
				label: 'Mid intensity',
				uniform: 'u_midIntensity',
				min: 0.0,
				max: 1.0,
				step: 0.01,
				default: 0.4
			},
			{
				name: 'midSize',
				label: 'Mid size',
				uniform: 'u_midSize',
				min: 0.0,
				max: 1.0,
				step: 0.01,
				default: 0.2
			},
			{
				name: 'intensity',
				label: 'Intensity',
				uniform: 'u_intensity',
				min: 0.0,
				max: 1.0,
				step: 0.01,
				default: 0.8
			},
			{
				name: 'bloom',
				label: 'Bloom',
				uniform: 'u_bloom',
				min: 0.0,
				max: 1.0,
				step: 0.01,
				default: 0.4
			}
		]
	},
	{
		id: 'grain-gradient',
		label: 'Grain gradient',
		category: 'background',
		fragment: grainGradientFragmentShader,
		animated: true,
		sizing: { speed: 1, scale: 1, rotation: 0, offsetX: 0, offsetY: 0 },
		controls: [
			{
				name: 'colorCount',
				label: 'Colors',
				min: 1,
				max: 7,
				step: 1,
				default: 4,
				uniform: 'u_colorsCount'
			},
			{ name: 'color1', label: 'Color 1', type: 'color', default: '#7300ff', uniform: 'palette:0' },
			{ name: 'color2', label: 'Color 2', type: 'color', default: '#eba8ff', uniform: 'palette:1' },
			{ name: 'color3', label: 'Color 3', type: 'color', default: '#00bfff', uniform: 'palette:2' },
			{ name: 'color4', label: 'Color 4', type: 'color', default: '#2a00ff', uniform: 'palette:3' },
			{ name: 'color5', label: 'Color 5', type: 'color', default: '#7300ff', uniform: 'palette:4' },
			{ name: 'color6', label: 'Color 6', type: 'color', default: '#eba8ff', uniform: 'palette:5' },
			{ name: 'color7', label: 'Color 7', type: 'color', default: '#00bfff', uniform: 'palette:6' },
			{
				name: 'colorBack',
				label: 'Background color',
				uniform: 'u_colorBack',
				type: 'color',
				default: '#000000'
			},
			{
				name: 'softness',
				label: 'Softness',
				uniform: 'u_softness',
				min: 0.0,
				max: 1.0,
				step: 0.01,
				default: 0.5
			},
			{
				name: 'intensity',
				label: 'Intensity',
				uniform: 'u_intensity',
				min: 0.0,
				max: 1.0,
				step: 0.01,
				default: 0.5
			},
			{
				name: 'noise',
				label: 'Noise',
				uniform: 'u_noise',
				min: 0.0,
				max: 1.0,
				step: 0.01,
				default: 0.25
			},
			{
				name: 'shape',
				label: 'Shape',
				uniform: 'u_shape',
				type: 'select',
				default: '4',
				options: [
					{ value: '1', label: 'Wave' },
					{ value: '2', label: 'Dots' },
					{ value: '3', label: 'Truchet' },
					{ value: '4', label: 'Corners' },
					{ value: '5', label: 'Ripple' },
					{ value: '6', label: 'Blob' },
					{ value: '7', label: 'Sphere' }
				]
			}
		]
	},
	{
		id: 'mesh-gradient',
		label: 'Mesh gradient',
		category: 'background',
		fragment: meshGradientFragmentShader,
		animated: true,
		sizing: { speed: 1, scale: 1, rotation: 0, offsetX: 0, offsetY: 0 },
		controls: [
			{
				name: 'colorCount',
				label: 'Colors',
				min: 1,
				max: 10,
				step: 1,
				default: 4,
				uniform: 'u_colorsCount'
			},
			{ name: 'color1', label: 'Color 1', type: 'color', default: '#e0eaff', uniform: 'palette:0' },
			{ name: 'color2', label: 'Color 2', type: 'color', default: '#241d9a', uniform: 'palette:1' },
			{ name: 'color3', label: 'Color 3', type: 'color', default: '#f75092', uniform: 'palette:2' },
			{ name: 'color4', label: 'Color 4', type: 'color', default: '#9f50d3', uniform: 'palette:3' },
			{ name: 'color5', label: 'Color 5', type: 'color', default: '#e0eaff', uniform: 'palette:4' },
			{ name: 'color6', label: 'Color 6', type: 'color', default: '#241d9a', uniform: 'palette:5' },
			{ name: 'color7', label: 'Color 7', type: 'color', default: '#f75092', uniform: 'palette:6' },
			{ name: 'color8', label: 'Color 8', type: 'color', default: '#9f50d3', uniform: 'palette:7' },
			{ name: 'color9', label: 'Color 9', type: 'color', default: '#e0eaff', uniform: 'palette:8' },
			{
				name: 'color10',
				label: 'Color 10',
				type: 'color',
				default: '#241d9a',
				uniform: 'palette:9'
			},
			{
				name: 'distortion',
				label: 'Distortion',
				uniform: 'u_distortion',
				min: 0.0,
				max: 1.0,
				step: 0.01,
				default: 0.8
			},
			{
				name: 'swirl',
				label: 'Swirl',
				uniform: 'u_swirl',
				min: 0.0,
				max: 1.0,
				step: 0.01,
				default: 0.1
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
		id: 'metaballs',
		label: 'Metaballs',
		category: 'background',
		fragment: metaballsFragmentShader,
		animated: true,
		sizing: { speed: 1, scale: 1, rotation: 0, offsetX: 0, offsetY: 0 },
		controls: [
			{
				name: 'colorCount',
				label: 'Colors',
				min: 1,
				max: 8,
				step: 1,
				default: 5,
				uniform: 'u_colorsCount'
			},
			{ name: 'color1', label: 'Color 1', type: 'color', default: '#6e33cc', uniform: 'palette:0' },
			{ name: 'color2', label: 'Color 2', type: 'color', default: '#ff5500', uniform: 'palette:1' },
			{ name: 'color3', label: 'Color 3', type: 'color', default: '#ffc105', uniform: 'palette:2' },
			{ name: 'color4', label: 'Color 4', type: 'color', default: '#ffc800', uniform: 'palette:3' },
			{ name: 'color5', label: 'Color 5', type: 'color', default: '#f585ff', uniform: 'palette:4' },
			{ name: 'color6', label: 'Color 6', type: 'color', default: '#6e33cc', uniform: 'palette:5' },
			{ name: 'color7', label: 'Color 7', type: 'color', default: '#ff5500', uniform: 'palette:6' },
			{ name: 'color8', label: 'Color 8', type: 'color', default: '#ffc105', uniform: 'palette:7' },
			{
				name: 'colorBack',
				label: 'Background color',
				uniform: 'u_colorBack',
				type: 'color',
				default: '#000000'
			},
			{
				name: 'count',
				label: 'Count',
				uniform: 'u_count',
				min: 1.0,
				max: 20.0,
				step: 1,
				default: 10
			},
			{
				name: 'size',
				label: 'Size',
				uniform: 'u_size',
				min: 0.0,
				max: 1.0,
				step: 0.01,
				default: 0.83
			}
		]
	},
	{
		id: 'neuro-noise',
		label: 'Neuro noise',
		category: 'background',
		fragment: neuroNoiseFragmentShader,
		animated: true,
		sizing: { speed: 1, scale: 1, rotation: 0, offsetX: 0, offsetY: 0 },
		controls: [
			{
				name: 'colorFront',
				label: 'Foreground color',
				uniform: 'u_colorFront',
				type: 'color',
				default: '#ffffff'
			},
			{
				name: 'colorMid',
				label: 'Middle color',
				uniform: 'u_colorMid',
				type: 'color',
				default: '#47a6ff'
			},
			{
				name: 'colorBack',
				label: 'Background color',
				uniform: 'u_colorBack',
				type: 'color',
				default: '#000000'
			},
			{
				name: 'brightness',
				label: 'Brightness',
				uniform: 'u_brightness',
				min: 0.0,
				max: 1.0,
				step: 0.01,
				default: 0.05
			},
			{
				name: 'contrast',
				label: 'Contrast',
				uniform: 'u_contrast',
				min: 0.0,
				max: 1.0,
				step: 0.01,
				default: 0.3
			}
		]
	},
	{
		id: 'perlin-noise',
		label: 'Perlin noise',
		category: 'background',
		fragment: perlinNoiseFragmentShader,
		animated: true,
		sizing: { speed: 0.5, scale: 1, rotation: 0, offsetX: 0, offsetY: 0 },
		controls: [
			{
				name: 'colorBack',
				label: 'Background color',
				uniform: 'u_colorBack',
				type: 'color',
				default: '#632ad5'
			},
			{
				name: 'colorFront',
				label: 'Foreground color',
				uniform: 'u_colorFront',
				type: 'color',
				default: '#fccff7'
			},
			{
				name: 'proportion',
				label: 'Proportion',
				uniform: 'u_proportion',
				min: 0.0,
				max: 1.0,
				step: 0.01,
				default: 0.35
			},
			{
				name: 'softness',
				label: 'Softness',
				uniform: 'u_softness',
				min: 0.0,
				max: 1.0,
				step: 0.01,
				default: 0.1
			},
			{
				name: 'octaveCount',
				label: 'Octave count',
				uniform: 'u_octaveCount',
				min: 1.0,
				max: 8.0,
				step: 1,
				default: 1
			},
			{
				name: 'persistence',
				label: 'Persistence',
				uniform: 'u_persistence',
				min: 0.3,
				max: 1.0,
				step: 0.01,
				default: 1
			},
			{
				name: 'lacunarity',
				label: 'Lacunarity',
				uniform: 'u_lacunarity',
				min: 1.5,
				max: 10.0,
				step: 0.01,
				default: 1.5
			}
		]
	},
	{
		id: 'pulsing-border',
		label: 'Pulsing border',
		category: 'background',
		fragment: pulsingBorderFragmentShader,
		animated: true,
		sizing: { speed: 1, scale: 0.6, rotation: 0, offsetX: 0, offsetY: 0 },
		controls: [
			{
				name: 'colorCount',
				label: 'Colors',
				min: 1,
				max: 5,
				step: 1,
				default: 3,
				uniform: 'u_colorsCount'
			},
			{ name: 'color1', label: 'Color 1', type: 'color', default: '#0dc1fd', uniform: 'palette:0' },
			{ name: 'color2', label: 'Color 2', type: 'color', default: '#d915ef', uniform: 'palette:1' },
			{
				name: 'color3',
				label: 'Color 3',
				type: 'color',
				default: '#ff3f2ecc',
				uniform: 'palette:2'
			},
			{ name: 'color4', label: 'Color 4', type: 'color', default: '#0dc1fd', uniform: 'palette:3' },
			{ name: 'color5', label: 'Color 5', type: 'color', default: '#d915ef', uniform: 'palette:4' },
			{
				name: 'colorBack',
				label: 'Background color',
				uniform: 'u_colorBack',
				type: 'color',
				default: '#000000'
			},
			{
				name: 'roundness',
				label: 'Roundness',
				uniform: 'u_roundness',
				min: 0.0,
				max: 1.0,
				step: 0.01,
				default: 0.25
			},
			{
				name: 'thickness',
				label: 'Thickness',
				uniform: 'u_thickness',
				min: 0.0,
				max: 1.0,
				step: 0.01,
				default: 0.1
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
				name: 'aspectRatio',
				label: 'Aspect ratio',
				uniform: 'u_aspectRatio',
				type: 'select',
				default: '0',
				options: [
					{ value: '0', label: 'Auto' },
					{ value: '1', label: 'Square' }
				]
			},
			{
				name: 'softness',
				label: 'Softness',
				uniform: 'u_softness',
				min: 0.0,
				max: 1.0,
				step: 0.01,
				default: 0.75
			},
			{
				name: 'intensity',
				label: 'Intensity',
				uniform: 'u_intensity',
				min: 0.0,
				max: 1.0,
				step: 0.01,
				default: 0.2
			},
			{
				name: 'bloom',
				label: 'Bloom',
				uniform: 'u_bloom',
				min: 0.0,
				max: 1.0,
				step: 0.01,
				default: 0.25
			},
			{
				name: 'spots',
				label: 'Spots',
				uniform: 'u_spots',
				min: 1.0,
				max: 20.0,
				step: 1,
				default: 5
			},
			{
				name: 'spotSize',
				label: 'Spot size',
				uniform: 'u_spotSize',
				min: 0.0,
				max: 1.0,
				step: 0.01,
				default: 0.5
			},
			{
				name: 'pulse',
				label: 'Pulse',
				uniform: 'u_pulse',
				min: 0.0,
				max: 1.0,
				step: 0.01,
				default: 0.25
			},
			{
				name: 'smoke',
				label: 'Smoke',
				uniform: 'u_smoke',
				min: 0.0,
				max: 1.0,
				step: 0.01,
				default: 0.3
			},
			{
				name: 'smokeSize',
				label: 'Smoke size',
				uniform: 'u_smokeSize',
				min: 0.0,
				max: 1.0,
				step: 0.01,
				default: 0.6
			}
		]
	},
	{
		id: 'simplex-noise',
		label: 'Simplex noise',
		category: 'background',
		fragment: simplexNoiseFragmentShader,
		animated: true,
		sizing: { speed: 0.5, scale: 0.6, rotation: 0, offsetX: 0, offsetY: 0 },
		controls: [
			{
				name: 'colorCount',
				label: 'Colors',
				min: 1,
				max: 10,
				step: 1,
				default: 5,
				uniform: 'u_colorsCount'
			},
			{ name: 'color1', label: 'Color 1', type: 'color', default: '#4449CF', uniform: 'palette:0' },
			{ name: 'color2', label: 'Color 2', type: 'color', default: '#FFD1E0', uniform: 'palette:1' },
			{ name: 'color3', label: 'Color 3', type: 'color', default: '#F94446', uniform: 'palette:2' },
			{ name: 'color4', label: 'Color 4', type: 'color', default: '#FFD36B', uniform: 'palette:3' },
			{ name: 'color5', label: 'Color 5', type: 'color', default: '#FFFFFF', uniform: 'palette:4' },
			{ name: 'color6', label: 'Color 6', type: 'color', default: '#4449CF', uniform: 'palette:5' },
			{ name: 'color7', label: 'Color 7', type: 'color', default: '#FFD1E0', uniform: 'palette:6' },
			{ name: 'color8', label: 'Color 8', type: 'color', default: '#F94446', uniform: 'palette:7' },
			{ name: 'color9', label: 'Color 9', type: 'color', default: '#FFD36B', uniform: 'palette:8' },
			{
				name: 'color10',
				label: 'Color 10',
				type: 'color',
				default: '#FFFFFF',
				uniform: 'palette:9'
			},
			{
				name: 'stepsPerColor',
				label: 'Steps per color',
				uniform: 'u_stepsPerColor',
				min: 1.0,
				max: 10.0,
				step: 1,
				default: 2
			},
			{
				name: 'softness',
				label: 'Softness',
				uniform: 'u_softness',
				min: 0.0,
				max: 1.0,
				step: 0.01,
				default: 0
			}
		]
	},
	{
		id: 'smoke-ring',
		label: 'Smoke ring',
		category: 'background',
		fragment: smokeRingFragmentShader,
		animated: true,
		sizing: { speed: 0.5, scale: 0.8, rotation: 0, offsetX: 0, offsetY: 0 },
		controls: [
			{
				name: 'colorCount',
				label: 'Colors',
				min: 1,
				max: 10,
				step: 1,
				default: 1,
				uniform: 'u_colorsCount'
			},
			{ name: 'color1', label: 'Color 1', type: 'color', default: '#ffffff', uniform: 'palette:0' },
			{ name: 'color2', label: 'Color 2', type: 'color', default: '#ffffff', uniform: 'palette:1' },
			{ name: 'color3', label: 'Color 3', type: 'color', default: '#ffffff', uniform: 'palette:2' },
			{ name: 'color4', label: 'Color 4', type: 'color', default: '#ffffff', uniform: 'palette:3' },
			{ name: 'color5', label: 'Color 5', type: 'color', default: '#ffffff', uniform: 'palette:4' },
			{ name: 'color6', label: 'Color 6', type: 'color', default: '#ffffff', uniform: 'palette:5' },
			{ name: 'color7', label: 'Color 7', type: 'color', default: '#ffffff', uniform: 'palette:6' },
			{ name: 'color8', label: 'Color 8', type: 'color', default: '#ffffff', uniform: 'palette:7' },
			{ name: 'color9', label: 'Color 9', type: 'color', default: '#ffffff', uniform: 'palette:8' },
			{
				name: 'color10',
				label: 'Color 10',
				type: 'color',
				default: '#ffffff',
				uniform: 'palette:9'
			},
			{
				name: 'colorBack',
				label: 'Background color',
				uniform: 'u_colorBack',
				type: 'color',
				default: '#000000'
			},
			{
				name: 'noiseScale',
				label: 'Noise scale',
				uniform: 'u_noiseScale',
				min: 0.01,
				max: 5.0,
				step: 0.01,
				default: 3
			},
			{
				name: 'noiseIterations',
				label: 'Noise iterations',
				uniform: 'u_noiseIterations',
				min: 1.0,
				max: 8.0,
				step: 1,
				default: 8
			},
			{
				name: 'radius',
				label: 'Radius',
				uniform: 'u_radius',
				min: 0.0,
				max: 1.0,
				step: 0.01,
				default: 0.25
			},
			{
				name: 'thickness',
				label: 'Thickness',
				uniform: 'u_thickness',
				min: 0.01,
				max: 1.0,
				step: 0.01,
				default: 0.65
			},
			{
				name: 'innerShape',
				label: 'Inner shape',
				uniform: 'u_innerShape',
				min: 0.0,
				max: 4.0,
				step: 0.01,
				default: 0.7
			}
		]
	},
	{
		id: 'spiral',
		label: 'Spiral',
		category: 'background',
		fragment: spiralFragmentShader,
		animated: true,
		sizing: { speed: 1, scale: 1, rotation: 0, offsetX: 0, offsetY: 0 },
		controls: [
			{
				name: 'colorBack',
				label: 'Background color',
				uniform: 'u_colorBack',
				type: 'color',
				default: '#001429'
			},
			{
				name: 'colorFront',
				label: 'Foreground color',
				uniform: 'u_colorFront',
				type: 'color',
				default: '#79D1FF'
			},
			{
				name: 'density',
				label: 'Density',
				uniform: 'u_density',
				min: 0.0,
				max: 1.0,
				step: 0.01,
				default: 1
			},
			{
				name: 'distortion',
				label: 'Distortion',
				uniform: 'u_distortion',
				min: 0.0,
				max: 1.0,
				step: 0.01,
				default: 0
			},
			{
				name: 'strokeWidth',
				label: 'Stroke width',
				uniform: 'u_strokeWidth',
				min: 0.0,
				max: 1.0,
				step: 0.01,
				default: 0.5
			},
			{
				name: 'strokeTaper',
				label: 'Stroke taper',
				uniform: 'u_strokeTaper',
				min: 0.0,
				max: 1.0,
				step: 0.01,
				default: 0
			},
			{
				name: 'strokeCap',
				label: 'Stroke cap',
				uniform: 'u_strokeCap',
				min: 0.0,
				max: 1.0,
				step: 0.01,
				default: 0
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
				min: 0.0,
				max: 1.0,
				step: 0.01,
				default: 0
			},
			{
				name: 'softness',
				label: 'Softness',
				uniform: 'u_softness',
				min: 0.0,
				max: 1.0,
				step: 0.01,
				default: 0
			}
		]
	},
	{
		id: 'static-mesh-gradient',
		label: 'Static mesh gradient',
		category: 'background',
		fragment: staticMeshGradientFragmentShader,
		animated: false,
		sizing: { speed: 0, scale: 1, rotation: 270, offsetX: 0, offsetY: 0 },
		controls: [
			{
				name: 'colorCount',
				label: 'Colors',
				min: 1,
				max: 10,
				step: 1,
				default: 4,
				uniform: 'u_colorsCount'
			},
			{ name: 'color1', label: 'Color 1', type: 'color', default: '#ffad0a', uniform: 'palette:0' },
			{ name: 'color2', label: 'Color 2', type: 'color', default: '#6200ff', uniform: 'palette:1' },
			{ name: 'color3', label: 'Color 3', type: 'color', default: '#e2a3ff', uniform: 'palette:2' },
			{ name: 'color4', label: 'Color 4', type: 'color', default: '#ff99fd', uniform: 'palette:3' },
			{ name: 'color5', label: 'Color 5', type: 'color', default: '#ffad0a', uniform: 'palette:4' },
			{ name: 'color6', label: 'Color 6', type: 'color', default: '#6200ff', uniform: 'palette:5' },
			{ name: 'color7', label: 'Color 7', type: 'color', default: '#e2a3ff', uniform: 'palette:6' },
			{ name: 'color8', label: 'Color 8', type: 'color', default: '#ff99fd', uniform: 'palette:7' },
			{ name: 'color9', label: 'Color 9', type: 'color', default: '#ffad0a', uniform: 'palette:8' },
			{
				name: 'color10',
				label: 'Color 10',
				type: 'color',
				default: '#6200ff',
				uniform: 'palette:9'
			},
			{
				name: 'positions',
				label: 'Positions',
				uniform: 'u_positions',
				min: 0.0,
				max: 100.0,
				step: 1,
				default: 2
			},
			{
				name: 'waveX',
				label: 'Wave X',
				uniform: 'u_waveX',
				min: 0.0,
				max: 1.0,
				step: 0.01,
				default: 1
			},
			{
				name: 'waveXShift',
				label: 'Wave X phase',
				uniform: 'u_waveXShift',
				min: 0.0,
				max: 1.0,
				step: 0.01,
				default: 0.6
			},
			{
				name: 'waveY',
				label: 'Wave Y',
				uniform: 'u_waveY',
				min: 0.0,
				max: 1.0,
				step: 0.01,
				default: 1
			},
			{
				name: 'waveYShift',
				label: 'Wave Y phase',
				uniform: 'u_waveYShift',
				min: 0.0,
				max: 1.0,
				step: 0.01,
				default: 0.21
			},
			{
				name: 'mixing',
				label: 'Mixing',
				uniform: 'u_mixing',
				min: 0.0,
				max: 1.0,
				step: 0.01,
				default: 0.93
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
		id: 'static-radial-gradient',
		label: 'Static radial gradient',
		category: 'background',
		fragment: staticRadialGradientFragmentShader,
		animated: false,
		sizing: { speed: 0, scale: 1, rotation: 0, offsetX: 0, offsetY: 0 },
		controls: [
			{
				name: 'colorCount',
				label: 'Colors',
				min: 1,
				max: 10,
				step: 1,
				default: 3,
				uniform: 'u_colorsCount'
			},
			{ name: 'color1', label: 'Color 1', type: 'color', default: '#00bbff', uniform: 'palette:0' },
			{ name: 'color2', label: 'Color 2', type: 'color', default: '#00ffe1', uniform: 'palette:1' },
			{ name: 'color3', label: 'Color 3', type: 'color', default: '#ffffff', uniform: 'palette:2' },
			{ name: 'color4', label: 'Color 4', type: 'color', default: '#00bbff', uniform: 'palette:3' },
			{ name: 'color5', label: 'Color 5', type: 'color', default: '#00ffe1', uniform: 'palette:4' },
			{ name: 'color6', label: 'Color 6', type: 'color', default: '#ffffff', uniform: 'palette:5' },
			{ name: 'color7', label: 'Color 7', type: 'color', default: '#00bbff', uniform: 'palette:6' },
			{ name: 'color8', label: 'Color 8', type: 'color', default: '#00ffe1', uniform: 'palette:7' },
			{ name: 'color9', label: 'Color 9', type: 'color', default: '#ffffff', uniform: 'palette:8' },
			{
				name: 'color10',
				label: 'Color 10',
				type: 'color',
				default: '#00bbff',
				uniform: 'palette:9'
			},
			{
				name: 'colorBack',
				label: 'Background color',
				uniform: 'u_colorBack',
				type: 'color',
				default: '#000000'
			},
			{
				name: 'radius',
				label: 'Radius',
				uniform: 'u_radius',
				min: 0.0,
				max: 3.0,
				step: 0.01,
				default: 0.8
			},
			{
				name: 'focalDistance',
				label: 'Focal distance',
				uniform: 'u_focalDistance',
				min: 0.0,
				max: 3.0,
				step: 0.01,
				default: 0.99
			},
			{
				name: 'focalAngle',
				label: 'Focal angle',
				uniform: 'u_focalAngle',
				min: 0.0,
				max: 360.0,
				step: 0.01,
				default: 0
			},
			{
				name: 'falloff',
				label: 'Falloff',
				uniform: 'u_falloff',
				min: -1.0,
				max: 1.0,
				step: 0.01,
				default: 0.24
			},
			{
				name: 'mixing',
				label: 'Mixing',
				uniform: 'u_mixing',
				min: 0.0,
				max: 1.0,
				step: 0.01,
				default: 0.5
			},
			{
				name: 'distortion',
				label: 'Distortion',
				uniform: 'u_distortion',
				min: 0.0,
				max: 1.0,
				step: 0.01,
				default: 0
			},
			{
				name: 'distortionShift',
				label: 'Distortion shift',
				uniform: 'u_distortionShift',
				min: -1.0,
				max: 1.0,
				step: 0.01,
				default: 0
			},
			{
				name: 'distortionFreq',
				label: 'Distortion frequency',
				uniform: 'u_distortionFreq',
				min: 0.0,
				max: 20.0,
				step: 0.01,
				default: 12
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
		id: 'swirl',
		label: 'Swirl',
		category: 'background',
		fragment: swirlFragmentShader,
		animated: true,
		sizing: { speed: 0.32, scale: 1, rotation: 0, offsetX: 0, offsetY: 0 },
		controls: [
			{
				name: 'colorCount',
				label: 'Colors',
				min: 1,
				max: 10,
				step: 1,
				default: 3,
				uniform: 'u_colorsCount'
			},
			{ name: 'color1', label: 'Color 1', type: 'color', default: '#ffd1d1', uniform: 'palette:0' },
			{ name: 'color2', label: 'Color 2', type: 'color', default: '#ff8a8a', uniform: 'palette:1' },
			{ name: 'color3', label: 'Color 3', type: 'color', default: '#660000', uniform: 'palette:2' },
			{ name: 'color4', label: 'Color 4', type: 'color', default: '#ffd1d1', uniform: 'palette:3' },
			{ name: 'color5', label: 'Color 5', type: 'color', default: '#ff8a8a', uniform: 'palette:4' },
			{ name: 'color6', label: 'Color 6', type: 'color', default: '#660000', uniform: 'palette:5' },
			{ name: 'color7', label: 'Color 7', type: 'color', default: '#ffd1d1', uniform: 'palette:6' },
			{ name: 'color8', label: 'Color 8', type: 'color', default: '#ff8a8a', uniform: 'palette:7' },
			{ name: 'color9', label: 'Color 9', type: 'color', default: '#660000', uniform: 'palette:8' },
			{
				name: 'color10',
				label: 'Color 10',
				type: 'color',
				default: '#ffd1d1',
				uniform: 'palette:9'
			},
			{
				name: 'colorBack',
				label: 'Background color',
				uniform: 'u_colorBack',
				type: 'color',
				default: '#330000'
			},
			{
				name: 'bandCount',
				label: 'Band count',
				uniform: 'u_bandCount',
				min: 0.0,
				max: 15.0,
				step: 0.01,
				default: 4
			},
			{
				name: 'twist',
				label: 'Twist',
				uniform: 'u_twist',
				min: 0.0,
				max: 1.0,
				step: 0.01,
				default: 0.1
			},
			{
				name: 'center',
				label: 'Center',
				uniform: 'u_center',
				min: 0.0,
				max: 1.0,
				step: 0.01,
				default: 0.2
			},
			{
				name: 'proportion',
				label: 'Proportion',
				uniform: 'u_proportion',
				min: 0.0,
				max: 1.0,
				step: 0.01,
				default: 0.5
			},
			{
				name: 'softness',
				label: 'Softness',
				uniform: 'u_softness',
				min: 0.0,
				max: 1.0,
				step: 0.01,
				default: 0
			},
			{
				name: 'noiseFrequency',
				label: 'Noise frequency',
				uniform: 'u_noiseFrequency',
				min: 0.0,
				max: 1.0,
				step: 0.01,
				default: 0.4
			},
			{
				name: 'noise',
				label: 'Noise',
				uniform: 'u_noise',
				min: 0.0,
				max: 1.0,
				step: 0.01,
				default: 0.2
			}
		]
	},
	{
		id: 'voronoi',
		label: 'Voronoi',
		category: 'background',
		fragment: voronoiFragmentShader,
		animated: true,
		sizing: { speed: 0.5, scale: 0.5, rotation: 0, offsetX: 0, offsetY: 0 },
		controls: [
			{
				name: 'colorCount',
				label: 'Colors',
				min: 1,
				max: 5,
				step: 1,
				default: 2,
				uniform: 'u_colorsCount'
			},
			{ name: 'color1', label: 'Color 1', type: 'color', default: '#ff8247', uniform: 'palette:0' },
			{ name: 'color2', label: 'Color 2', type: 'color', default: '#ffe53d', uniform: 'palette:1' },
			{ name: 'color3', label: 'Color 3', type: 'color', default: '#ff8247', uniform: 'palette:2' },
			{ name: 'color4', label: 'Color 4', type: 'color', default: '#ffe53d', uniform: 'palette:3' },
			{ name: 'color5', label: 'Color 5', type: 'color', default: '#ff8247', uniform: 'palette:4' },
			{
				name: 'stepsPerColor',
				label: 'Steps per color',
				uniform: 'u_stepsPerColor',
				min: 1.0,
				max: 3.0,
				step: 1,
				default: 3
			},
			{
				name: 'colorGlow',
				label: 'Glow color',
				uniform: 'u_colorGlow',
				type: 'color',
				default: '#ffffff'
			},
			{
				name: 'colorGap',
				label: 'Gap color',
				uniform: 'u_colorGap',
				type: 'color',
				default: '#2e0000'
			},
			{
				name: 'distortion',
				label: 'Distortion',
				uniform: 'u_distortion',
				min: 0.0,
				max: 0.5,
				step: 0.01,
				default: 0.4
			},
			{
				name: 'gap',
				label: 'Gap',
				uniform: 'u_gap',
				min: 0.0,
				max: 0.1,
				step: 0.01,
				default: 0.04
			},
			{ name: 'glow', label: 'Glow', uniform: 'u_glow', min: 0.0, max: 1.0, step: 0.01, default: 0 }
		]
	},
	{
		id: 'warp',
		label: 'Warp',
		category: 'background',
		fragment: warpFragmentShader,
		animated: true,
		sizing: { speed: 1, scale: 1, rotation: 0, offsetX: 0, offsetY: 0 },
		controls: [
			{
				name: 'colorCount',
				label: 'Colors',
				min: 1,
				max: 10,
				step: 1,
				default: 4,
				uniform: 'u_colorsCount'
			},
			{ name: 'color1', label: 'Color 1', type: 'color', default: '#121212', uniform: 'palette:0' },
			{ name: 'color2', label: 'Color 2', type: 'color', default: '#9470ff', uniform: 'palette:1' },
			{ name: 'color3', label: 'Color 3', type: 'color', default: '#121212', uniform: 'palette:2' },
			{ name: 'color4', label: 'Color 4', type: 'color', default: '#8838ff', uniform: 'palette:3' },
			{ name: 'color5', label: 'Color 5', type: 'color', default: '#121212', uniform: 'palette:4' },
			{ name: 'color6', label: 'Color 6', type: 'color', default: '#9470ff', uniform: 'palette:5' },
			{ name: 'color7', label: 'Color 7', type: 'color', default: '#121212', uniform: 'palette:6' },
			{ name: 'color8', label: 'Color 8', type: 'color', default: '#8838ff', uniform: 'palette:7' },
			{ name: 'color9', label: 'Color 9', type: 'color', default: '#121212', uniform: 'palette:8' },
			{
				name: 'color10',
				label: 'Color 10',
				type: 'color',
				default: '#9470ff',
				uniform: 'palette:9'
			},
			{
				name: 'proportion',
				label: 'Proportion',
				uniform: 'u_proportion',
				min: 0.0,
				max: 1.0,
				step: 0.01,
				default: 0.45
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
				name: 'distortion',
				label: 'Distortion',
				uniform: 'u_distortion',
				min: 0.0,
				max: 1.0,
				step: 0.01,
				default: 0.25
			},
			{
				name: 'swirl',
				label: 'Swirl',
				uniform: 'u_swirl',
				min: 0.0,
				max: 1.0,
				step: 0.01,
				default: 0.8
			},
			{
				name: 'swirlIterations',
				label: 'Swirl iterations',
				uniform: 'u_swirlIterations',
				min: 0.0,
				max: 20.0,
				step: 1,
				default: 10
			},
			{
				name: 'shapeScale',
				label: 'Shape scale',
				uniform: 'u_shapeScale',
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
				default: '0',
				options: [
					{ value: '0', label: 'Checks' },
					{ value: '1', label: 'Stripes' },
					{ value: '2', label: 'Edge' }
				]
			}
		]
	},
	{
		id: 'waves',
		label: 'Waves',
		category: 'background',
		fragment: wavesFragmentShader,
		animated: false,
		sizing: { speed: 0, scale: 0.6, rotation: 0, offsetX: 0, offsetY: 0 },
		controls: [
			{
				name: 'colorFront',
				label: 'Foreground color',
				uniform: 'u_colorFront',
				type: 'color',
				default: '#ffbb00'
			},
			{
				name: 'colorBack',
				label: 'Background color',
				uniform: 'u_colorBack',
				type: 'color',
				default: '#000000'
			},
			{
				name: 'shape',
				label: 'Shape',
				uniform: 'u_shape',
				min: 0.0,
				max: 3.0,
				step: 0.01,
				default: 0
			},
			{
				name: 'frequency',
				label: 'Frequency',
				uniform: 'u_frequency',
				min: 0.0,
				max: 2.0,
				step: 0.01,
				default: 0.5
			},
			{
				name: 'amplitude',
				label: 'Amplitude',
				uniform: 'u_amplitude',
				min: 0.0,
				max: 1.0,
				step: 0.01,
				default: 0.5
			},
			{
				name: 'spacing',
				label: 'Spacing',
				uniform: 'u_spacing',
				min: 0.0,
				max: 2.0,
				step: 0.01,
				default: 1.2
			},
			{
				name: 'proportion',
				label: 'Proportion',
				uniform: 'u_proportion',
				min: 0.0,
				max: 1.0,
				step: 0.01,
				default: 0.1
			},
			{
				name: 'softness',
				label: 'Softness',
				uniform: 'u_softness',
				min: 0.0,
				max: 1.0,
				step: 0.01,
				default: 0
			}
		]
	}
] as const satisfies readonly PaperShaderDefinition[];
