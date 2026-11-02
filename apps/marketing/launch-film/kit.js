// Motion math and the per-sample scene list. Everything here is a pure function of time.
export const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
export const lerp = (a, b, p) => a + (b - a) * p;
export const mix3 = (a, b, p) => [lerp(a[0], b[0], p), lerp(a[1], b[1], p), lerp(a[2], b[2], p)];
export const smooth = (x) => x * x * (3 - 2 * x);
export const ease = {
	linear: (x) => x,
	out: (x) => 1 - (1 - x) ** 3,
	in: (x) => x ** 3,
	inOut: (x) => (x < 0.5 ? 4 * x ** 3 : 1 - (-2 * x + 2) ** 3 / 2),
	sine: (x) => 0.5 - 0.5 * Math.cos(Math.PI * x),
	expoOut: (x) => (x >= 1 ? 1 : 1 - 2 ** (-10 * x)),
	expoIn: (x) => (x <= 0 ? 0 : 2 ** (10 * x - 10)),
	expoInOut: (x) =>
		x <= 0 ? 0 : x >= 1 ? 1 : x < 0.5 ? 2 ** (20 * x - 10) / 2 : (2 - 2 ** (-20 * x + 10)) / 2,
	back: (x) => 1 + 2.4 * (x - 1) ** 3 + 1.4 * (x - 1) ** 2,
	spring: (x) => (x >= 1 ? 1 : 1 - Math.exp(-7 * x) * Math.cos(10 * x))
};
export const prog = (t, a, b, e = ease.out) => e(clamp((t - a) / (b - a)));
export const between = (t, a, b) => t >= a && t < b;
// At this distance on the film's 30 degree lens, one world unit is one pixel of the 1080p frame.
export const PIXEL_D = 540 / Math.tan((15 * Math.PI) / 180);
export const rgb = (hex) => [1, 3, 5].map((i) => (parseInt(hex.slice(i, i + 2), 16) / 255) ** 2.2);

// Deterministic pseudo-random values and smooth noise, so a render is repeatable from any frame.
export const rand = (i, salt = 0) => {
	const x = Math.sin(i * 127.1 + salt * 311.7 + 12.9) * 43758.5453;
	return x - Math.floor(x);
};
export function noise(t, salt = 0) {
	return (
		Math.sin(t * 1.0 + salt * 3.1) * 0.5 +
		Math.sin(t * 2.3 + salt * 1.7) * 0.3 +
		Math.sin(t * 5.1 + salt * 4.3) * 0.2
	);
}

const IDENTITY_RECT = [0, 0, 1, 1];
const WHITE = [1, 1, 1];

export function matrix(x, y, z, rx = 0, ry = 0, rz = 0) {
	const cx = Math.cos(rx),
		sx = Math.sin(rx);
	const cy = Math.cos(ry),
		sy = Math.sin(ry);
	const cz = Math.cos(rz),
		sz = Math.sin(rz);
	// R = Ry * Rx * Rz, columns first.
	return [
		cy * cz + sy * sx * sz,
		cx * sz,
		-sy * cz + cy * sx * sz,
		0,
		-cy * sz + sy * sx * cz,
		cx * cz,
		sy * sz + cy * sx * cz,
		0,
		sy * cx,
		-sx,
		cy * cx,
		0,
		x,
		y,
		z,
		1
	];
}

