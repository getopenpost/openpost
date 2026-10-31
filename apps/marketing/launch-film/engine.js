// The film's renderer: WebGL2 with live DOM surfaces (HTML-in-Canvas) placed on real geometry.
// One accumulation buffer resolves motion blur, depth of field and anti-aliasing together: every
// output frame averages `samples` renders across the shutter, jittered over a lens disc and a pixel.
export const WIDTH = 1920;
export const HEIGHT = 1080;
const MAX_DROPS = 48;
const STRIDE = 36;

const FULL_VERT = `#version 300 es
out vec2 vUv;
void main() {
	vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
	vUv = p;
	gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const COMMON = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
layout(std140) uniform Frame {
	mat4 uVP;
	mat4 uInvVP;
	vec4 uEye;
	vec4 uSun;
	vec4 uSunColor;
	vec4 uSkyTop;
	vec4 uSkyHorizon;
	vec4 uDeep;
	vec4 uUnderTop;
	vec4 uUnderDeep;
	vec4 uWave;
	vec4 uFlags;
	vec4 uShadow;
	vec4 uGlowDir[4];
	vec4 uGlowCol[4];
	vec4 uDrops[${MAX_DROPS}];
};
#define TIME uEye.w
#define PI 3.14159265
float bayer8(ivec2 p) {
	int x = p.x & 7, y = p.y & 7, c = x ^ y;
	int v = ((c & 1) << 5) | ((y & 1) << 4) | ((c & 2) << 2) | ((y & 2) << 1) | ((c & 4) >> 1) | ((y & 4) >> 2);
	return (float(v) + 0.5) / 64.0;
}
float hash12(vec2 p) {
	vec3 q = fract(vec3(p.xyx) * 0.1031);
	q += dot(q, q.yzx + 33.33);
	return fract((q.x + q.y) * q.z);
}
float vnoise(vec2 p) {
	vec2 i = floor(p), f = fract(p);
	f = f * f * (3.0 - 2.0 * f);
	return mix(mix(hash12(i), hash12(i + vec2(1, 0)), f.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), f.x), f.y);
}
// Soft gradient glows live on the sky dome, so they drift with camera parallax and reflect in the water.
float glowAmount(vec3 rd, int i) {
	return clamp(uGlowCol[i].a * pow(max(dot(rd, uGlowDir[i].xyz), 0.0), uGlowDir[i].w), 0.0, 1.0);
}
vec3 glowField(vec3 rd) {
	vec3 sum = vec3(0.0);
	for (int i = 0; i < 4; i++) sum += uGlowCol[i].rgb * glowAmount(rd, i);
	return sum;
}
vec3 skyBase(vec3 rd) {
	float h = clamp(rd.y * uSkyTop.w + 0.5, 0.0, 1.0);
	return mix(uSkyHorizon.rgb, uSkyTop.rgb, h * h * (3.0 - 2.0 * h));
}
vec3 sky(vec3 rd) {
	vec3 c = skyBase(rd);
	for (int i = 0; i < 4; i++) c = mix(c, uGlowCol[i].rgb, glowAmount(rd, i));
	return c;
}
float swell(vec2 p) {
	float a = uWave.x, l = uWave.y, T = TIME;
	if (a <= 0.001 && uFlags.w <= 0.5) return 0.0;
	float h = sin((p.x * 0.8 + p.y * 0.6) / l + T * 0.9) * 0.55;
	h += sin((p.x * -0.5 + p.y * 0.86) / (l * 0.61) + T * 1.3) * 0.28;
	h += sin((p.x * 0.3 + p.y * -0.95) / (l * 0.37) + T * 1.9) * 0.17;
	h *= a;
	if (uFlags.w > 0.5) {
		float z = (p.y - uWave.z) / 520.0;
		float cross = 1.0 + 0.08 * sin(p.x * 0.0021 + T);
		h += uFlags.w * exp(-z * z) * cross;
	}
	return h;
}
float ripples(vec2 p) {
	float h = 0.0;
	int n = int(uFlags.y);
	for (int i = 0; i < n; i++) {
		vec4 d = uDrops[i];
		float age = TIME - d.z;
		if (age <= 0.0 || age > 5.0) continue;
		float r = length(p - d.xy);
		float x = (r - age * uSunColor.w) / (uWave.w * (1.0 + age * 0.5));
		if (abs(x) > 4.0) continue;
		float front = exp(-x * x * 0.6) * cos(x * 3.4);
		h += d.w * front * exp(-age * 1.1) / (1.0 + r * 0.004);
	}
	return h;
}
float waveHeight(vec2 p) {
	return swell(p) + ripples(p);
}
vec3 waveNormal(vec2 p, float e) {
	float h = waveHeight(p);
	return normalize(vec3(h - waveHeight(p + vec2(e, 0.0)), e, h - waveHeight(p + vec2(0.0, e))));
}
`;

const SCENE_FRAG = `${COMMON}
in vec2 vUv;
out vec4 o;
uniform sampler2D uReflect;
uniform sampler2D uShadowMap;
float shadowAt(vec2 xz) {
	vec2 uv = (xz - uShadow.xy) / (uShadow.z * 2.0) + 0.5;
	if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return 0.0;
	return texture(uShadowMap, uv).r * uShadow.w;
}
vec4 blurredReflect(vec2 uv, float spread) {
	vec4 c = texture(uReflect, uv) * 0.28;
	for (int i = 0; i < 6; i++) {
		float a = float(i) * 1.047 + 0.4;
		c += texture(uReflect, uv + vec2(cos(a), sin(a)) * spread) * 0.12;
	}
	return c;
}
void main() {
	vec2 ndc = vUv * 2.0 - 1.0;
	vec4 farP = uInvVP * vec4(ndc, 1.0, 1.0);
	vec3 ro = uEye.xyz;
	vec3 rd = normalize(farP.xyz / farP.w - ro);
	float eyeH = waveHeight(ro.xz);
	bool under = ro.y < eyeH;
	vec3 col;
	float depth = 1.0;
	if (under) {
		float up = rd.y * 0.5 + 0.5;
		col = mix(uUnderDeep.rgb, uUnderTop.rgb, pow(up, 2.4));
		if (rd.y > 0.0) {
			float t = (eyeH - ro.y) / rd.y;
			vec3 p = ro + rd * t;
			vec3 n = waveNormal(p.xz, 6.0);
			vec3 tilt = normalize(rd + vec3(n.x, 0.0, n.z) * 1.6);
			float win = smoothstep(0.62, 0.86, tilt.y);
			float dance = 0.75 + 0.5 * vnoise(p.xz * 0.012 + TIME * 0.5) * vnoise(p.xz * 0.03 - TIME * 0.4);
			float near = exp(-t * 0.0009);
			col += mix(uUnderTop.rgb, vec3(1.0, 0.96, 0.88), near) * win * dance * mix(1.1, 2.4, near);
		}
	} else if (rd.y < -0.0005 || uFlags.w > 0.5) {
		float t = 0.0;
		if (uFlags.w > 0.5) {
			// The wall of water is steep: march it instead of solving against the plane.
			for (int i = 0; i < 90; i++) {
				vec3 q = ro + rd * t;
				float d = q.y - waveHeight(q.xz);
				if (d < 1.0 || t > 16000.0) break;
				t += max(d * 0.5, 3.0);
			}
		} else {
			t = -ro.y / rd.y;
			for (int i = 0; i < 6; i++) {
				vec3 q = ro + rd * t;
				t = (ro.y - waveHeight(q.xz)) / -rd.y;
			}
		}
		vec3 p = ro + rd * t;
		float e = clamp(t * 0.002, 2.0, 18.0);
		vec3 n = waveNormal(p.xz, e);
		float ndv = clamp(dot(n, -rd), 0.0, 1.0);
		float fres = uDeep.w + (1.0 - uDeep.w) * pow(1.0 - ndv, 5.0);
		vec3 r = reflect(rd, n);
		r.y = abs(r.y);
		vec3 env = sky(r);
		vec4 mirror = blurredReflect(vUv + n.xz * 0.06, 0.0035);
		env = mix(env, mirror.rgb, mirror.a * 0.55);
		vec3 water = mix(uDeep.rgb, env, fres);
		float sh = shadowAt(p.xz);
		water *= 1.0 - sh;
		float ndl = max(dot(n, uSun.xyz), 0.0);
		water += uDeep.rgb * (ndl - uSun.y) * 1.7;
		vec3 h = normalize(uSun.xyz - rd);
		water += uSunColor.rgb * pow(max(dot(n, h), 0.0), 420.0) * uSun.w;
		float fog = 1.0 - exp(-t * 0.00011);
		col = mix(water, sky(rd), fog * fog);
		vec4 clip = uVP * vec4(p, 1.0);
		depth = clamp(clip.z / clip.w * 0.5 + 0.5, 0.0, 1.0);
	} else {
		col = sky(rd);
	}
	if (!under) {
		// The brand's look: glows resolve into Bayer cells instead of a smooth airbrush.
		vec3 dir = vec3(rd.x, abs(rd.y), rd.z);
		float cell = bayer8(ivec2(gl_FragCoord.xy) / 3);
		float w = 0.0;
		vec3 tone = vec3(0.0);
		for (int i = 0; i < 4; i++) {
			float a = glowAmount(dir, i);
			if (a > w) {
				w = a;
				tone = uGlowCol[i].rgb;
			}
		}
		float soft = clamp(w * uSkyHorizon.w, 0.0, 1.0);
		col += (tone - skyBase(dir)) * (step(cell, soft) - soft) * 0.5;
	}
	o = vec4(col, 1.0);
	gl_FragDepth = depth;
}`;

