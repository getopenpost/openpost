/**
 * Shared GLSL chunks for the WebGL2 effect pipeline.
 *
 * Ported from FreeCut (MIT) — infrastructure/gpu-effects/common.ts,
 * infrastructure/gpu-shared/fullscreen-quad.ts, and
 * infrastructure/gpu-shared/blend-modes.ts — with one mechanical adaptation:
 * the WGSL sources are translated to GLSL ES 3.00 (WebGL2), keeping the math
 * and structure verbatim. Shader bodies in shaders/*.ts follow the same rules:
 *
 *   vecNf / vecNi  -> vecN / ivecN        f32/i32/u32 -> float/int/uint
 *   textureSample(t,s,uv)        -> texture(uInputTex, uv)
 *   textureSampleLevel(t,s,uv,l) -> textureLod(uInputTex, uv, l)
 *   textureLoad(inputTex,c,0)    -> texelFetch(uInputTex, c, 0)
 *   select(f, t, cond)           -> (cond ? t : f)
 *   atan2(y,x)                   -> atan(y, x)
 *   input.uv                     -> vUv
 *   input.position.y             -> gl_FragCoord.y
 *   params.<field>               -> u_<field> (individual float uniforms fed
 *                                   from each definition's uniformValues;
 *                                   FreeCut's std140 uniform blocks are not
 *                                   needed at our stack sizes)
 */

/**
 * Fullscreen-quad vertex stage; port of FULLSCREEN_QUAD_WGSL. WebGL2 NDC is
 * y-up while WebGPU's is y-down, so the UV table flips to keep FreeCut's
 * top-left UV-origin contract for fragment code.
 */
export const FULLSCREEN_VERTEX_GLSL = `#version 300 es
out vec2 vUv;
void main() {
  vec2 positions[6] = vec2[6](
    vec2(-1.0, -1.0),
    vec2(1.0, -1.0),
    vec2(-1.0, 1.0),
    vec2(-1.0, 1.0),
    vec2(1.0, -1.0),
    vec2(1.0, 1.0)
  );
  vec2 uvs[6] = vec2[6](
    vec2(0.0, 0.0),
    vec2(1.0, 0.0),
    vec2(0.0, 1.0),
    vec2(0.0, 1.0),
    vec2(1.0, 0.0),
    vec2(1.0, 1.0)
  );
  int i = gl_VertexID;
  gl_Position = vec4(positions[i], 0.0, 1.0);
  vUv = uvs[i];
}
`;

/** Port of COMMON_WGSL — every helper verbatim. */
export const EFFECT_COMMON_GLSL = /* glsl */ `
vec3 rgb2hsv(vec3 c) {
  vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
  float d = q.x - min(q.w, q.y);
  float e = 1.0e-10;
  return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}

vec3 hsv2rgb(vec3 c) {
  vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, vec3(0.0), vec3(1.0)), c.y);
}

vec3 rgb2hsl(vec3 c) {
  float maxC = max(max(c.r, c.g), c.b);
  float minC = min(min(c.r, c.g), c.b);
  float l = (maxC + minC) * 0.5;
  if (maxC == minC) { return vec3(0.0, 0.0, l); }
  float d = maxC - minC;
  float s = (l > 0.5) ? d / (2.0 - maxC - minC) : d / (maxC + minC);
  float h;
  if (maxC == c.r) {
    h = (c.g - c.b) / d + ((c.g < c.b) ? 6.0 : 0.0);
  } else if (maxC == c.g) {
    h = (c.b - c.r) / d + 2.0;
  } else {
    h = (c.r - c.g) / d + 4.0;
  }
  h /= 6.0;
  return vec3(h, s, l);
}

float hue2rgb(float p, float q, float t) {
  if (t < 0.0) { t += 1.0; }
  if (t > 1.0) { t -= 1.0; }
  if (t < 1.0 / 6.0) { return p + (q - p) * 6.0 * t; }
  if (t < 1.0 / 2.0) { return q; }
  if (t < 2.0 / 3.0) { return p + (q - p) * (2.0 / 3.0 - t) * 6.0; }
  return p;
}

vec3 hsl2rgb(vec3 c) {
  if (c.y == 0.0) { return vec3(c.z); }
  float q = (c.z < 0.5) ? c.z * (1.0 + c.y) : c.z + c.y - c.z * c.y;
  float p = 2.0 * c.z - q;
  return vec3(
    hue2rgb(p, q, c.x + 1.0 / 3.0),
    hue2rgb(p, q, c.x),
    hue2rgb(p, q, c.x - 1.0 / 3.0)
  );
}

float luminance(vec3 c) {
  return dot(c, vec3(0.2126, 0.7152, 0.0722));
}

float luminance601(vec3 c) {
  return dot(c, vec3(0.299, 0.587, 0.114));
}

const float PI = 3.14159265359;
const float TAU = 6.28318530718;
const float E = 2.71828182846;

float gaussian(float x, float sigma) {
  return exp(-(x * x) / (2.0 * sigma * sigma));
}

float smootherstep(float edge0, float edge1, float x) {
  float t = clamp((x - edge0) / (edge1 - edge0), 0.0, 1.0);
  return t * t * t * (t * (t * 6.0 - 15.0) + 10.0);
}

float hash(vec2 p) {
  vec2 p2 = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
  return fract(sin(dot(p2, vec2(12.9898, 78.233))) * 43758.5453);
}

float noise2d(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i + vec2(0.0, 0.0)), hash(i + vec2(1.0, 0.0)), u.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}
`;