export function createScene() {
	const items = [];
	const scene = { items, hero: null, camera: null, world: null, eyeHeight: 0 };
	function push(o, texture, mode, rect, alpha, mesh, casts) {
		const data = new Float32Array(36);
		data.set(o.m ?? matrix(o.x ?? 0, o.y ?? 0, o.z ?? 0, o.rx ?? 0, o.ry ?? 0, o.rz ?? 0), 0);
		const tint = o.tint ?? WHITE;
		const opacity = o.o ?? 1;
		data[16] = o.w;
		data[17] = o.h;
		data[18] = o.r ?? 0;
		data[19] = o.th ?? 0;
		data[20] = rect[0];
		data[21] = rect[1];
		data[22] = rect[2];
		data[23] = rect[3];
		data[24] = tint[0];
		data[25] = tint[1];
		data[26] = tint[2];
		data[27] = opacity;
		data[28] = o.k ?? 0;
		data[29] = o.flutter ?? 0;
		data[30] = o.phase ?? 0;
		data[31] = o.drum ? 1 : 0;
		data[32] = mode;
		data[33] = o.gloss ?? 0.4;
		data[34] = o.emissive ?? 0;
		data[35] = o.shadow ?? 1;
		items.push({ data, texture, mesh, alpha, casts, mirror: o.mirror ?? true, depth: 0 });
	}
	return Object.assign(scene, {
		// A live DOM surface on a slab.
		panel(surface, o) {
			if (o.o !== undefined && o.o <= 0.001) return;
			const s = o.s ?? 1;
			const opts = {
				...o,
				w: o.w ?? surface.w * s,
				h: o.h ?? surface.h * s,
				r: o.r ?? (surface.radius ?? 0) * s,
				th: o.th ?? 0
			};
			const faded = (o.o ?? 1) < 0.999;
			push(
				opts,
				surface.texture,
				0,
				o.rect ?? IDENTITY_RECT,
				faded,
				o.mesh ?? 'slab',
				o.casts ?? true
			);
		},
		// Transparent type or artwork: no body, depth-sorted over everything else.
		text(surface, o) {
			if (o.o !== undefined && o.o <= 0.001) return;
			const s = o.s ?? 1;
			push(
				{ ...o, w: o.w ?? surface.w * s, h: o.h ?? surface.h * s, r: 0, th: 0 },
				surface.texture,
				1,
				o.rect ?? IDENTITY_RECT,
				true,
				'card',
				false
			);
		},
		flat(o) {
			if (o.o !== undefined && o.o <= 0.001) return;
			push(o, null, 2, IDENTITY_RECT, (o.o ?? 1) < 0.999, o.mesh ?? 'card', o.casts ?? true);
		},
		// The soft plate behind a surface: a box-shadow or ambient glow in 3D.
		plate(o) {
			if (o.o !== undefined && o.o <= 0.001) return;
			push({ ...o, gloss: o.blur ?? 40 }, null, 4, IDENTITY_RECT, true, 'card', false);
		},
		// A droplet or bubble facing the camera.
		bead(o) {
			if (o.o !== undefined && o.o <= 0.001) return;
			push(
				{
					...o,
					w: o.w ?? o.size,
					h: o.h ?? o.size,
					r: 0,
					th: 0,
					gloss: o.fill ?? 0
				},
				null,
				3,
				IDENTITY_RECT,
				true,
				'card',
				false
			);
		}
	});
}

// Rotate a billboard toward the eye.
export function facing(eye, x, y, z) {
	const dx = eye[0] - x,
		dy = eye[1] - y,
		dz = eye[2] - z;
	return { ry: Math.atan2(dx, dz), rx: -Math.atan2(dy, Math.hypot(dx, dz)) };
}

// Anchor something to the frame while it stays a real object in the scene.
export function screenAt(camera, nx, ny, dist) {
	const d = [
		camera.at[0] - camera.eye[0],
		camera.at[1] - camera.eye[1],
		camera.at[2] - camera.eye[2]
	];
	const l = Math.hypot(...d);
	const f = [d[0] / l, d[1] / l, d[2] / l];
	const side = Math.hypot(f[2], f[0]) || 1;
	const r = [-f[2] / side, 0, f[0] / side];
	const u = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
	const h = Math.tan((camera.fov * Math.PI) / 360) * dist;
	const w = (h * 16) / 9;
	return {
		x: camera.eye[0] + f[0] * dist + r[0] * nx * w + u[0] * ny * h,
		y: camera.eye[1] + f[1] * dist + r[1] * nx * w + u[1] * ny * h,
		z: camera.eye[2] + f[2] * dist + r[2] * nx * w + u[2] * ny * h,
		rx: Math.asin(f[1]),
		ry: Math.atan2(-f[0], -f[2]),
		perPixel: h / 540
	};
}