const SLAB_VERT = `${COMMON}
layout(location = 0) in vec2 aUV;
layout(location = 1) in float aKind;
layout(location = 2) in vec4 aEnds;
layout(location = 3) in vec3 aRim;
layout(location = 4) in float aBack;
layout(location = 5) in vec4 iM0;
layout(location = 6) in vec4 iM1;
layout(location = 7) in vec4 iM2;
layout(location = 8) in vec4 iM3;
layout(location = 9) in vec4 iSize;
layout(location = 10) in vec4 iRect;
layout(location = 11) in vec4 iTint;
layout(location = 12) in vec4 iBend;
layout(location = 13) in vec4 iMat;
out vec2 vUV;
out vec2 vLocal;
out vec3 vWorld;
out vec3 vNormal;
flat out float vKind;
flat out vec4 vSize;
flat out vec4 vRect;
flat out vec4 vTint;
flat out vec4 vMat;
uniform int uProject;
vec3 bendPoint(vec3 p, float k) {
	if (abs(k) < 1e-6) return p;
	float a = p.x * k, R = 1.0 / k;
	return vec3(sin(a) * (R - p.z), p.y, R - cos(a) * (R - p.z));
}
vec3 bendNormal(vec3 n, float x, float k) {
	if (abs(k) < 1e-6) return n;
	float a = x * k, c = cos(a), s = sin(a);
	return vec3(n.x * c - n.z * s, n.y, n.x * s + n.z * c);
}
void main() {
	vec3 p, n;
	float w = iSize.x, h = iSize.y, r = min(iSize.z, min(w, h) * 0.5), th = iSize.w;
	if (aKind < 1.5) {
		float z = aKind > 0.5 ? -th : 0.0;
		p = vec3((aUV.x - 0.5) * w, (0.5 - aUV.y) * h, z);
		n = vec3(0.0, 0.0, aKind > 0.5 ? -1.0 : 1.0);
		vUV = aUV;
	} else {
		vec2 inner = vec2(w, h) * 0.5 - r;
		vec2 q = mix(aEnds.xy * inner, aEnds.zw * inner, aRim.x) + r * aRim.yz;
		p = vec3(q, -th * aBack);
		n = vec3(aRim.yz, 0.0);
		vUV = vec2(q.x / w + 0.5, 0.5 - q.y / h);
	}
	vLocal = p.xy;
	float flutter = iBend.y * sin(p.x * 0.012 + p.y * 0.008 + iBend.z);
	p.z += flutter;
	// Curvature wraps around the local y axis, or around x for drums.
	bool drum = iBend.w > 0.5;
	vec3 q = drum ? p.yxz : p;
	vec3 bent = bendPoint(q, iBend.x);
	vec3 bn = bendNormal(drum ? n.yxz : n, q.x, iBend.x);
	if (drum) {
		bent = bent.yxz;
		bn = bn.yxz;
	}
	mat4 m = mat4(iM0, iM1, iM2, iM3);
	vec4 world = m * vec4(bent, 1.0);
	vWorld = world.xyz;
	vNormal = normalize(mat3(m) * bn);
	vKind = aKind;
	vSize = iSize;
	vRect = iRect;
	vTint = iTint;
	vMat = iMat;
	if (uProject == 1) {
		vec2 s = world.xz - uSun.xz / max(uSun.y, 0.05) * world.y;
		vec2 c = (s - uShadow.xy) / uShadow.z;
		vTint.a *= exp(-max(world.y, 0.0) * 0.0012);
		gl_Position = vec4(c, 0.0, 1.0);
	} else {
		gl_Position = uVP * world;
	}
}`;

