import { BACKGROUND_SHADERS, getPaperShader, paperDefaultParams } from '../effects/paper/catalog';
import type { BackgroundShader, ShaderBackground } from '../project/types';

export interface ShaderPreset {
	id: string;
	label: string;
	background: ShaderBackground;
}

function preset(
	id: string,
	label: string,
	shader: BackgroundShader,
	colors: ShaderBackground['colors'],
	detail: number,
	speed = 0.5
): ShaderPreset {
	return {
		id,
		label,
		background: {
			kind: 'shader',
			shader,
			colors,
			detail,
			speed,
			phase: 0,
			rotation: 0,
			scale: 1,
			offsetX: 0,
			offsetY: 0
		}
	};
}

export const SHADER_PRESETS: readonly ShaderPreset[] = [
	preset('shader-aurora', 'Aurora', 'mesh', ['#183b70', '#39c6ad', '#a5e8ce', '#37308c'], 0.7),
	preset('shader-dusk', 'Dusk', 'mesh', ['#e35c45', '#e7a269', '#843e78', '#252b64'], 0.45),
	preset(
		'shader-ribbons',
		'Ribbons',
		'swirl',
		['#f4a261', '#e76f51', '#773b77', '#1c1936'],
		0.65,
		0.3
	),
	preset(
		'shader-mono',
		'Monochrome',
		'swirl',
		['#eeeeee', '#888888', '#393939', '#111111'],
		0.3,
		0.25
	),
	preset(
		'shader-clouds',
		'Clouds',
		'clouds',
		['#a8c8ef', '#192b4b', '#ffffff', '#000000'],
		0.65,
		0.4
	),
	preset(
		'shader-neural',
		'Neural',
		'neural',
		['#8fd9e8', '#306ac3', '#091327', '#000000'],
		0.55,
		0.35
	),
	...BACKGROUND_SHADERS.map(
		(shader): ShaderPreset => ({
			id: `shader-paper-${shader.id}`,
			label: shader.label,
			background: {
				kind: 'shader',
				shader: `paper:${shader.id}`,
				parameters: paperDefaultParams(shader),
				colors: ['#000000', '#000000', '#000000', '#000000'],
				detail: 0,
				speed: shader.sizing.speed,
				phase: 0,
				scale: shader.sizing.scale,
				rotation: shader.sizing.rotation,
				offsetX: shader.sizing.offsetX,
				offsetY: shader.sizing.offsetY
			}
		})
	)
];

export const DEFAULT_SHADER_BACKGROUND = SHADER_PRESETS[0]!.background;

export function isBackgroundShader(value: string): value is BackgroundShader {
	return (
		value === 'mesh' ||
		value === 'swirl' ||
		value === 'clouds' ||
		value === 'neural' ||
		(typeof value === 'string' &&
			value.startsWith('paper:') &&
			getPaperShader(value.slice(6))?.category === 'background')
	);
}

export function shaderColorCount(shader: BackgroundShader): number {
	if (shader === 'clouds') return 2;
	if (shader === 'neural') return 3;
	return 4;
}

/** Sequence time keeps a cut continuous and makes seeking independent of render order. */
export function shaderTime(background: ShaderBackground, seconds: number): number {
	return background.phase + Math.max(0, seconds) * background.speed;
}