/**
 * Blend mode functions for the compositor shader: 25 blend modes matching the
 * BlendMode TypeScript type, operating on straight RGB [0..1].
 * Port of BLEND_MODES_WGSL — math verbatim.
 */
export const BLEND_MODES_GLSL = /* glsl */ `
// ─── HSL helpers (needed for component blend modes) ───

vec3 compositor_rgb2hsl(vec3 c) {
  float mx = max(max(c.r, c.g), c.b);
  float mn = min(min(c.r, c.g), c.b);
  float l = (mx + mn) * 0.5;
  if (mx == mn) { return vec3(0.0, 0.0, l); }
  float d = mx - mn;
  float s = (l > 0.5) ? d / (2.0 - mx - mn) : d / (mx + mn);
  float h;
  if (mx == c.r) {
    h = (c.g - c.b) / d + ((c.g < c.b) ? 6.0 : 0.0);
  } else if (mx == c.g) {
    h = (c.b - c.r) / d + 2.0;
  } else {
    h = (c.r - c.g) / d + 4.0;
  }
  h /= 6.0;
  return vec3(h, s, l);
}

float compositor_hue2rgb(float p, float q, float t) {
  if (t < 0.0) { t += 1.0; }
  if (t > 1.0) { t -= 1.0; }
  if (t < 1.0 / 6.0) { return p + (q - p) * 6.0 * t; }
  if (t < 1.0 / 2.0) { return q; }
  if (t < 2.0 / 3.0) { return p + (q - p) * (2.0 / 3.0 - t) * 6.0; }
  return p;
}

vec3 compositor_hsl2rgb(vec3 c) {
  if (c.y == 0.0) { return vec3(c.z); }
  float q = (c.z < 0.5) ? c.z * (1.0 + c.y) : c.z + c.y - c.z * c.y;
  float p = 2.0 * c.z - q;
  return vec3(
    compositor_hue2rgb(p, q, c.x + 1.0 / 3.0),
    compositor_hue2rgb(p, q, c.x),
    compositor_hue2rgb(p, q, c.x - 1.0 / 3.0)
  );
}

float compositor_lum(vec3 c) {
  return dot(c, vec3(0.3, 0.59, 0.11));
}

vec3 compositor_setLum(vec3 c, float l) {
  float d = l - compositor_lum(c);
  vec3 r = c + vec3(d);
  float mn = min(min(r.r, r.g), r.b);
  float mx = max(max(r.r, r.g), r.b);
  float ll = compositor_lum(r);
  if (mn < 0.0) {
    r = vec3(ll) + (r - vec3(ll)) * ll / (ll - mn);
  }
  if (mx > 1.0) {
    r = vec3(ll) + (r - vec3(ll)) * (1.0 - ll) / (mx - ll);
  }
  return r;
}

// ─── Blend mode implementations ───

vec3 blendNormal(vec3 base, vec3 layer) { return layer; }

vec3 blendDarken(vec3 base, vec3 layer) { return min(base, layer); }
vec3 blendMultiply(vec3 base, vec3 layer) { return base * layer; }
vec3 blendColorBurn(vec3 base, vec3 layer) {
  vec3 burned = 1.0 - min(vec3(1.0), (1.0 - base) / max(layer, vec3(0.001)));
  return mix(burned, vec3(0.0), equal(layer, vec3(0.0)));
}
vec3 blendLinearBurn(vec3 base, vec3 layer) { return max(base + layer - 1.0, vec3(0.0)); }

vec3 blendLighten(vec3 base, vec3 layer) { return max(base, layer); }
vec3 blendScreen(vec3 base, vec3 layer) { return 1.0 - (1.0 - base) * (1.0 - layer); }
vec3 blendColorDodge(vec3 base, vec3 layer) {
  vec3 dodged = min(vec3(1.0), base / max(1.0 - layer, vec3(0.001)));
  return mix(dodged, vec3(1.0), equal(layer, vec3(1.0)));
}
vec3 blendLinearDodge(vec3 base, vec3 layer) { return min(base + layer, vec3(1.0)); }

vec3 blendOverlay(vec3 base, vec3 layer) {
  vec3 low = 2.0 * base * layer;
  vec3 high = 1.0 - 2.0 * (1.0 - base) * (1.0 - layer);
  return mix(high, low, lessThanEqual(base, vec3(0.5)));
}
vec3 blendSoftLight(vec3 base, vec3 layer) {
  vec3 low = base - (1.0 - 2.0 * layer) * base * (1.0 - base);
  vec3 high = base + (2.0 * layer - 1.0) * (sqrt(base) - base);
  return mix(high, low, lessThanEqual(layer, vec3(0.5)));
}
vec3 blendHardLight(vec3 base, vec3 layer) {
  vec3 low = 2.0 * base * layer;
  vec3 high = 1.0 - 2.0 * (1.0 - base) * (1.0 - layer);
  return mix(high, low, lessThanEqual(layer, vec3(0.5)));
}
vec3 blendVividLight(vec3 base, vec3 layer) {
  vec3 low = blendColorBurn(base, 2.0 * layer);
  vec3 high = blendColorDodge(base, 2.0 * (layer - 0.5));
  return mix(high, low, lessThanEqual(layer, vec3(0.5)));
}
vec3 blendLinearLight(vec3 base, vec3 layer) {
  return clamp(base + 2.0 * layer - 1.0, vec3(0.0), vec3(1.0));
}
vec3 blendPinLight(vec3 base, vec3 layer) {
  vec3 low = min(base, 2.0 * layer);
  vec3 high = max(base, 2.0 * (layer - 0.5));
  return mix(high, low, lessThanEqual(layer, vec3(0.5)));
}
vec3 blendHardMix(vec3 base, vec3 layer) {
  return mix(vec3(0.0), vec3(1.0), greaterThanEqual(base + layer, vec3(1.0)));
}

vec3 blendDifference(vec3 base, vec3 layer) { return abs(base - layer); }
vec3 blendExclusion(vec3 base, vec3 layer) { return base + layer - 2.0 * base * layer; }
vec3 blendSubtract(vec3 base, vec3 layer) { return max(base - layer, vec3(0.0)); }
vec3 blendDivide(vec3 base, vec3 layer) { return min(base / max(layer, vec3(0.001)), vec3(1.0)); }

vec3 blendHue(vec3 base, vec3 layer) {
  vec3 bHsl = compositor_rgb2hsl(base);
  vec3 lHsl = compositor_rgb2hsl(layer);
  return compositor_hsl2rgb(vec3(lHsl.x, bHsl.y, bHsl.z));
}
vec3 blendSaturation(vec3 base, vec3 layer) {
  vec3 bHsl = compositor_rgb2hsl(base);
  vec3 lHsl = compositor_rgb2hsl(layer);
  return compositor_hsl2rgb(vec3(bHsl.x, lHsl.y, bHsl.z));
}
vec3 blendColor(vec3 base, vec3 layer) {
  vec3 lHsl = compositor_rgb2hsl(layer);
  float bL = compositor_lum(base);
  return compositor_setLum(compositor_hsl2rgb(vec3(lHsl.x, lHsl.y, 0.5)), bL);
}
vec3 blendLuminosity(vec3 base, vec3 layer) {
  return compositor_setLum(base, compositor_lum(layer));
}

// ─── Dispatch by mode index ───

vec3 applyBlendMode(vec3 base, vec3 layer, int mode) {
  switch (mode) {
    case 0:  { return blendNormal(base, layer); }
    case 1:  { return blendNormal(base, layer); } // dissolve handled by caller
    case 2:  { return blendDarken(base, layer); }
    case 3:  { return blendMultiply(base, layer); }
    case 4:  { return blendColorBurn(base, layer); }
    case 5:  { return blendLinearBurn(base, layer); }
    case 6:  { return blendLighten(base, layer); }
    case 7:  { return blendScreen(base, layer); }
    case 8:  { return blendColorDodge(base, layer); }
    case 9:  { return blendLinearDodge(base, layer); }
    case 10: { return blendOverlay(base, layer); }
    case 11: { return blendSoftLight(base, layer); }
    case 12: { return blendHardLight(base, layer); }
    case 13: { return blendVividLight(base, layer); }
    case 14: { return blendLinearLight(base, layer); }
    case 15: { return blendPinLight(base, layer); }
    case 16: { return blendHardMix(base, layer); }
    case 17: { return blendDifference(base, layer); }
    case 18: { return blendExclusion(base, layer); }
    case 19: { return blendSubtract(base, layer); }
    case 20: { return blendDivide(base, layer); }
    case 21: { return blendHue(base, layer); }
    case 22: { return blendSaturation(base, layer); }
    case 23: { return blendColor(base, layer); }
    case 24: { return blendLuminosity(base, layer); }
    default: { return blendNormal(base, layer); }
  }
}

float compositorHash21(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  vec3 q = p3 + dot(p3, p3.yzx + vec3(33.33));
  return fract((q.x + q.y) * q.z);
}

float compositeDissolveAlpha(float alpha, vec2 seed) {
  return compositorHash21(seed) < alpha ? 1.0 : 0.0;
}

vec4 compositeBlendSourceOver(
  vec4 baseColor,
  vec4 layerColor,
  float sourceAlpha,
  float postDissolveAlpha,
  int mode,
  vec2 seed,
  float dissolveAlpha
) {
  float srcAlpha = clamp(sourceAlpha, 0.0, 1.0);
  if (mode == 1) {
    float ditherAlpha = clamp(dissolveAlpha, 0.0, 1.0);
    float coverage = compositeDissolveAlpha(ditherAlpha, seed);
    srcAlpha = coverage * clamp(srcAlpha / max(ditherAlpha, 0.00001), 0.0, 1.0);
  }
  srcAlpha *= clamp(postDissolveAlpha, 0.0, 1.0);
  if (srcAlpha <= 0.0) {
    return baseColor;
  }

  float baseAlpha = clamp(baseColor.a, 0.0, 1.0);
  vec3 blended = applyBlendMode(baseColor.rgb, layerColor.rgb, mode);
  vec3 premulRgb =
    blended * baseAlpha * srcAlpha +
    layerColor.rgb * srcAlpha * (1.0 - baseAlpha) +
    baseColor.rgb * baseAlpha * (1.0 - srcAlpha);
  float outAlpha = srcAlpha + baseAlpha * (1.0 - srcAlpha);
  vec3 outRgb = (outAlpha > 0.00001) ? premulRgb / max(outAlpha, 0.00001) : vec3(0.0);
  return vec4(outRgb, outAlpha);
}
`;