const SLAB_FRAG = `${COMMON}
in vec2 vUV;
in vec2 vLocal;
in vec3 vWorld;
in vec3 vNormal;
flat in float vKind;
flat in vec4 vSize;
flat in vec4 vRect;
flat in vec4 vTint;
flat in vec4 vMat;
out vec4 o;
uniform sampler2D uTex;
uniform int uProject;
uniform float uMirror;
float sdRound(vec2 p, vec2 b, float r) {
	vec2 q = abs(p) - b + r;
	return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}
void main() {
	if (uMirror > 0.5 && vWorld.y < 0.0) discard;
	float mode = vMat.x;
	// Body-less surfaces have nothing but their front face.
	if (mode > 0.5 && mode < 1.5 || mode > 2.5 || vSize.w <= 0.0) {
		if (vKind > 0.5) discard;
	}
	float alpha = 1.0;
	if (mode > 3.5) {
		// A soft plate: the 3D equivalent of a box-shadow or an ambient glow behind a surface.
		float blur = vMat.y;
		float inset = min(vSize.x, vSize.y) * 0.5 - 1.0;
		float d = sdRound(vLocal, vSize.xy * 0.5 - blur, min(vSize.z, inset));
		float s = clamp(0.5 - d / (blur * 2.0), 0.0, 1.0);
		float a = s * s * (3.0 - 2.0 * s) * vTint.a;
		o = vec4(vTint.rgb * a, a);
		return;
	}
	if (vKind < 1.5) {
		float d = sdRound(vLocal, vSize.xy * 0.5, min(vSize.z, min(vSize.x, vSize.y) * 0.5));
		float aa = max(fwidth(d), 0.001);
		alpha = clamp(0.5 - d / aa, 0.0, 1.0);
		if (alpha <= 0.0) discard;
	}
	if (uProject == 1) {
		o = vec4(alpha * vTint.a * vMat.w);
		return;
	}
	// Faces turned away from the eye never draw: while a panel fades it writes no depth, so its back
	// face would otherwise land on top of its front and blank the content.
	if (dot(vNormal, uEye.xyz - vWorld) < 0.0) discard;
	vec3 n = normalize(gl_FrontFacing ? vNormal : -vNormal);
	vec3 v = normalize(uEye.xyz - vWorld);
	float ndv = clamp(dot(n, v), 0.0, 1.0);
	vec3 base;
	float cover = 1.0;
	if (mode > 2.5) {
		// Droplets and bubbles: a little sphere of refracted sky with a hot rim.
		vec2 c = (vUV - 0.5) * 2.0;
		float rr = dot(c, c);
		if (rr > 1.0) discard;
		float z = sqrt(1.0 - rr);
		vec3 sn = normalize(vec3(c.x, -c.y, z));
		float rim = pow(1.0 - z, 3.0);
		vec3 env = sky(reflect(-v, sn));
		vec3 glassy = mix(vTint.rgb, env, 0.45 + rim * 0.5);
		// A drop of liquid: dark at the shoulder, light pooling at the far edge, and one hard window highlight.
		float key = clamp(dot(sn, normalize(vec3(-0.35, 0.55, 0.75))), 0.0, 1.0);
		float pool = smoothstep(0.1, 0.95, dot(sn, normalize(vec3(0.3, -0.7, 0.5))));
		vec3 solid = vTint.rgb * (0.5 + 0.55 * key) + vTint.rgb * vec3(1.5, 1.05, 0.7) * pool * 0.75 + env * rim * 0.3;
		base = mix(glassy, solid, vMat.y) + uSunColor.rgb * pow(max(dot(sn, normalize(vec3(-0.4, 0.6, 0.7))), 0.0), 60.0) * 2.0;
		float radius = sqrt(rr);
		cover = clamp((1.0 - radius) / max(fwidth(radius), 0.0001), 0.0, 1.0) * clamp(0.35 + rim * 0.65 + vMat.y, 0.0, 1.0);
	} else if (mode > 1.5) {
		base = vTint.rgb;
	} else if (vKind > 1.5) {
		base = mix(vTint.rgb, vec3(1.0), 0.2);
	} else if (vKind > 0.5) {
		base = vTint.rgb * 0.94;
	} else {
		vec2 uv = mix(vRect.xy, vRect.zw, vUV);
		vec4 t = texture(uTex, uv);
		if (mode > 0.5) {
			cover = t.a;
			if (cover < 0.002) discard;
			base = pow(clamp(t.rgb / max(t.a, 0.001), 0.0, 1.0), vec3(2.2)) * vTint.rgb;
		} else {
			base = pow(t.rgb, vec3(2.2)) * vTint.rgb;
		}
	}
	vec3 col = base;
	if (mode < 0.5 || mode > 1.5) {
		float ndl = dot(n, uSun.xyz);
		float lit = 0.92 + 0.13 * max(ndl, 0.0) + 0.05 * n.y;
		col *= lit;
		float fres = pow(1.0 - ndv, 4.0);
		col = mix(col, sky(reflect(-v, n)), fres * vMat.y);
		vec3 h = normalize(uSun.xyz + v);
		col += uSunColor.rgb * pow(max(dot(n, h), 0.0), 90.0) * 0.5 * vMat.y;
	}
	col += base * vMat.z;
	// Depth falls off into the water around the eye once the camera is under.
	if (uFlags.z > 0.5) {
		float dist = length(vWorld - uEye.xyz);
		float fog = 1.0 - exp(-dist * uUnderDeep.w);
		vec3 tone = mix(uUnderDeep.rgb, uUnderTop.rgb, clamp(0.5 + normalize(vWorld - uEye.xyz).y * 0.5, 0.0, 1.0));
		col = mix(col * vec3(0.72, 0.9, 1.0), tone, fog);
	}
	float a = alpha * cover * vTint.a;
	o = vec4(col * a, a);
}`;

const HERO_FRAG = `${COMMON}
in vec2 vUv;
out vec4 o;
uniform mat4 uParts[4];
uniform vec4 uHero;
uniform vec4 uHeroColor;
uniform float uMirror;
const float EDGE = 2.6;
float module2(vec2 p) {
	vec2 q = p - vec2(32.0);
	float r = (q.x < 0.0 && q.y < 0.0) ? 20.0 : 0.0;
	vec2 d = abs(q) - vec2(28.0) + r;
	float box = length(max(d, 0.0)) + min(max(d.x, d.y), 0.0) - r;
	return max(box, (p.x + p.y - 92.0) * 0.7071);
}
float sdPart(vec3 p, mat4 inv) {
	vec4 l = inv * vec4(p, 1.0);
	vec3 q = l.xyz / l.w;
	// Each part's matrix mirrors it into the first quadrant: the mark is one shape four times.
	float d = module2(vec2(q.x + 64.0, 64.0 - q.y));
	vec2 w = vec2(d + EDGE, abs(q.z) - uHero.y + EDGE);
	return (min(max(w.x, w.y), 0.0) + length(max(w, 0.0)) - EDGE) * uHero.x;
}
float map(vec3 p) {
	float d = 1e9;
	for (int i = 0; i < 4; i++) d = min(d, sdPart(p, uParts[i]));
	return d;
}
vec3 calcNormal(vec3 p, float e) {
	const vec2 k = vec2(1.0, -1.0);
	return normalize(k.xyy * map(p + k.xyy * e) + k.yyx * map(p + k.yyx * e) + k.yxy * map(p + k.yxy * e) + k.xxx * map(p + k.xxx * e));
}
vec3 studio(vec3 r, bool under) {
	vec3 c = under ? mix(uUnderDeep.rgb, uUnderTop.rgb, r.y * 0.5 + 0.5) * 1.6 : sky(r);
	c += vec3(1.0, 0.96, 0.9) * 2.6 * smoothstep(0.82, 0.97, dot(r, normalize(vec3(-0.5, 0.75, 0.45))));
	c += vec3(0.95, 0.9, 1.0) * 1.2 * smoothstep(0.9, 0.99, dot(r, normalize(vec3(0.8, 0.15, 0.55))));
	c += vec3(1.0, 0.8, 0.65) * 0.7 * smoothstep(0.75, 0.98, dot(r, normalize(vec3(-0.2, -0.6, 0.75))));
	return c;
}
void main() {
	vec2 ndc = vUv * 2.0 - 1.0;
	vec4 farP = uInvVP * vec4(ndc, 1.0, 1.0);
	vec3 ro = uEye.xyz;
	vec3 rd = normalize(farP.xyz / farP.w - ro);
	float t = uHero.z, tMax = uHero.w;
	float hit = -1.0;
	for (int i = 0; i < 96; i++) {
		vec3 p = ro + rd * t;
		float d = map(p);
		if (d < 0.0009 * t * 0.4) {
			hit = t;
			break;
		}
		t += d * 0.9;
		if (t > tMax) break;
	}
	if (hit < 0.0) discard;
	vec3 p = ro + rd * hit;
	if (uMirror > 0.5 && p.y < 0.0) discard;
	vec3 n = calcNormal(p, max(hit * 0.0006, 0.2));
	vec3 r = reflect(rd, n);
	bool under = uFlags.z > 0.5;
	float ndv = clamp(dot(n, -rd), 0.0, 1.0);
	float fres = 0.04 + 0.96 * pow(1.0 - ndv, 5.0);
	vec3 base = uHeroColor.rgb;
	float ndl = dot(n, uSun.xyz) * 0.5 + 0.5;
	vec3 diffuse = base * mix(0.42, 1.2, ndl * ndl);
	vec3 col = diffuse + studio(r, under) * mix(0.006, 0.85, fres) + base * uHeroColor.a;
	if (under) {
		float dist = length(p - ro);
		col = mix(col, uUnderDeep.rgb, 1.0 - exp(-dist * uUnderDeep.w * 0.5));
	}
	o = vec4(col, 1.0);
	vec4 clip = uVP * vec4(p, 1.0);
	gl_FragDepth = clamp(clip.z / clip.w * 0.5 + 0.5, 0.0, 1.0);
}`;

