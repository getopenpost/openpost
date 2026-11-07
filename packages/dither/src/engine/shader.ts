import { readDitherCell, resolveColor, subscribeToTheme } from "./color.js";
import { withoutSharedHelpers } from "./glsl.js";
import { getThresholdMap } from "./matrices.js";
import type { DitherMatrix, ThresholdMap } from "./matrices.js";
import { createFrameLoop, prefersReducedMotion } from "./motion.js";
import type { FrameLoopState } from "./motion.js";
import { DEFAULT_PALETTE } from "./tokens.js";
import type { DitherPalette, Rgba } from "./tokens.js";

/*
 * The WebGL dither shader, adapted from dithercn's `shader.tsx` (MIT). The
 * renderer, GLSL helpers and context budget are unchanged; the React
 * component is replaced by `mountDitherShader`, a framework-free lifecycle
 * that Svelte and other adapters wrap.
 */

export type ShaderUniformValue =
  | number
  | readonly [number, number]
  | readonly [number, number, number]
  | readonly [number, number, number, number];

export type DitherUniforms = Readonly<Record<string, ShaderUniformValue>>;

export type DitherShaderState = "fallback" | "running" | "paused" | "static";

/**
 * GLSL helpers available to every field. Names starting with `u_` are
 * reserved for the core's own uniforms, and `dither_` for its helpers.
 *
 * - `float hash21(vec2 p)`: a stable pseudo-random value in [0, 1).
 * - `float snoise(vec2 p)`: 2D simplex noise in [-1, 1].
 * - `float fbm(vec2 p)`: four octaves of simplex noise, in [0, 1].
 * - `vec3 spectrum(float h)`: a saturated rainbow. 0 is red, then yellow,
 *   green, cyan, blue and magenta, back to red at 1; it wraps.
 * - `vec4 paletteColor(float x)`: the palette's ink colours, every entry
 *   after the paper, as a smooth ramp from x = 0 to 1.
 */
const GLSL_HELPERS = `
float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

vec3 dither_permute(vec3 x) {
  return mod(((x * 34.0) + 1.0) * x, 289.0);
}

float snoise(vec2 v) {
  const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
  vec2 i = floor(v + dot(v, C.yy));
  vec2 x0 = v - i + dot(i, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod(i, 289.0);
  vec3 p = dither_permute(dither_permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
  vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
  m = m * m;
  m = m * m;
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
  vec3 g;
  g.x = a0.x * x0.x + h.x * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}

float fbm(vec2 p) {
  float sum = 0.0;
  float amp = 0.5;
  mat2 rotate = mat2(0.8, -0.6, 0.6, 0.8);
  for (int i = 0; i < 4; i++) {
    sum += amp * snoise(p);
    p = rotate * p * 2.02 + vec2(11.3, 4.7);
    amp *= 0.5;
  }
  return clamp(0.5 + 0.5 * sum / 0.9375, 0.0, 1.0);
}

vec3 spectrum(float h) {
  vec3 rgb = clamp(abs(mod(fract(h) * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
  return rgb * rgb * (3.0 - 2.0 * rgb);
}

vec4 dither_paletteEntry(float index) {
  return texture2D(u_palette, vec2((index + 0.5) / u_paletteSize, 0.5));
}

vec4 paletteColor(float x) {
  float last = u_paletteSize - 1.0;
  float scaled = clamp(x, 0.0, 1.0) * (last - 1.0);
  float index = floor(scaled);
  vec4 from = dither_paletteEntry(1.0 + index);
  vec4 to = dither_paletteEntry(min(2.0 + index, last));
  return mix(from, to, scaled - index);
}

vec4 dither_rgba(vec3 color) {
  return vec4(color, 1.0);
}

vec4 dither_rgba(vec4 color) {
  return color;
}
`;

