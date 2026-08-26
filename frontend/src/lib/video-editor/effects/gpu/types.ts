/**
 * GPU effect pipeline model.
 *
 * Ported from FreeCut (MIT) — infrastructure/gpu-effects/types.ts — adapted
 * from WebGPU/WGSL to our WebGL2 compositor: each definition carries a GLSL
 * ES 3.00 fragment source or point-scatter vertex source, a typed param schema
 * for generic UI, and a resolver that maps stored params plus frame context to
 * individual float uniforms.
 */

export type GpuEffectCategory = 'color' | 'blur' | 'distort' | 'stylize' | 'keying';

/** Named owner contract for open param/uniform dictionaries. */
export type GpuParamValue = number | string | boolean;
export type GpuParamValues = Record<string, GpuParamValue>;
export type GpuUniformValues = Record<string, number>;

interface GpuParamSchemaBase {
	name: string;
	label: string;
	visibleWhen?: (params: GpuParamValues) => boolean;
}

/** One user-facing numeric slider. Omitted `type` keeps older definitions terse. */
export interface GpuNumberParamSchema extends GpuParamSchemaBase {
	type?: 'number';
	min: number;
	max: number;
	step: number;
	default: number;
}

export interface GpuBooleanParamSchema extends GpuParamSchemaBase {
	type: 'boolean';
	default: boolean;
}

export interface GpuSelectParamSchema extends GpuParamSchemaBase {
	type: 'select';
	default: string;
	options: readonly { value: string; label: string }[];
}

export interface GpuColorParamSchema extends GpuParamSchemaBase {
	type: 'color';
	default: string;
}

export interface GpuTextParamSchema extends GpuParamSchemaBase {
	type: 'text';
	default: string;
	maxLength?: number;
}

export type GpuParamSchema =
	| GpuNumberParamSchema
	| GpuBooleanParamSchema
	| GpuSelectParamSchema
	| GpuColorParamSchema
	| GpuTextParamSchema;

/**
 * Auxiliary CPU-built texture bound alongside the input (e.g. a 256x1 LUT).
 * Port of EffectDataTextureSpec for curves, imported LUTs, and glyph atlases.
 */
export interface GpuDataTextureSpec {
	/** Cheap change-detection key derived from params. */
	key: (params: GpuParamValues) => string;
	/** Dimension of the auxiliary texture; 2D by default for existing specs. */
	dimension?: '2d' | '3d';
	build: (params: GpuParamValues) => {
		width: number;
		height: number;
		depth?: number;
		data: Uint8Array;
	};
}

export interface GpuShaderDefinition {
	id: string;
	label: string;
	category: GpuEffectCategory;
	/** Fragment entry function name inside `fragmentSource`. */
	entryPoint: string;
	/**
	 * GLSL ES 3.00 fragment body: declares its own uniforms (`u_*` floats),
	 * may use the shared helpers from EFFECT_COMMON_GLSL, and defines
	 * `vec4 <entryPoint>(vec2 vUv)`.
	 */
	fragmentSource: string;
	/**
	 * Optional point-scatter vertex body for effects that must write each input
	 * texel to a different output coordinate. The entry function receives
	 * gl_VertexID and returns the source color plus an exact destination texel.
	 */
	scatterVertexSource?: string;
	scatterEntryPoint?: string;
	schema: readonly GpuParamSchema[];
	/**
	 * Map stored params (+ frame width/height/time in seconds) to uniform
	 * values. Port of FreeCut's packUniforms, expanded to named uniforms.
	 */
	uniformValues: (
		params: GpuParamValues,
		width: number,
		height: number,
		time: number
	) => GpuUniformValues;
	dataTexture?: GpuDataTextureSpec;
}

/** Clamp a stored param into its schema range; NaN falls back to the schema
 * default so corrupt project files can never produce NaN frames (±Infinity
 * clamps to the nearest bound). */
export function clampGpuParam(param: GpuNumberParamSchema, value: number): number {
	if (Number.isNaN(value)) return param.default;
	return Math.min(param.max, Math.max(param.min, value));
}

/** Validate one editor value against its schema before it enters project state. */
export function normalizeGpuParam(param: GpuParamSchema, value: GpuParamValue): GpuParamValue {
	if (!param.type || param.type === 'number') {
		return clampGpuParam(param, typeof value === 'number' ? value : Number.NaN);
	}
	if (param.type === 'boolean') return value === true;
	if (param.type === 'select') {
		return typeof value === 'string' && param.options.some((option) => option.value === value)
			? value
			: param.default;
	}
	if (param.type === 'color') {
		return typeof value === 'string' && /^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i.test(value)
			? value
			: param.default;
	}
	if (param.type === 'text') {
		const text = typeof value === 'string' ? value : param.default;
		return param.maxLength === undefined ? text : [...text].slice(0, param.maxLength).join('');
	}
	return param.default;
}

/** Build the default param record for a schema. */
export function defaultGpuParams(schema: readonly GpuParamSchema[]): GpuParamValues {
	return Object.fromEntries(schema.map((param) => [param.name, param.default]));
}

/** Read a numeric param with fallback; port of readNumberParam. */
export function readNumber(params: GpuParamValues, key: string, fallback: number): number {
	const value = params[key];
	return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Parse #rgb/#rgba/#rrggbb/#rrggbbaa into normalized RGBA; port of parseHexColor. */
export function parseHexColor(
	color: string,
	fallback: [number, number, number, number]
): [number, number, number, number] {
	if (!color.startsWith('#')) return fallback;

	const hex = color.slice(1);
	if (hex.length === 3 || hex.length === 4) {
		const values = hex.split('').map((ch) => parseInt(ch + ch, 16) / 255);
		if (values.slice(0, 3).every((v) => Number.isFinite(v))) {
			return [
				values[0] ?? fallback[0],
				values[1] ?? fallback[1],
				values[2] ?? fallback[2],
				values[3] ?? 1
			];
		}
		return fallback;
	}

	if (hex.length === 6 || hex.length === 8) {
		const values = [
			parseInt(hex.slice(0, 2), 16) / 255,
			parseInt(hex.slice(2, 4), 16) / 255,
			parseInt(hex.slice(4, 6), 16) / 255,
			hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1
		];
		if (values.every((value) => Number.isFinite(value))) {
			// SAFETY: every entry was checked with Number.isFinite directly above,
			// so the four numbers form a valid RGBA tuple.
			return values as [number, number, number, number];
		}
	}

	return fallback;
}
