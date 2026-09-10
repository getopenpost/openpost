// Paper Shaders 0.0.80 defaults and ranges, adapted from its Apache-2.0 package.
// See static/licenses/paper-shaders for LICENSE and NOTICE.
import {
	gemSmokeFragmentShader,
	heatmapFragmentShader,
	liquidMetalFragmentShader
} from '@paper-design/shaders';
import type { PaperShaderDefinition } from './types';

export const LOGO_SHADERS = [
	{
		id: 'gem-smoke',
		label: 'Gem smoke',
		category: 'logo',
		fragment: gemSmokeFragmentShader,
		animated: true,
		sizing: { speed: 1, scale: 0.6, rotation: 0, offsetX: 0, offsetY: 0 },
		controls: [
			{
				name: 'colorCount',
				label: 'Colors',
				min: 1,
				max: 6,
				step: 1,
				default: 2,
				uniform: 'u_colorsCount'
			},
			{ name: 'color1', label: 'Color 1', type: 'color', default: '#333333', uniform: 'palette:0' },
			{ name: 'color2', label: 'Color 2', type: 'color', default: '#e7e6df', uniform: 'palette:1' },
			{ name: 'color3', label: 'Color 3', type: 'color', default: '#333333', uniform: 'palette:2' },
			{ name: 'color4', label: 'Color 4', type: 'color', default: '#e7e6df', uniform: 'palette:3' },
			{ name: 'color5', label: 'Color 5', type: 'color', default: '#333333', uniform: 'palette:4' },
			{ name: 'color6', label: 'Color 6', type: 'color', default: '#e7e6df', uniform: 'palette:5' },
			{
				name: 'colorBack',
				label: 'Background color',
				uniform: 'u_colorBack',
				type: 'color',
				default: '#f0efea'
			},
			{
				name: 'colorInner',
				label: 'Inner color',
				uniform: 'u_colorInner',
				type: 'color',
				default: '#fafaf5'
			},
			{
				name: 'outerGlow',
				label: 'Outer glow',
				uniform: 'u_outerGlow',
				min: 0.0,
				max: 1.0,
				step: 0.01,
				default: 0.55
			},
			{
				name: 'innerGlow',
				label: 'Inner glow',
				uniform: 'u_innerGlow',
				min: 0.0,
				max: 1.0,
				step: 0.01,
				default: 1
			},
			{
				name: 'innerDistortion',
				label: 'Inner distortion',
				uniform: 'u_innerDistortion',
				min: 0.0,
				max: 1.0,
				step: 0.01,
				default: 0.8
			},
			{
				name: 'outerDistortion',
				label: 'Outer distortion',
				uniform: 'u_outerDistortion',
				min: 0.0,
				max: 1.0,
				step: 0.01,
				default: 0.6
			},
			{
				name: 'offset',
				label: 'Offset',
				uniform: 'u_offset',
				min: -1.0,
				max: 1.0,
				step: 0.01,
				default: 0
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
				name: 'size',
				label: 'Size',
				uniform: 'u_size',
				min: 0.0,
				max: 1.0,
				step: 0.01,
				default: 0.8
			}
		]
	},
	{
		id: 'heatmap',
		label: 'Heatmap',
		category: 'logo',
		fragment: heatmapFragmentShader,
		animated: true,
		sizing: { speed: 1, scale: 0.75, rotation: 0, offsetX: 0, offsetY: 0 },
		controls: [
			{
				name: 'colorCount',
				label: 'Colors',
				min: 1,
				max: 10,
				step: 1,
				default: 7,
				uniform: 'u_colorsCount'
			},
			{ name: 'color1', label: 'Color 1', type: 'color', default: '#11206a', uniform: 'palette:0' },
			{ name: 'color2', label: 'Color 2', type: 'color', default: '#1f3ba2', uniform: 'palette:1' },
			{ name: 'color3', label: 'Color 3', type: 'color', default: '#2f63e7', uniform: 'palette:2' },
			{ name: 'color4', label: 'Color 4', type: 'color', default: '#6bd7ff', uniform: 'palette:3' },
			{ name: 'color5', label: 'Color 5', type: 'color', default: '#ffe679', uniform: 'palette:4' },
			{ name: 'color6', label: 'Color 6', type: 'color', default: '#ff991e', uniform: 'palette:5' },
			{ name: 'color7', label: 'Color 7', type: 'color', default: '#ff4c00', uniform: 'palette:6' },
			{ name: 'color8', label: 'Color 8', type: 'color', default: '#11206a', uniform: 'palette:7' },
			{ name: 'color9', label: 'Color 9', type: 'color', default: '#1f3ba2', uniform: 'palette:8' },
			{
				name: 'color10',
				label: 'Color 10',
				type: 'color',
				default: '#2f63e7',
				uniform: 'palette:9'
			},
			{
				name: 'contour',
				label: 'Contour',
				uniform: 'u_contour',
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
				max: 360.0,
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
				name: 'innerGlow',
				label: 'Inner glow',
				uniform: 'u_innerGlow',
				min: 0.0,
				max: 1.0,
				step: 0.01,
				default: 0.5
			},
			{
				name: 'outerGlow',
				label: 'Outer glow',
				uniform: 'u_outerGlow',
				min: 0.0,
				max: 1.0,
				step: 0.01,
				default: 0.5
			},
			{
				name: 'colorBack',
				label: 'Background color',
				uniform: 'u_colorBack',
				type: 'color',
				default: '#000000'
			}
		]
	},
	{
		id: 'liquid-metal',
		label: 'Liquid metal',
		category: 'logo',
		fragment: liquidMetalFragmentShader,
		animated: true,
		sizing: { speed: 1, scale: 0.6, rotation: 0, offsetX: 0, offsetY: 0 },
		controls: [
			{
				name: 'colorBack',
				label: 'Background color',
				uniform: 'u_colorBack',
				type: 'color',
				default: '#AAAAAC'
			},
			{
				name: 'colorTint',
				label: 'Tint color',
				uniform: 'u_colorTint',
				type: 'color',
				default: '#ffffff'
			},
			{
				name: 'distortion',
				label: 'Distortion',
				uniform: 'u_distortion',
				min: 0.0,
				max: 1.0,
				step: 0.01,
				default: 0.07
			},
			{
				name: 'repetition',
				label: 'Repetition',
				uniform: 'u_repetition',
				min: 1.0,
				max: 10.0,
				step: 0.01,
				default: 2
			},
			{
				name: 'shiftRed',
				label: 'Shift red',
				uniform: 'u_shiftRed',
				min: -1.0,
				max: 1.0,
				step: 0.01,
				default: 0.3
			},
			{
				name: 'shiftBlue',
				label: 'Shift blue',
				uniform: 'u_shiftBlue',
				min: -1.0,
				max: 1.0,
				step: 0.01,
				default: 0.3
			},
			{
				name: 'contour',
				label: 'Contour',
				uniform: 'u_contour',
				min: 0.0,
				max: 1.0,
				step: 0.01,
				default: 0.4
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
				name: 'angle',
				label: 'Angle',
				uniform: 'u_angle',
				min: 0.0,
				max: 360.0,
				step: 0.01,
				default: 70
			}
		]
	}
] as const satisfies readonly PaperShaderDefinition[];