const COPY_FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 o;
uniform sampler2D uTex;
uniform float uGain;
void main() { o = texture(uTex, vUv) * uGain; }`;

const BLUR_FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 o;
uniform sampler2D uTex;
uniform vec2 uDir;
void main() {
	vec4 c = texture(uTex, vUv) * 0.1964;
	const float w[3] = float[3](0.2969, 0.0945, 0.0104);
	const float s[3] = float[3](1.4118, 3.2941, 5.1765);
	for (int i = 0; i < 3; i++) {
		c += texture(uTex, vUv + uDir * s[i]) * w[i];
		c += texture(uTex, vUv - uDir * s[i]) * w[i];
	}
	o = c;
}`;

const BLOOM_DOWN_FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 o;
uniform sampler2D uTex;
uniform vec2 uPixel;
uniform float uThreshold;
void main() {
	vec3 c = texture(uTex, vUv).rgb * 0.5;
	c += texture(uTex, vUv + uPixel * vec2(-1, -1)).rgb * 0.125;
	c += texture(uTex, vUv + uPixel * vec2(1, -1)).rgb * 0.125;
	c += texture(uTex, vUv + uPixel * vec2(-1, 1)).rgb * 0.125;
	c += texture(uTex, vUv + uPixel * vec2(1, 1)).rgb * 0.125;
	if (uThreshold > 0.0) c = max(c - uThreshold, 0.0);
	o = vec4(min(c, vec3(12.0)), 1.0);
}`;

const BLOOM_UP_FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 o;
uniform sampler2D uTex;
uniform vec2 uPixel;
void main() {
	vec3 c = vec3(0.0);
	for (int x = -1; x <= 1; x++) for (int y = -1; y <= 1; y++) {
		float w = (x == 0 ? 2.0 : 1.0) * (y == 0 ? 2.0 : 1.0) / 16.0;
		c += texture(uTex, vUv + uPixel * vec2(x, y)).rgb * w;
	}
	o = vec4(c, 1.0);
}`;

const FINAL_FRAG = `${COMMON}
in vec2 vUv;
out vec4 o;
uniform sampler2D uTex;
uniform sampler2D uBloom;
uniform vec4 uFxA; // chromatic, lens, vignette, grain
uniform vec4 uFxB; // bloom, mist, dither, droplets
uniform vec4 uFxC; // underwater strength, glitch, stepped time, exposure
uniform vec4 uFlash;
uniform vec4 uWipe;
uniform vec4 uPulse;
uniform float uFrame;
uniform float uDropletTime;
uniform sampler2D uCaption;
uniform float uCaptionAlpha;
uniform vec4 uCaptionBox;
vec2 droplets(vec2 uv) {
	// Water left on the lens after breaching: beads that slide and fade.
	vec2 aspect = vec2(16.0, 9.0);
	vec2 offset = vec2(0.0);
	for (int layer = 0; layer < 3; layer++) {
		float scale = 2.2 + float(layer) * 1.6;
		vec2 g = uv * aspect * scale / 3.0;
		vec2 id = floor(g);
		float speed = hash12(id.xx + 3.1) * 0.22 + 0.05;
		g.y += uDropletTime * speed * (float(layer) + 1.0) * 1.1;
		id = floor(g);
		vec2 f = fract(g) - 0.5;
		float h = hash12(id + float(layer) * 17.0);
		if (h < 0.42) continue;
		vec2 c = (vec2(hash12(id + 1.7), hash12(id + 4.3)) - 0.5) * 0.62;
		vec2 d = f - c;
		d.y *= 1.0 + 0.7 * hash12(id + 9.2);
		float radius = 0.12 + 0.2 * hash12(id + 7.7);
		float l = length(d);
		float m = smoothstep(radius, radius * 0.72, l);
		offset += d * m * -0.09 / max(l, 0.04) * pow(l / radius, 2.0);
	}
	return offset;
}
void main() {
	vec2 uv = vUv;
	vec2 c = uv - 0.5;
	float r2 = dot(c, c);
	uv = 0.5 + c * (1.0 + uFxA.y * r2);
	if (uFxB.w > 0.001) uv += droplets(vUv) * uFxB.w;
	float underMask = 0.0;
	if (uFxC.x > 0.001) {
		vec4 farP = uInvVP * vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
		vec3 ro = uEye.xyz;
		vec3 rd = normalize(farP.xyz / farP.w - ro);
		vec3 lens = ro + rd * 26.0;
		float dh = lens.y - waveHeight(lens.xz);
		underMask = smoothstep(2.0, -2.0, dh);
		float wob = uFxC.x * underMask;
		uv.x += wob * 0.0024 * sin(uv.y * 14.0 + TIME * 1.7) + wob * 0.0011 * sin(uv.y * 37.0 - TIME * 2.3);
		uv.y += wob * 0.0018 * sin(uv.x * 11.0 - TIME * 1.3);
		float line = exp(-dh * dh * 0.06);
		uv.y += line * 0.018 * uFxC.x;
	}
	if (uFxC.y > 0.001) {
		// Tearing blocks during the worst of the overwhelm.
		float row = floor(uv.y * 34.0);
		float n = hash12(vec2(row, floor(uFrame * 0.5)));
		if (n > 1.0 - uFxC.y * 0.6) uv.x += (hash12(vec2(row, uFrame)) - 0.5) * 0.12 * uFxC.y;
		float block = hash12(floor(uv * vec2(14.0, 8.0)) + floor(uFrame * 0.25));
		if (block > 1.0 - uFxC.y * 0.16) uv += (vec2(hash12(uv.yy + uFrame), 0.5) - 0.5) * 0.05;
	}
	vec2 dir = (uv - 0.5);
	float ca = uFxA.x * (0.25 + 3.2 * dot(dir, dir));
	vec3 col;
	if (ca > 0.00005) {
		col = vec3(0.0);
		vec3 sum = vec3(0.0);
		for (int i = 0; i < 9; i++) {
			float f = float(i) / 8.0;
			vec3 w = vec3(max(1.0 - f * 2.0, 0.0), 1.0 - abs(f * 2.0 - 1.0), max(f * 2.0 - 1.0, 0.0));
			col += texture(uTex, uv + dir * ca * (f - 0.5)).rgb * w;
			sum += w;
		}
		col /= sum;
	} else {
		col = texture(uTex, uv).rgb;
	}
	vec3 bloom = texture(uBloom, uv).rgb;
	col += bloom * uFxB.x;
	if (uFxC.x > 0.001) {
		float rays = 0.0;
		vec2 q = vec2((uv.x - 0.5) * (1.0 + (1.0 - uv.y) * 1.2) * 7.0, uv.y * 0.6);
		rays += vnoise(vec2(q.x + TIME * 0.12, TIME * 0.08)) * vnoise(vec2(q.x * 2.3 - TIME * 0.2, TIME * 0.1 + 4.0));
		rays *= smoothstep(0.0, 1.0, uv.y) * smoothstep(0.1, 0.9, uv.y);
		float cell = bayer8(ivec2(gl_FragCoord.xy) / 3);
		float quant = step(cell, rays * 1.5);
		col += uUnderTop.rgb * underMask * uFxC.x * (rays * 0.9 + quant * 0.16 * uv.y);
		float haze = vnoise(uv * vec2(4.0, 7.0) + vec2(TIME * 0.1, -TIME * 0.2));
		col *= mix(vec3(1.0), vec3(0.95, 1.0, 1.04) * (0.92 + haze * 0.16), underMask * uFxC.x);
	}
	col += uPulse.rgb * uPulse.a * smoothstep(0.08, 0.5, r2);
	col = mix(col, uFlash.rgb, uFlash.a);
	if (uWipe.a > 0.0) col = mix(col, uWipe.rgb, step(bayer8(ivec2(gl_FragCoord.xy) / 6), uWipe.a * 2.0 - vUv.x));
	col *= uFxC.w;
	float vig = 1.0 - uFxA.z * smoothstep(0.15, 0.62, r2);
	col *= vig;
	// Soft shoulder: keep authored UI colors, roll off only the highlights.
	vec3 x = max(col, 0.0);
	vec3 shoulder = 1.0 - exp(-(x - 0.86) / 0.14) * 0.14;
	col = mix(x, shoulder, step(0.86, x));
	col = pow(col, vec3(1.0 / 2.2));
	if (uFxB.z > 0.001) {
		float cell = bayer8(ivec2(gl_FragCoord.xy) / 3) - 0.5;
		float levels = mix(64.0, 5.0, uFxB.z);
		col = floor(col * levels + 0.5 + cell) / levels;
	}
	// Print layers sit on the finished frame: no depth of field, shake, colour split or dither touches them.
	vec2 frame = vec2(vUv.x, 1.0 - vUv.y) * vec2(1920.0, 1080.0);
	if (uCaptionAlpha > 0.001) {
		vec2 box = (frame - uCaptionBox.xy) / uCaptionBox.zw;
		if (box.x > 0.0 && box.y > 0.0 && box.x < 1.0 && box.y < 1.0) {
			vec4 t = texture(uCaption, box);
			col = mix(col, t.rgb, t.a * uCaptionAlpha);
		}
	}

	float n = hash12(gl_FragCoord.xy + uFrame * 7.13) - 0.5;
	float m = hash12(gl_FragCoord.yx + uFrame * 3.71) - 0.5;
	col += (n + m) * (uFxA.w + 1.2 / 255.0);
	o = vec4(col, 1.0);
}`;