const VERTEX_SHADER = `
attribute vec2 a_position;
void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

interface UniformSpec {
  readonly name: string;
  readonly size: 1 | 2 | 3 | 4;
}

const IDENTIFIER = /^[A-Za-z][A-Za-z0-9_]*$/;
const GLSL_TYPES = { 1: "float", 2: "vec2", 3: "vec3", 4: "vec4" } as const;

const uniformSize = (value: ShaderUniformValue): UniformSpec["size"] =>
  typeof value === "number" ? 1 : value.length;

const uniformSpecs = (uniforms: DitherUniforms): UniformSpec[] =>
  Object.keys(uniforms)
    .sort()
    .flatMap((name) => {
      const value = uniforms[name];
      if (value === undefined) {
        return [];
      }
      if (!IDENTIFIER.test(name) || name.startsWith("u_")) {
        // Reserved or invalid names would break the shader; say which.
        console.error(
          `[dither-core] uniform "${name}" skipped: names must be GLSL identifiers and not start with "u_"`,
        );
        return [];
      }
      return [{ name, size: uniformSize(value) }];
    });

// With a colour field, a cell is either paper or the colour field's colour
// there, chosen by the same tone and threshold as a two-colour palette.
const PALETTE_COLOR = `
  float scaled = tone * (u_paletteSize - 1.0);
  float index = floor(scaled);
  index = min(index + step(threshold, scaled - index), u_paletteSize - 1.0);
  vec4 color = dither_paletteEntry(index);`;

const FIELD_COLOR = `
  float ink = min(floor(tone) + step(threshold, fract(tone)), 1.0);
  vec4 color = ink > 0.5
    ? dither_rgba(colorField(uv, u_resolution, u_time))
    : dither_paletteEntry(0.0);
  color = clamp(color, 0.0, 1.0);`;

const fragmentShader = (
  field: string,
  colorField: string | undefined,
  specs: readonly UniformSpec[],
) => `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

uniform vec2 u_resolution;
uniform float u_time;
uniform float u_levels;
uniform sampler2D u_thresholds;
uniform float u_matrixSize;
uniform float u_rankStep;
uniform sampler2D u_palette;
uniform float u_paletteSize;
${specs.map(({ name, size }) => `uniform ${GLSL_TYPES[size]} ${name};`).join("\n")}
${GLSL_HELPERS}
${field}
${colorField === undefined ? "" : withoutSharedHelpers(field, colorField)}

