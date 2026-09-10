import { getPaperShader, normalizePaperParams } from '../effects/paper/catalog';
import { DEFAULT_SHADER_BACKGROUND, isBackgroundShader } from './shaders';
import type {
	BackgroundMeshBackground,
	BackgroundPatternBackground,
	BackgroundPatternKind,
	ShaderBackground,
	ProceduralBackground
} from '../project/types';

export type { BackgroundKind, BackgroundPatternKind, ProceduralBackground } from '../project/types';

export type MeshBackgroundPatch = Partial<Omit<BackgroundMeshBackground, 'kind'>>;
export type PatternBackgroundPatch = Partial<Omit<BackgroundPatternBackground, 'kind'>>;
export type CommonBackgroundPatch = Partial<
	Pick<ProceduralBackground, 'rotation' | 'scale' | 'offsetX' | 'offsetY'>
>;
export type BackgroundPatch = MeshBackgroundPatch &
	PatternBackgroundPatch &
	Partial<Omit<ShaderBackground, 'kind'>>;

export const BACKGROUND_KINDS = ['mesh-gradient', 'pattern', 'shader'] as const;
export const PATTERN_KINDS = ['dots', 'grid', 'stripes', 'checker'] as const;

export const DEFAULT_MESH_BACKGROUND: ProceduralBackground = {
	kind: 'mesh-gradient',
	colors: ['#ff7a18', '#af002d', '#319197', '#1a1a2e'],
	smoothness: 0.55,
	rotation: 0,
	scale: 1,
	offsetX: 0,
	offsetY: 0
};

export const DEFAULT_PATTERN_BACKGROUND: ProceduralBackground = {
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
};

export function isHexColor(value: string): boolean {
	return /^#[0-9a-fA-F]{6}$/.test(value);
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

function isPatternKind(value: string): value is BackgroundPatternKind {
	return value === 'dots' || value === 'grid' || value === 'stripes' || value === 'checker';
}

function toMeshColors(input: readonly string[] | undefined): [string, string, string, string] {
	const fallback = DEFAULT_MESH_BACKGROUND.colors;
	const source = input ?? fallback;
	const sanitized: string[] = [];
	for (let i = 0; i < 4; i++) {
		const candidate = source[i] ?? fallback[i] ?? '#000000';
		sanitized.push(isHexColor(candidate) ? candidate : '#000000');
	}
	return [sanitized[0]!, sanitized[1]!, sanitized[2]!, sanitized[3]!];
}

export function clampBackground(value: ProceduralBackground): ProceduralBackground {
	if (value.kind === 'shader') {
		const shader = isBackgroundShader(value.shader) ? value.shader : 'mesh';
		const paper = shader.startsWith('paper:') ? getPaperShader(shader.slice(6)) : undefined;
		const background: ShaderBackground = {
			kind: 'shader',
			shader,
			colors: toMeshColors(value.colors),
			speed: clamp(Number.isFinite(value.speed) ? value.speed : 0.5, 0, 3),
			phase: clamp(Number.isFinite(value.phase) ? value.phase : 0, 0, 60),
			detail: clamp(Number.isFinite(value.detail) ? value.detail : 0.5, 0, 1),
			rotation: clamp(Number.isFinite(value.rotation) ? value.rotation : 0, -360, 360),
			scale: clamp(Number.isFinite(value.scale) ? value.scale : 1, 0.25, 4),
			offsetX: clamp(Number.isFinite(value.offsetX) ? value.offsetX : 0, -1, 1),
			offsetY: clamp(Number.isFinite(value.offsetY) ? value.offsetY : 0, -1, 1)
		};
		if (paper) background.parameters = normalizePaperParams(paper, value.parameters);
		return background;
	}
	if (value.kind === 'mesh-gradient') {
		return {
			kind: 'mesh-gradient',
			colors: toMeshColors(value.colors),
			smoothness: clamp(Number.isFinite(value.smoothness) ? value.smoothness : 0.55, 0, 1),
			rotation: clamp(Number.isFinite(value.rotation) ? value.rotation : 0, -360, 360),
			scale: clamp(Number.isFinite(value.scale) ? value.scale : 1, 0.25, 4),
			offsetX: clamp(Number.isFinite(value.offsetX) ? value.offsetX : 0, -0.5, 0.5),
			offsetY: clamp(Number.isFinite(value.offsetY) ? value.offsetY : 0, -0.5, 0.5)
		};
	}
	return {
		kind: 'pattern',
		pattern: isPatternKind(value.pattern) ? value.pattern : 'dots',
		foreground: isHexColor(value.foreground) ? value.foreground : '#ffffff',
		background: isHexColor(value.background) ? value.background : '#000000',
		scale: clamp(Number.isFinite(value.scale) ? value.scale : 1, 0.25, 4),
		rotation: clamp(Number.isFinite(value.rotation) ? value.rotation : 0, -360, 360),
		offsetX: clamp(Number.isFinite(value.offsetX) ? value.offsetX : 0, -0.5, 0.5),
		offsetY: clamp(Number.isFinite(value.offsetY) ? value.offsetY : 0, -0.5, 0.5),
		density: clamp(Number.isFinite(value.density) ? value.density : 0.5, 0.05, 1),
		foregroundOpacity: clamp(
			Number.isFinite(value.foregroundOpacity) ? value.foregroundOpacity : 1,
			0,
			1
		)
	};
}

export function cloneBackground(value: ProceduralBackground): ProceduralBackground {
	return structuredClone(clampBackground(value));
}

export function createDefaultBackground(
	kind: ProceduralBackground['kind'] = 'mesh-gradient'
): ProceduralBackground {
	if (kind === 'shader') return cloneBackground(DEFAULT_SHADER_BACKGROUND);
	return cloneBackground(kind === 'pattern' ? DEFAULT_PATTERN_BACKGROUND : DEFAULT_MESH_BACKGROUND);
}