function compile(gl, type, source) {
	const shader = gl.createShader(type);
	gl.shaderSource(shader, source);
	gl.compileShader(shader);
	if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
		const log = gl.getShaderInfoLog(shader);
		const lines = source.split('\n');
		const line = Number(/ERROR: \d+:(\d+)/.exec(log)?.[1] ?? 0);
		throw new Error(`${log}\n> ${lines[line - 1] ?? ''}`);
	}
	return shader;
}

function program(gl, vert, frag) {
	const p = gl.createProgram();
	gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vert));
	gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, frag));
	gl.linkProgram(p);
	if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
	const index = gl.getUniformBlockIndex(p, 'Frame');
	if (index !== gl.INVALID_INDEX) gl.uniformBlockBinding(p, index, 0);
	const cache = new Map();
	return {
		p,
		u(name) {
			if (!cache.has(name)) cache.set(name, gl.getUniformLocation(p, name));
			return cache.get(name);
		}
	};
}

function target(gl, width, height, format, { depth = false, filter = gl.LINEAR } = {}) {
	const texture = gl.createTexture();
	gl.bindTexture(gl.TEXTURE_2D, texture);
	const { internal, base, type } = {
		rgba32f: { internal: gl.RGBA32F, base: gl.RGBA, type: gl.FLOAT },
		rgba16f: { internal: gl.RGBA16F, base: gl.RGBA, type: gl.HALF_FLOAT },
		rgba8: { internal: gl.RGBA8, base: gl.RGBA, type: gl.UNSIGNED_BYTE }
	}[format];
	gl.texImage2D(gl.TEXTURE_2D, 0, internal, width, height, 0, base, type, null);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
	const fbo = gl.createFramebuffer();
	gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
	gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
	if (depth) {
		const rb = gl.createRenderbuffer();
		gl.bindRenderbuffer(gl.RENDERBUFFER, rb);
		gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT32F, width, height);
		gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, rb);
	}
	if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE)
		throw new Error(`Incomplete ${format} target`);
	gl.bindFramebuffer(gl.FRAMEBUFFER, null);
	return { texture, fbo, width, height };
}

// A slab: a tessellated front and back face joined by a rounded rim, so a surface can bend and catch light.
function slabGeometry(columns, rows, arc) {
	const data = [];
	const index = [];
	const vertex = (u, v, kind, ends, rim, back) => {
		data.push(u, v, kind, ...ends, ...rim, back);
		return data.length / 11 - 1;
	};
	const none = [0, 0, 0, 0];
	for (const kind of [0, 1]) {
		const base = data.length / 11;
		for (let j = 0; j <= rows; j++)
			for (let i = 0; i <= columns; i++) vertex(i / columns, j / rows, kind, none, [0, 0, 0], 0);
		for (let j = 0; j < rows; j++)
			for (let i = 0; i < columns; i++) {
				const a = base + j * (columns + 1) + i;
				const b = a + 1;
				const c = a + columns + 1;
				const d = c + 1;
				index.push(a, c, b, b, c, d);
			}
	}
	const corners = [
		[1, 1, 0],
		[-1, 1, Math.PI / 2],
		[-1, -1, Math.PI],
		[1, -1, (3 * Math.PI) / 2]
	];
	const loop = [];
	corners.forEach(([sx, sy, start], i) => {
		const [nx, ny, nextStart] = corners[(i + 1) % 4];
		for (let k = 0; k <= arc; k++) {
			const a = start + ((Math.PI / 2) * k) / arc;
			loop.push({ ends: [sx, sy, sx, sy], rim: [0, Math.cos(a), Math.sin(a)] });
		}
		const a = start + Math.PI / 2;
		const steps = i % 2 ? rows : columns;
		for (let k = 1; k < steps; k++)
			loop.push({
				ends: [sx, sy, nx, ny],
				rim: [k / steps, Math.cos(a), Math.sin(a)],
				next: nextStart
			});
	});
	const base = data.length / 11;
	for (const { ends, rim } of loop) {
		vertex(0, 0, 2, ends, rim, 0);
		vertex(0, 0, 2, ends, rim, 1);
	}
	for (let i = 0; i < loop.length; i++) {
		const j = (i + 1) % loop.length;
		const a = base + i * 2;
		const b = base + j * 2;
		index.push(a, a + 1, b, b, a + 1, b + 1);
	}
	return { data: new Float32Array(data), index: new Uint32Array(index) };
}