void main() {
  vec2 cell = floor(gl_FragCoord.xy);
  vec2 uv = (cell + 0.5) / u_resolution;
  float tone = clamp(field(uv, u_resolution, u_time), 0.0, 1.0);
  float steps = u_levels - 1.0;
  tone = floor(tone * steps + 0.5) / steps;

  // Ranks are stored as rank * (256 / steps), so this threshold is exactly
  // (rank + 0.5) / steps, halfway between two tones.
  vec2 at = (mod(cell, u_matrixSize) + 0.5) / u_matrixSize;
  float stored = floor(texture2D(u_thresholds, at).r * 255.0 + 0.5);
  float threshold = (stored + 0.5 * u_rankStep) / 256.0;

${colorField === undefined ? PALETTE_COLOR : FIELD_COLOR}
  gl_FragColor = vec4(color.rgb * color.a, color.a);
}
`;

interface DrawInput {
  readonly columns: number;
  readonly rows: number;
  readonly time: number;
  readonly levels: number;
  readonly uniforms: DitherUniforms;
}

interface Renderer {
  readonly setMatrix: (map: ThresholdMap) => void;
  readonly setPalette: (colors: readonly Rgba[]) => void;
  readonly draw: (input: DrawInput) => void;
  readonly dispose: () => void;
}

const compile = (gl: WebGLRenderingContext, type: GLenum, source: string) => {
  const shader = gl.createShader(type);
  if (!shader) {
    return null;
  }
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    if (!gl.isContextLost()) {
      // A broken `field` is a bug in the calling component; say why.
      const log = gl.getShaderInfoLog(shader) ?? "";
      console.error("[dither-core] shader failed to compile", log);
      if (log.includes("already has a body")) {
        console.error(
          "[dither-core] a function is defined twice. `field` and `colorField` compile into one shader: give helpers different names, or define a shared helper once, in `field`, and call it from both.",
        );
      }
    }
    gl.deleteShader(shader);
    return null;
  }
  return shader;
};

const createTexture = (gl: WebGLRenderingContext) => {
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return texture;
};

const createRenderer = (
  gl: WebGLRenderingContext,
  {
    field,
    colorField,
    specs,
  }: {
    field: string;
    colorField: string | undefined;
    specs: readonly UniformSpec[];
  },
): Renderer | null => {
  const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
  const fragment = compile(gl, gl.FRAGMENT_SHADER, fragmentShader(field, colorField, specs));
  const program = gl.createProgram();
  if (!vertex || !fragment || !program) {
    return null;
  }
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    gl.deleteProgram(program);
    return null;
  }
  gl.useProgram(program);

  // One triangle that covers the viewport.
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const position = gl.getAttribLocation(program, "a_position");
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

  const location = (name: string) => gl.getUniformLocation(program, name);
  const uResolution = location("u_resolution");
  const uTime = location("u_time");
  const uLevels = location("u_levels");
  const uMatrixSize = location("u_matrixSize");
  const uRankStep = location("u_rankStep");
  const uPaletteSize = location("u_paletteSize");
  gl.uniform1i(location("u_thresholds"), 0);
  gl.uniform1i(location("u_palette"), 1);
  const custom = specs.map((spec) => ({
    ...spec,
    location: location(spec.name),
  }));

  const thresholds = createTexture(gl);
  const palette = createTexture(gl);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);

  return {
    dispose: () => {
      gl.deleteTexture(thresholds);
      gl.deleteTexture(palette);
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
    },
    draw: ({ columns, rows, time, levels, uniforms }) => {
      gl.viewport(0, 0, columns, rows);
      gl.uniform2f(uResolution, columns, rows);
      gl.uniform1f(uTime, time);
      gl.uniform1f(uLevels, levels);
      for (const spec of custom) {
        const value = uniforms[spec.name];
        if (value === undefined) {
          continue;
        }
        if (typeof value === "number") {
          gl.uniform1f(spec.location, value);
        } else if (value.length === 2) {
          gl.uniform2f(spec.location, value[0], value[1]);
        } else if (value.length === 3) {
          gl.uniform3f(spec.location, value[0], value[1], value[2]);
        } else {
          gl.uniform4f(spec.location, value[0], value[1], value[2], value[3]);
        }
      }
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
    setMatrix: (map) => {
      const rankStep = 256 / map.steps;
      const bytes = Uint8Array.from(map.ranks, (rank) => rank * rankStep);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, thresholds);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.LUMINANCE,
        map.size,
        map.size,
        0,
        gl.LUMINANCE,
        gl.UNSIGNED_BYTE,
        bytes,
      );
      gl.uniform1f(uMatrixSize, map.size);
      gl.uniform1f(uRankStep, rankStep);
    },
    setPalette: (colors) => {
      const bytes = new Uint8Array(colors.length * 4);
      for (const [index, color] of colors.entries()) {
        bytes.set(
          color.map((channel) => Math.round(channel * 255)),
          index * 4,
        );
      }
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, palette);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        colors.length,
        1,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        bytes,
      );
      gl.uniform1f(uPaletteSize, colors.length);
    },
  };
};

/**
 * Browsers cap live WebGL contexts (Chrome drops the oldest past 16), so
 * every DitherShader on the page shares a budget. A shader holds a context
 * only while it is near the viewport. Past the budget, a shader coming on
 * screen takes the context of one just outside the viewport, seen least
 * recently first. It never takes one from a shader still on screen, so
 * scrolling doesn't flip visible shaders between canvas and fallback;
 * it waits instead, and gets the next context freed.
 */
export const MAX_LIVE_CONTEXTS = 8;

interface ContextSlot {
  near: boolean;
  onScreen: boolean;
  lastSeen: number;
  active: boolean;
  readonly setActive: (active: boolean) => void;
}

const slots = new Set<ContextSlot>();

const activate = (slot: ContextSlot, active: boolean) => {
  slot.active = active;
  slot.setActive(active);
};

const leastRecent = (candidates: Iterable<ContextSlot>) => {
  let oldest: ContextSlot | null = null;
  for (const slot of candidates) {
    if (!oldest || slot.lastSeen < oldest.lastSeen) {
      oldest = slot;
    }
  }
  return oldest;
};

const requestContext = (slot: ContextSlot) => {
  if (slot.active) {
    return;
  }
  const live = [...slots].filter((other) => other.active);
  if (live.length >= MAX_LIVE_CONTEXTS) {
    const offscreen = live.filter((other) => !other.onScreen);
    const victim = slot.onScreen ? leastRecent(offscreen) : null;
    if (!victim) {
      return;
    }
    activate(victim, false);
  }
  activate(slot, true);
};

const releaseContext = (slot: ContextSlot) => {
  if (!slot.active) {
    return;
  }
  activate(slot, false);
  // A freed context goes to the shader that waited longest, on screen first.
  const waiting = [...slots].filter((other) => other.near && !other.active);
  const onScreen = waiting.filter((other) => other.onScreen);
  const next = leastRecent(onScreen.length > 0 ? onScreen : waiting);
  if (next) {
    activate(next, true);
  }
};

const hasOnScreenWaiter = () =>
  [...slots].some((other) => other.onScreen && other.near && !other.active);

/** Holds a slot in the shared context budget while `el` is near the viewport. */
const holdContextSlot = (el: Element, setActive: (active: boolean) => void): (() => void) => {
  const slot: ContextSlot = { active: false, lastSeen: 0, near: false, onScreen: false, setActive };
  slots.add(slot);
  const nearObserver = new IntersectionObserver(
    ([entry]) => {
      slot.near = entry?.isIntersecting ?? false;
      if (slot.near) {
        slot.lastSeen = performance.now();
        requestContext(slot);
      } else {
        releaseContext(slot);
      }
    },
    { rootMargin: "200px" },
  );
  // Coming on screen can take a context from one that is only nearby, and
  // leaving the screen hands it to an on-screen shader that is waiting.
  const screenObserver = new IntersectionObserver(([entry]) => {
    slot.onScreen = entry?.isIntersecting ?? false;
    if (slot.onScreen && slot.near) {
      slot.lastSeen = performance.now();
      requestContext(slot);
    } else if (!slot.onScreen && slot.active && hasOnScreenWaiter()) {
      releaseContext(slot);
    }
  });
  nearObserver.observe(el);
  screenObserver.observe(el);
  return () => {
    nearObserver.disconnect();
    screenObserver.disconnect();
    // Leave the set first, so the freed context goes to someone else.
    slots.delete(slot);
    releaseContext(slot);
  };
};

export interface DitherShaderOptions {
  /**
   * GLSL that defines `float field(vec2 uv, vec2 res, float t)`, returning
   * the tone in [0, 1] for one cell: 0 is paper, 1 is ink. `uv` is the cell
   * centre in [0, 1] with y pointing up, `res` the size in cells, `t` the
   * time in seconds (scaled by `speed`). May define helpers too.
   */
  field: string;
  /**
   * GLSL that defines `colorField(vec2 uv, vec2 res, float t)`, returning the
   * ink colour for one cell as `vec3` or `vec4`. The field still decides where
   * dots go; cells without a dot are paper (`palette[0]`).
   */
  colorField?: string | undefined;
  /** Extra uniforms by name: numbers become `float`, tuples `vec2` to `vec4`. */
  uniforms?: DitherUniforms | undefined;
  /** Threshold matrix. Default `"bayer4"`. */
  matrix?: DitherMatrix | undefined;
  /** Tones the field snaps to before dithering, 2 to 256. */
  levels?: number | undefined;
  /** Cell size in CSS pixels. Default `--dither-cell`, or 2. */
  cell?: number | undefined;
  /** Colours from paper (tone 0) to ink (tone 1). */
  palette?: DitherPalette | undefined;
  /** Time multiplier. Default 1. */
  speed?: number | undefined;
  /** `false` stops the motion. Default `true`. */
  animate?: boolean | undefined;
  /** Frame rate cap. Default 30. */
  fps?: number | undefined;
  /** The moment shown when motion is off or reduced, in field seconds. Default 0. */
  stillTime?: number | undefined;
  /** Told when the shader changes between fallback, running, paused and static. */
  onState?: ((state: DitherShaderState) => void) | undefined;
}

export interface MountedDitherShader {
  update: (options: DitherShaderOptions) => void;
  destroy: () => void;
}

const NO_UNIFORMS: DitherUniforms = {};

const clampLevels = (levels: number) => Math.min(256, Math.max(2, Math.round(levels)));

const sameUniformShape = (a: DitherUniforms, b: DitherUniforms) =>
  uniformSpecs(a)
    .map(({ name, size }) => `${name}:${size}`)
    .join(",") ===
  uniformSpecs(b)
    .map(({ name, size }) => `${name}:${size}`)
    .join(",");

/**
 * Mount a dithered full-bleed canvas inside `root`, driven by a GLSL field.
 * One pixel per dither cell, scaled up with crisp edges. Pauses offscreen and
 * in hidden tabs, holds a still frame under reduced motion, follows the theme,
 * and reports `fallback` until a WebGL frame exists. `root` should be
 * positioned and sized; the canvas fills it.
 */
export const mountDitherShader = (
  root: HTMLElement,
  initial: DitherShaderOptions,
): MountedDitherShader => {
  let options = initial;
  let renderer: Renderer | null = null;
  let gl: WebGLRenderingContext | null = null;
  let canvas: HTMLCanvasElement | null = null;
  let columns = 0;
  let rows = 0;
  let time = options.stillTime ?? 0;
  let hasRun = false;
  let hasFrame = false;
  let loopState: FrameLoopState = "paused";
  let reported: DitherShaderState | null = null;
  let teardownCanvas: (() => void) | null = null;

  const matrix = () => getThresholdMap(options.matrix ?? "bayer4");
  const levels = () => clampLevels(options.levels ?? matrix().steps + 1);
  const palette = () => options.palette ?? DEFAULT_PALETTE;
  const resolvePalette = () => palette().map((color) => resolveColor(color, root));

  const report = () => {
    const state: DitherShaderState = hasFrame ? loopState : "fallback";
    root.dataset.state = state;
    if (state !== reported) {
      reported = state;
      options.onState?.(state);
    }
  };

  const draw = () => {
    if (!renderer || columns === 0 || rows === 0) return;
    renderer.draw({
      columns,
      levels: levels(),
      rows,
      time,
      uniforms: options.uniforms ?? NO_UNIFORMS,
    });
    if (!hasFrame) {
      hasFrame = true;
      report();
    }
  };

  const build = () => {
    if (!gl) return;
    renderer?.dispose();
    renderer = createRenderer(gl, {
      colorField: options.colorField,
      field: options.field,
      specs: uniformSpecs(options.uniforms ?? NO_UNIFORMS),
    });
    renderer?.setMatrix(matrix());
    renderer?.setPalette(resolvePalette());
  };

  const resize = () => {
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const cssCell = options.cell ?? readDitherCell(root);
    // Whole device pixels per cell, so every cell is the same size.
    const deviceCell = Math.max(1, Math.round(cssCell * dpr));
    const snapped = deviceCell / dpr;
    const style = getComputedStyle(root);
    const width = Number.parseFloat(style.width) || root.offsetWidth;
    const height = Number.parseFloat(style.height) || root.offsetHeight;
    columns = Math.max(1, Math.ceil(width / snapped));
    rows = Math.max(1, Math.ceil(height / snapped));
    canvas.width = columns;
    canvas.height = rows;
    canvas.style.width = `${columns * snapped}px`;
    canvas.style.height = `${rows * snapped}px`;
    draw();
  };

  const attach = () => {
    const next = document.createElement("canvas");
    next.dataset.ditherCanvas = "";
    const context = next.getContext("webgl", {
      alpha: true,
      antialias: false,
      depth: false,
      powerPreference: "low-power",
      premultipliedAlpha: true,
      stencil: false,
    });
    if (!context) return;
    canvas = next;
    gl = context;
    root.append(next);
    const onContextLost = (event: Event) => {
      event.preventDefault();
      renderer = null;
      hasFrame = false;
      report();
    };
    const onContextRestored = () => {
      build();
      draw();
    };
    const onTheme = () => {
      renderer?.setPalette(resolvePalette());
      draw();
    };
    build();
    resize();
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(root);
    const unsubscribe = subscribeToTheme(onTheme);
    next.addEventListener("webglcontextlost", onContextLost);
    next.addEventListener("webglcontextrestored", onContextRestored);
    teardownCanvas = () => {
      resizeObserver.disconnect();
      unsubscribe();
      next.removeEventListener("webglcontextlost", onContextLost);
      next.removeEventListener("webglcontextrestored", onContextRestored);
      renderer?.dispose();
      renderer = null;
      context.getExtension("WEBGL_lose_context")?.loseContext();
      next.remove();
      canvas = null;
      gl = null;
      hasFrame = false;
      report();
    };
  };

  const detach = () => {
    teardownCanvas?.();
    teardownCanvas = null;
  };

  const loop = createFrameLoop(
    (loopTime, delta) => {
      if (delta > 0) {
        // Accumulate so a change of `speed` never jumps the motion.
        time += delta * (options.speed ?? 1);
        hasRun = true;
      } else if (prefersReducedMotion() || !hasRun) {
        time = loopTime;
      }
      draw();
    },
    {
      enabled: options.animate ?? true,
      fps: options.fps ?? 30,
      onState: (state) => {
        loopState = state;
        report();
      },
      stillTime: options.stillTime ?? 0,
      target: root,
    },
  );

  const releaseSlot = holdContextSlot(root, (active) => (active ? attach() : detach()));
  report();

  return {
    destroy: () => {
      releaseSlot();
      loop.destroy();
      detach();
    },
    update: (next) => {
      const previous = options;
      options = next;
      if (next.stillTime !== previous.stillTime) hasRun = false;
      const rebuild =
        next.field !== previous.field ||
        next.colorField !== previous.colorField ||
        !sameUniformShape(next.uniforms ?? NO_UNIFORMS, previous.uniforms ?? NO_UNIFORMS);
      if (rebuild) build();
      else {
        if (next.matrix !== previous.matrix) renderer?.setMatrix(matrix());
        if (palette().join("|") !== (previous.palette ?? DEFAULT_PALETTE).join("|")) {
          renderer?.setPalette(resolvePalette());
        }
      }
      if (next.cell !== previous.cell) resize();
      loop.update({
        enabled: next.animate ?? true,
        fps: next.fps ?? 30,
        stillTime: next.stillTime ?? 0,
      });
      if (loopState !== "running") draw();
    },
  };
};