export function createEngine(canvas) {
	const gl = canvas.getContext('webgl2', {
		alpha: false,
		antialias: false,
		depth: false,
		preserveDrawingBuffer: true,
		powerPreference: 'high-performance'
	});
	if (!gl) throw new Error('WebGL2 is unavailable');
	for (const name of ['EXT_color_buffer_float', 'EXT_float_blend', 'OES_texture_float_linear'])
		if (!gl.getExtension(name)) throw new Error(`Missing ${name}`);
	const aniso = gl.getExtension('EXT_texture_filter_anisotropic');
	const maxAniso = aniso ? gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT) : 1;

	const programs = {
		scene: program(gl, FULL_VERT, SCENE_FRAG),
		slab: program(gl, SLAB_VERT, SLAB_FRAG),
		hero: program(gl, FULL_VERT, HERO_FRAG),
		copy: program(gl, FULL_VERT, COPY_FRAG),
		blur: program(gl, FULL_VERT, BLUR_FRAG),
		down: program(gl, FULL_VERT, BLOOM_DOWN_FRAG),
		up: program(gl, FULL_VERT, BLOOM_UP_FRAG),
		final: program(gl, FULL_VERT, FINAL_FRAG)
	};

	const empty = gl.createVertexArray();
	const uboSize = 64 * 2 + 16 * 11 + 16 * 8 + 16 * MAX_DROPS;
	const uboData = new Float32Array(uboSize / 4);
	const ubo = gl.createBuffer();
	gl.bindBuffer(gl.UNIFORM_BUFFER, ubo);
	gl.bufferData(gl.UNIFORM_BUFFER, uboSize, gl.DYNAMIC_DRAW);
	gl.bindBufferBase(gl.UNIFORM_BUFFER, 0, ubo);

	const meshes = {};
	const instanceBuffer = gl.createBuffer();
	const instanceData = new Float32Array(STRIDE * 6000);
	function mesh(name, columns, rows, arc) {
		const { data, index } = slabGeometry(columns, rows, arc);
		const vao = gl.createVertexArray();
		gl.bindVertexArray(vao);
		const vbo = gl.createBuffer();
		gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
		gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
		const ibo = gl.createBuffer();
		gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
		gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, index, gl.STATIC_DRAW);
		const layout = [
			[0, 2, 0],
			[1, 1, 8],
			[2, 4, 12],
			[3, 3, 28],
			[4, 1, 40]
		];
		for (const [location, size, offset] of layout) {
			gl.enableVertexAttribArray(location);
			gl.vertexAttribPointer(location, size, gl.FLOAT, false, 44, offset);
		}
		gl.bindBuffer(gl.ARRAY_BUFFER, instanceBuffer);
		for (let i = 0; i < 9; i++) {
			const location = 5 + i;
			gl.enableVertexAttribArray(location);
			gl.vertexAttribPointer(location, 4, gl.FLOAT, false, STRIDE * 4, i * 16);
			gl.vertexAttribDivisor(location, 1);
		}
		gl.bindVertexArray(null);
		meshes[name] = { vao, count: index.length };
	}
	gl.bindBuffer(gl.ARRAY_BUFFER, instanceBuffer);
	gl.bufferData(gl.ARRAY_BUFFER, instanceData.byteLength, gl.DYNAMIC_DRAW);
	mesh('slab', 64, 40, 8);
	mesh('card', 12, 8, 5);

	const white = gl.createTexture();
	gl.bindTexture(gl.TEXTURE_2D, white);
	gl.texImage2D(
		gl.TEXTURE_2D,
		0,
		gl.RGBA,
		1,
		1,
		0,
		gl.RGBA,
		gl.UNSIGNED_BYTE,
		new Uint8Array([255, 255, 255, 255])
	);

	const size = (scale) => [Math.round(WIDTH * scale), Math.round(HEIGHT * scale)];
	const targets = {
		scene: target(gl, WIDTH, HEIGHT, 'rgba16f', { depth: true }),
		mirror: target(gl, ...size(0.5), 'rgba16f', { depth: true }),
		shadowA: target(gl, 1024, 1024, 'rgba8'),
		shadowB: target(gl, 1024, 1024, 'rgba8'),
		accum: target(gl, WIDTH, HEIGHT, 'rgba32f'),
		resolved: target(gl, WIDTH, HEIGHT, 'rgba16f'),
		bloom: [0.5, 0.25, 0.125, 0.0625, 0.03125, 0.015625].map((s) =>
			target(gl, ...size(s), 'rgba16f')
		)
	};

	const surfaces = [];
	function surface(element, { mips = true } = {}) {
		const texture = gl.createTexture();
		gl.bindTexture(gl.TEXTURE_2D, texture);
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
		gl.texParameteri(
			gl.TEXTURE_2D,
			gl.TEXTURE_MIN_FILTER,
			mips ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR
		);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
		if (aniso) gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, maxAniso);
		const entry = { element, texture, mips, dirty: true, uploaded: false };
		surfaces.push(entry);
		return entry;
	}

	// Surfaces repaint through the canvas paint event; only dirty, visible ones cross to the GPU.
	function uploadSurfaces(wanted) {
		const stale = surfaces.filter((s) => s.dirty && (wanted === undefined || wanted.has(s)));
		if (!stale.length) return Promise.resolve();
		return new Promise((resolve, reject) => {
			canvas.onpaint = () => {
				canvas.onpaint = null;
				try {
					for (const s of stale) {
						gl.bindTexture(gl.TEXTURE_2D, s.texture);
						gl.texElementImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, s.element);
						if (s.mips) gl.generateMipmap(gl.TEXTURE_2D);
						s.dirty = false;
						s.uploaded = true;
					}
					resolve();
				} catch (error) {
					reject(error);
				}
			};
			canvas.requestPaint();
		});
	}

	// A surface that has just become visible needs one paint before its record exists.
	const settle = () =>
		new Promise((resolve) => {
			canvas.onpaint = () => {
				canvas.onpaint = null;
				resolve();
			};
			canvas.requestPaint();
		});

	const fullscreen = () => gl.drawArrays(gl.TRIANGLES, 0, 3);
	function pass(name, destination, uniforms = {}, textures = {}) {
		const shader = programs[name];
		gl.useProgram(shader.p);
		gl.bindFramebuffer(gl.FRAMEBUFFER, destination ? destination.fbo : null);
		gl.viewport(
			0,
			0,
			destination ? destination.width : WIDTH,
			destination ? destination.height : HEIGHT
		);
		let unit = 0;
		for (const [name_, texture] of Object.entries(textures)) {
			gl.activeTexture(gl.TEXTURE0 + unit);
			gl.bindTexture(gl.TEXTURE_2D, texture);
			gl.uniform1i(shader.u(name_), unit);
			unit++;
		}
		for (const [name_, value] of Object.entries(uniforms)) {
			if (typeof value === 'number') gl.uniform1f(shader.u(name_), value);
			else if (value.length === 2) gl.uniform2fv(shader.u(name_), value);
			else if (value.length === 4) gl.uniform4fv(shader.u(name_), value);
		}
		gl.bindVertexArray(empty);
		return shader;
	}

	function perspective(fovy, aspect, near, far) {
		const f = 1 / Math.tan(fovy / 2);
		const nf = 1 / (near - far);
		return [
			f / aspect,
			0,
			0,
			0,
			0,
			f,
			0,
			0,
			0,
			0,
			(far + near) * nf,
			-1,
			0,
			0,
			2 * far * near * nf,
			0
		];
	}
	const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
	const cross = (a, b) => [
		a[1] * b[2] - a[2] * b[1],
		a[2] * b[0] - a[0] * b[2],
		a[0] * b[1] - a[1] * b[0]
	];
	const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
	const norm = (a) => {
		const l = Math.hypot(a[0], a[1], a[2]) || 1;
		return [a[0] / l, a[1] / l, a[2] / l];
	};
	function lookAt(eye, at, up) {
		const z = norm(sub(eye, at));
		const x = norm(cross(up, z));
		const y = cross(z, x);
		return {
			m: [
				x[0],
				y[0],
				z[0],
				0,
				x[1],
				y[1],
				z[1],
				0,
				x[2],
				y[2],
				z[2],
				0,
				-dot(x, eye),
				-dot(y, eye),
				-dot(z, eye),
				1
			],
			x,
			y,
			z
		};
	}
	function multiply(a, b) {
		const out = Array.from({ length: 16 });
		for (let c = 0; c < 4; c++)
			for (let r = 0; r < 4; r++)
				out[c * 4 + r] =
					a[r] * b[c * 4] +
					a[r + 4] * b[c * 4 + 1] +
					a[r + 8] * b[c * 4 + 2] +
					a[r + 12] * b[c * 4 + 3];
		return out;
	}
	function invert(m) {
		const [a, b, c, d, e, f, g, h, i, j, k, l, n, o, p, q] = m;
		const b00 = a * f - b * e,
			b01 = a * g - c * e,
			b02 = a * h - d * e,
			b03 = b * g - c * f;
		const b04 = b * h - d * f,
			b05 = c * h - d * g,
			b06 = i * o - j * n,
			b07 = i * p - k * n;
		const b08 = i * q - l * n,
			b09 = j * p - k * o,
			b10 = j * q - l * o,
			b11 = k * q - l * p;
		const det = 1 / (b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06);
		return [
			(f * b11 - g * b10 + h * b09) * det,
			(c * b10 - b * b11 - d * b09) * det,
			(o * b05 - p * b04 + q * b03) * det,
			(k * b04 - j * b05 - l * b03) * det,
			(g * b08 - e * b11 - h * b07) * det,
			(a * b11 - c * b08 + d * b07) * det,
			(p * b02 - n * b05 - q * b01) * det,
			(i * b05 - k * b02 + l * b01) * det,
			(e * b10 - f * b08 + h * b06) * det,
			(b * b08 - a * b10 - d * b06) * det,
			(n * b04 - o * b02 + q * b00) * det,
			(j * b02 - i * b04 - l * b00) * det,
			(f * b07 - e * b09 - g * b06) * det,
			(a * b09 - b * b07 + c * b06) * det,
			(o * b01 - n * b03 - p * b00) * det,
			(i * b03 - j * b01 + k * b00) * det
		];
	}

	const reflectY = [1, 0, 0, 0, 0, -1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
	function writeFrame(view, world, t, mirrored) {
		const d = uboData;
		let o = 0;
		const vec = (x, y, z, w) => {
			d[o++] = x;
			d[o++] = y;
			d[o++] = z;
			d[o++] = w;
		};
		const vp = mirrored ? multiply(view.vp, reflectY) : view.vp;
		d.set(vp, 0);
		d.set(mirrored ? invert(vp) : view.inverse, 16);
		o = 32;
		const eye = mirrored ? [view.eye[0], -view.eye[1], view.eye[2]] : view.eye;
		vec(...eye, t);
		const sun = norm(world.sunDir);
		vec(...sun, world.sunStrength);
		vec(...world.sunColor, world.rippleSpeed);
		vec(...world.skyTop, world.skyCurve);
		vec(...world.skyHorizon, world.glowDither);
		vec(...world.deep, world.reflectMin);
		vec(...world.underTop, 0);
		vec(...world.underDeep, world.underFog);
		vec(world.swell, world.swellLength, world.wallZ ?? 0, world.rippleWidth);
		vec(
			mirrored ? 1 : 0,
			Math.min(world.drops.length, MAX_DROPS),
			view.under ? 1 : 0,
			world.wallAmp ?? 0
		);
		vec(view.shadow[0], view.shadow[1], world.shadowRange, world.shadowStrength);
		for (let i = 0; i < 4; i++) {
			const g = world.glows[i] ?? {
				dir: [0, 1, 0],
				power: 1,
				color: [0, 0, 0],
				strength: 0
			};
			const n = norm(g.dir);
			vec(n[0], n[1], n[2], g.power);
		}
		for (let i = 0; i < 4; i++) {
			const g = world.glows[i] ?? { color: [0, 0, 0], strength: 0 };
			vec(...g.color, g.strength);
		}
		const drops = world.drops;
		for (let i = 0; i < MAX_DROPS; i++) {
			const drop = drops[i];
			if (drop) vec(drop.x, drop.z, drop.t, drop.amp);
			else vec(0, 0, 0, 0);
		}
		gl.bindBuffer(gl.UNIFORM_BUFFER, ubo);
		gl.bufferSubData(gl.UNIFORM_BUFFER, 0, d);
	}

	function flushItems(items, shadowPass, mirrored) {
		const shader = programs.slab;
		gl.useProgram(shader.p);
		gl.uniform1i(shader.u('uProject'), shadowPass ? 1 : 0);
		gl.uniform1f(shader.u('uMirror'), mirrored ? 1 : 0);
		gl.uniform1i(shader.u('uTex'), 0);
		gl.activeTexture(gl.TEXTURE0);
		let i = 0;
		const count = Math.min(items.length, instanceData.length / STRIDE);
		for (let n = 0; n < count; n++) instanceData.set(items[n].data, n * STRIDE);
		gl.bindBuffer(gl.ARRAY_BUFFER, instanceBuffer);
		gl.bufferSubData(gl.ARRAY_BUFFER, 0, instanceData, 0, count * STRIDE);
		while (i < count) {
			const first = items[i];
			let j = i + 1;
			while (
				j < count &&
				items[j].texture === first.texture &&
				items[j].mesh === first.mesh &&
				items[j].alpha === first.alpha
			)
				j++;
			const m = meshes[first.mesh];
			gl.bindVertexArray(m.vao);
			for (let location = 5; location < 14; location++)
				gl.vertexAttribPointer(
					location,
					4,
					gl.FLOAT,
					false,
					STRIDE * 4,
					(location - 5) * 16 + i * STRIDE * 4
				);
			gl.bindTexture(gl.TEXTURE_2D, first.texture ?? white);
			if (!shadowPass) gl.depthMask(!first.alpha);
			gl.drawElementsInstanced(gl.TRIANGLES, m.count, gl.UNSIGNED_INT, 0, j - i);
			i = j;
		}
		gl.depthMask(true);
	}

	function drawHero(hero, mirrored) {
		if (!hero) return;
		const shader = programs.hero;
		gl.useProgram(shader.p);
		gl.bindVertexArray(empty);
		gl.uniformMatrix4fv(shader.u('uParts'), false, hero.parts);
		gl.uniform4fv(shader.u('uHero'), [hero.scale, hero.depth, hero.near, hero.far]);
		gl.uniform4fv(shader.u('uHeroColor'), hero.color);
		gl.uniform1f(shader.u('uMirror'), mirrored ? 1 : 0);
		fullscreen();
	}

	function renderSample(build, t, jitter, lens) {
		const scene = build(t);
		const { camera, world, items, hero } = scene;
		build.lastWorld = world;
		const fovy = (camera.fov * Math.PI) / 180;
		const proj = perspective(fovy, WIDTH / HEIGHT, 8, 60000);
		const forward = norm(sub(camera.at, camera.eye));
		const roll = camera.roll ?? 0;
		const baseUp = norm(cross(cross(forward, [0, 1, 0]), forward));
		const side = cross(forward, baseUp);
		const up = norm([
			baseUp[0] * Math.cos(roll) + side[0] * Math.sin(roll),
			baseUp[1] * Math.cos(roll) + side[1] * Math.sin(roll),
			baseUp[2] * Math.cos(roll) + side[2] * Math.sin(roll)
		]);
		const right = norm(cross(forward, up));
		const focus = camera.focus ?? Math.hypot(...sub(camera.at, camera.eye));
		const aperture = camera.aperture ?? 0;
		const eye = [
			camera.eye[0] + right[0] * lens[0] * aperture + up[0] * lens[1] * aperture,
			camera.eye[1] + right[1] * lens[0] * aperture + up[1] * lens[1] * aperture,
			camera.eye[2] + right[2] * lens[0] * aperture + up[2] * lens[1] * aperture
		];
		const focusPoint = [
			camera.eye[0] + forward[0] * focus,
			camera.eye[1] + forward[1] * focus,
			camera.eye[2] + forward[2] * focus
		];
		const v = lookAt(eye, focusPoint, up);
		const jittered = proj.slice();
		jittered[8] += (jitter[0] * 2) / WIDTH;
		jittered[9] += (jitter[1] * 2) / HEIGHT;
		const vp = multiply(jittered, v.m);
		const inverse = invert(vp);
		const view = {
			vp,
			inverse,
			eye,
			under: eye[1] < (scene.eyeHeight ?? 0),
			shadow: [camera.at[0], camera.at[2]]
		};
		for (const item of items) {
			const data = item.data;
			const dx = data[12] - eye[0];
			const dy = data[13] - eye[1];
			const dz = data[14] - eye[2];
			item.depth = dx * forward[0] + dy * forward[1] + dz * forward[2];
		}
		items.sort((a, b) =>
			a.alpha === b.alpha ? (a.alpha ? b.depth - a.depth : a.depth - b.depth) : a.alpha ? 1 : -1
		);

		gl.disable(gl.BLEND);
		// Planar shadows: everything projected onto the water, then softened.
		gl.disable(gl.DEPTH_TEST);
		gl.disable(gl.CULL_FACE);
		writeFrame(view, world, t, false);
		const casters = items.filter((item) => item.casts);
		gl.bindFramebuffer(gl.FRAMEBUFFER, targets.shadowA.fbo);
		gl.viewport(0, 0, 1024, 1024);
		gl.clearColor(0, 0, 0, 0);
		gl.clear(gl.COLOR_BUFFER_BIT);
		if (casters.length && world.shadowStrength > 0) {
			gl.enable(gl.BLEND);
			gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
			flushItems(casters, true, false);
			gl.disable(gl.BLEND);
			for (let i = 0; i < 2; i++) {
				const spread = (world.shadowBlur * (i + 1)) / 2 / 1024;
				pass('blur', targets.shadowB, { uDir: [spread, 0] }, { uTex: targets.shadowA.texture });
				fullscreen();
				pass('blur', targets.shadowA, { uDir: [0, spread] }, { uTex: targets.shadowB.texture });
				fullscreen();
			}
		}
		// Mirror: the same scene under a reflected camera.
		gl.bindFramebuffer(gl.FRAMEBUFFER, targets.mirror.fbo);
		gl.viewport(0, 0, targets.mirror.width, targets.mirror.height);
		gl.clearColor(0, 0, 0, 0);
		gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
		if (!view.under && world.mirror !== false) {
			writeFrame(view, world, t, true);
			gl.enable(gl.DEPTH_TEST);
			gl.depthFunc(gl.LEQUAL);
			gl.enable(gl.BLEND);
			gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
			drawHero(hero, true);
			flushItems(
				items.filter((item) => item.mirror),
				false,
				true
			);
			gl.disable(gl.BLEND);
			writeFrame(view, world, t, false);
		}
		// Main view.
		gl.enable(gl.DEPTH_TEST);
		gl.depthFunc(gl.LEQUAL);
		pass(
			'scene',
			targets.scene,
			{},
			{ uReflect: targets.mirror.texture, uShadowMap: targets.shadowA.texture }
		);
		gl.clear(gl.DEPTH_BUFFER_BIT);
		fullscreen();
		drawHero(hero, false);
		gl.enable(gl.BLEND);
		gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
		flushItems(items, false, false);
		gl.disable(gl.BLEND);
		gl.disable(gl.DEPTH_TEST);
		// Add to the accumulation buffer.
		pass('copy', targets.accum, { uGain: 1 }, { uTex: targets.scene.texture });
		gl.enable(gl.BLEND);
		gl.blendFunc(gl.ONE, gl.ONE);
		fullscreen();
		gl.disable(gl.BLEND);
		return view;
	}

	const r2 = (i) => [(0.5 + i * 0.7548776662) % 1, (0.5 + i * 0.5698402909) % 1];
	function disc(i, n) {
		const radius = Math.sqrt((i + 0.5) / n);
		const angle = i * 2.39996323;
		return [radius * Math.cos(angle), radius * Math.sin(angle)];
	}

	function render(build, fx, { t, fps, samples, shutter, frame }) {
		gl.bindFramebuffer(gl.FRAMEBUFFER, targets.accum.fbo);
		gl.clearColor(0, 0, 0, 0);
		gl.clear(gl.COLOR_BUFFER_BIT);
		const open = shutter / fps;
		let view;
		for (let i = 0; i < samples; i++) {
			const [a, b] = r2(i + 1);
			view = renderSample(
				build,
				t + ((i + 0.5) / samples - 0.5) * open,
				[a - 0.5, b - 0.5],
				disc(i, samples)
			);
		}
		pass('copy', targets.resolved, { uGain: 1 / samples }, { uTex: targets.accum.texture });
		fullscreen();
		// Bloom: a bright-pass mip chain plus a very wide mist for a little atmosphere.
		let source = targets.resolved;
		targets.bloom.forEach((level, i) => {
			pass(
				'down',
				level,
				{
					uPixel: [1 / source.width, 1 / source.height],
					uThreshold: i === 0 ? fx.bloomThreshold : 0
				},
				{ uTex: source.texture }
			);
			fullscreen();
			source = level;
		});
		gl.enable(gl.BLEND);
		gl.blendFunc(gl.ONE, gl.ONE);
		for (let i = targets.bloom.length - 2; i >= 0; i--) {
			pass(
				'up',
				targets.bloom[i],
				{
					uPixel: [1 / targets.bloom[i + 1].width, 1 / targets.bloom[i + 1].height]
				},
				{ uTex: targets.bloom[i + 1].texture }
			);
			fullscreen();
		}
		gl.disable(gl.BLEND);
		writeFrame(view, build.lastWorld, t, false);
		pass(
			'final',
			null,
			{
				uFxA: [fx.chromatic, fx.lens, fx.vignette, fx.grain],
				uFxB: [fx.bloom, fx.mist, fx.dither, fx.droplets],
				uFxC: [fx.underwater, fx.glitch, 0, fx.exposure],
				uFlash: fx.flash,
				uWipe: fx.wipe,
				uPulse: fx.pulse,
				uFrame: frame,
				uDropletTime: fx.dropletTime,
				uCaptionAlpha: fx.caption,
				uCaptionBox: fx.captionBox
			},
			{
				uTex: targets.resolved.texture,
				uBloom: targets.bloom[0].texture,
				uCaption: fx.captionTexture
			}
		);
		fullscreen();
		gl.flush();
	}

	return { gl, surface, uploadSurfaces, settle, render };
}
