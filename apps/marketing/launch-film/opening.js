// Acts I to IV. One drop falls, the drops become a flood, the flood pulls you under, and you come up on the logo.
import { BAR, BEAT, T, bar, cue } from './timeline.js';
import {
	between,
	clamp,
	ease,
	facing,
	lerp,
	matrix,
	mix3,
	prog,
	rand,
	rgb,
	smooth
} from './kit.js';

const DROP = rgb('#c9631f');
export const paper = {
	sunDir: [-0.45, 0.8, 0.5],
	sunStrength: 1.1,
	sunColor: [1, 0.96, 0.9],
	rippleSpeed: 360,
	skyTop: rgb('#f7f2eb'),
	skyCurve: 1.6,
	skyHorizon: rgb('#f3ece3'),
	glowDither: 2.4,
	deep: rgb('#ede4d9'),
	reflectMin: 0.66,
	underTop: rgb('#37a0b5'),
	underDeep: rgb('#04141f'),
	underFog: 0.00017,
	swell: 0,
	swellLength: 340,
	rippleWidth: 26,
	wallZ: 0,
	wallAmp: 0,
	shadowRange: 2800,
	shadowStrength: 0.3,
	shadowBlur: 12,
	mirror: true,
	drops: [],
	glows: [
		{ dir: [-0.62, 0.0, -1], power: 22, color: rgb('#f3a56f'), strength: 0.62 },
		{ dir: [0.62, 0.05, -1], power: 22, color: rgb('#c0a8f2'), strength: 0.6 },
		{ dir: [0.0, -0.24, -1], power: 34, color: rgb('#a9dde6'), strength: 0.36 }
	]
};
const storm = {
	...paper,
	sunStrength: 0.5,
	skyTop: rgb('#3a3f47'),
	skyHorizon: rgb('#6a5c55'),
	deep: rgb('#16252e'),
	reflectMin: 0.3,
	shadowStrength: 0.2,
	glows: [
		{ dir: [-0.62, 0.0, -1], power: 14, color: rgb('#b23a20'), strength: 0.6 },
		{ dir: [0.62, 0.05, -1], power: 14, color: rgb('#6a3a7a'), strength: 0.5 },
		{ dir: [0.0, -0.24, -1], power: 24, color: rgb('#2a5a6a'), strength: 0.3 }
	]
};
function blendWorld(a, b, p) {
	const out = { ...a };
	for (const key of ['sunStrength', 'skyCurve', 'reflectMin', 'shadowStrength', 'glowDither'])
		out[key] = lerp(a[key], b[key], p);
	for (const key of ['skyTop', 'skyHorizon', 'deep']) out[key] = mix3(a[key], b[key], p);
	out.glows = a.glows.map((g, i) => ({
		...g,
		color: mix3(g.color, b.glows[i].color, p),
		strength: lerp(g.strength, b.glows[i].strength, p)
	}));
	return out;
}

// Flood: the rhythm doubles every two bars. Each entry lands on the grid.
const landings = [];
{
	const spans = [
		[3, 5, 2],
		[5, 6, 4],
		[6, 7, 8],
		[7, 7.75, 16]
	];
	for (const [from, to, perBar] of spans)
		for (let t = bar(from); t < bar(to) - 1e-6; t += BAR / perBar) landings.push(t);
}
const flood = landings.map((at, i) => {
	const p = i / landings.length;
	const early = i < 10;
	// From the very first card they land all over the frame, around the line; later ones close in on the lens.
	const spots = [
		[-640, 860],
		[660, 200],
		[640, 880],
		[-660, 180],
		[-40, 620],
		[420, 560],
		[-900, 530],
		[900, 500],
		[-40, 960],
		[60, 90]
	];
	const x = early ? spots[i][0] : (rand(i, 1) - 0.5) * lerp(2600, 1500, p);
	// The late cards keep a clear band around the headline while it is still being read.
	const y0 = early ? spots[i][1] : lerp(120, 860, rand(i, 2));
	const y = early ? y0 : Math.abs(y0 - 440) < 95 ? 440 + (y0 < 440 ? -110 : 110) : y0;
	const z = early ? 240 + i * 34 : lerp(100, 1500, p ** 1.2) + (rand(i, 3) - 0.5) * 240;
	return {
		at,
		i,
		x,
		y,
		z,
		rx: (rand(i, 4) - 0.5) * 0.22,
		ry: (rand(i, 5) - 0.5) * 0.5 - x * 0.00016,
		rz: (rand(i, 6) - 0.5) * lerp(0.1, 0.42, p),
		size: early ? 1.32 : lerp(1.2, 1.6, p)
	};
});
const barrage = [
	['Resize.', bar(6)],
	['Rewrite.', bar(6.25)],
	['Reformat.', bar(6.5)],
	['Reconnect.', bar(6.75)],
	['Reschedule.', bar(7)],
	['Reply.', bar(7.25)],
	['Repeat.', bar(7.5)],
	['Repeat.', bar(7.625)]
];
const crash = Array.from({ length: 700 }, (_, i) => ({
	x: (rand(i, 7) - 0.5) * 2200,
	y: rand(i, 8) * 300,
	z: rand(i, 9),
	vx: (rand(i, 10) - 0.5) * 1100,
	vy: 400 + rand(i, 11) * 1900,
	size: 3 + rand(i, 12) ** 3 * 34
}));
const crown = Array.from({ length: 320 }, (_, i) => {
	const a = rand(i, 13) * Math.PI * 2;
	const speed = 500 + rand(i, 14) * 1600;
	return {
		x: Math.cos(a) * (260 + rand(i, 15) * 280),
		z: Math.sin(a) * (260 + rand(i, 16) * 280),
		vx: Math.cos(a) * speed * 0.55,
		vz: Math.sin(a) * speed * 0.55,
		vy: 700 + rand(i, 17) * 2100,
		size: 6 + rand(i, 18) ** 2.2 * 58,
		delay: rand(i, 19) * 0.12
	};
});
const bubbles = Array.from({ length: 150 }, (_, i) => {
	const x = (rand(i, 20) - 0.5) * 3000;
	const z = 2000 - 300 - rand(i, 21) * 2600;
	return {
		// Near the mark's plane, bubbles clear its silhouette instead of crossing it.
		x: Math.abs(z) < 400 && Math.abs(x) < 420 ? (x < 0 ? -1 : 1) * lerp(420, 900, rand(i, 96)) : x,
		z,
		phase: rand(i, 22),
		size: 6 + rand(i, 23) ** 2.5 * 54,
		speed: 180 + rand(i, 24) * 340
	};
});
// Sea spray for the flood. Bubbles start anywhere in the frame, above the headline as well as below it,
// and most of them float in front of the words.
const spray = Array.from({ length: 56 }, (_, i) => ({
	x: (rand(i, 90) - 0.5) * 3000,
	z: lerp(260, 1000, rand(i, 91)),
	size: 16 + rand(i, 92) ** 2 * 48,
	speed: 200 + rand(i, 93) * 420,
	delay: rand(i, 94) * 1.8,
	start: rand(i, 97) * 1520,
	wobble: rand(i, 95) * 6
}));
const sinking = Array.from({ length: 34 }, (_, i) => ({
	i,
	x: (i % 2 ? 1 : -1) * (560 + rand(i, 25) * 1000),
	z: lerp(-1400, 1500, rand(i, 26)),
	y: rand(i, 27),
	spinX: (rand(i, 28) - 0.5) * 1.1,
	spinY: (rand(i, 29) - 0.5) * 1.3,
	spinZ: (rand(i, 30) - 0.5) * 0.9,
	phase: rand(i, 31) * 6
}));

// The Converge mark is one module four times: each part's sign mirrors it into its quadrant.
const heroParts = [
	{ sign: [1, 1], from: [-1, 1] },
	{ sign: [-1, 1], from: [1, 1] },
	{ sign: [1, -1], from: [-1, -1] },
	{ sign: [-1, -1], from: [1, -1] }
];
function partMatrix({ sign }, c, rot, scale) {
	// World into a module's own space: undo position and rotation, then scale and mirror.
	const [rx, ry, rz] = rot;
	const m = matrix(0, 0, 0, rx, ry, rz);
	const R = [m[0], m[1], m[2], m[4], m[5], m[6], m[8], m[9], m[10]];
	const col = (x, y, z) => [
		R[0] * x + R[1] * y + R[2] * z,
		R[3] * x + R[4] * y + R[5] * z,
		R[6] * x + R[7] * y + R[8] * z
	];
	const a = col(1, 0, 0),
		b = col(0, 1, 0),
		d = col(0, 0, 1);
	const sx = sign[0] / scale,
		sy = sign[1] / scale,
		sz = 1 / scale;
	const out = [
		a[0] * sx,
		b[0] * sy,
		d[0] * sz,
		0,
		a[1] * sx,
		b[1] * sy,
		d[1] * sz,
		0,
		a[2] * sx,
		b[2] * sy,
		d[2] * sz,
		0
	];
	const t = (x, y, z) => -(x * c[0] + y * c[1] + z * c[2]);
	out.push(t(out[0], out[4], out[8]), t(out[1], out[5], out[9]), t(out[2], out[6], out[10]), 1);
	return out;
}
export function hero(
	scene,
	{
		center,
		scale,
		spread = 0,
		spin = [0, 0, 0],
		glow = 0,
		turn = [],
		color = rgb('#a8460b'),
		eye,
		depth = 14
	}
) {
	const parts = new Float32Array(64);
	heroParts.forEach((part, i) => {
		const offset = [part.from[0] * spread, part.from[1] * spread, 0];
		const m = matrix(0, 0, 0, ...spin);
		const c = [
			center[0] + m[0] * offset[0] + m[4] * offset[1],
			center[1] + m[1] * offset[0] + m[5] * offset[1],
			center[2] + m[2] * offset[0] + m[6] * offset[1]
		];
		const r = turn[i] ?? [0, 0, 0];
		parts.set(partMatrix(part, c, [spin[0] + r[0], spin[1] + r[1], spin[2] + r[2]], scale), i * 16);
	});
	const distance = Math.hypot(eye[0] - center[0], eye[1] - center[1], eye[2] - center[2]);
	const reach = scale * 128 + spread * 2.4;
	scene.hero = {
		parts,
		scale,
		depth,
		near: Math.max(distance - reach, 10),
		far: distance + reach,
		color: [...color, glow]
	};
}

let lineState = '';
function setLine(s, text, caret) {
	const key = `${text}|${caret}`;
	if (key === lineState) return;
	lineState = key;
	const [span, bar_] = s.line.element.querySelectorAll('span, i');
	span.textContent = text;
	bar_.style.opacity = caret ? '1' : '0';
	s.line.dirty = true;
}
const typed = (t, start, end, text) =>
	text.slice(0, Math.round(clamp((t - start) / (end - start)) * text.length));

const LINE_A = 'You shipped';
const LINE_B = 'Now tell everyone.';
const checkAt = (i) => T.splash + 0.8 + i * BEAT * 0.75;
// The dots land on the beat, one at a time.
const TEAM = {
	in: T.team - 0.3,
	dots: [0.5, 1, 1.5].map((at) => T.team + at),
	out: T.team + 2
};
const MEET = 'Meet your\ncontent team.';
const NAME = 'OpenPost';
const WRITE = {
	in: 0.95,
	erase: T.promise + 0.5,
	erased: 0.34,
	name: T.promise + 0.95,
	named: 0.5
};
let lineWidthA = 1100;
let lineWidthB = 1500;
let wordWidth = 790;
let barrageState = '';
let promiseState = '';
let teamState = '';
export const opening = {
	surfaces: (t) => {
		const on = [];
		if (t < T.barrage + 0.1) on.push('line');
		if (t > T.splash - 0.1 && t < T.tell + 1) on.push('release');
		if (t > T.barrage - 0.1 && t < T.under) on.push('barrage');
		if (t >= T.word - 0.15 && t < T.open - 0.7) on.push('promise');
		if (t >= T.team - 0.4 && t < T.team + 2.4) on.push('team');
		return on;
	},
	dom(t, s) {
		if (t < T.fall) {
			const text = t < T.stop ? typed(t, T.typing, T.stop - 0.02, LINE_A) : `${LINE_A}.`;
			const blink = t < T.typing ? Math.floor(t / BEAT / 0.5) % 2 === 0 : true;
			setLine(s, text, blink && t < T.stop + 0.1);
		} else if (t < T.tell) {
			setLine(s, LINE_A, false);
		} else {
			setLine(
				s,
				typed(t, T.tell, T.tell + 1.2, LINE_B),
				t < T.tell + 1.5 && Math.floor(t * 4) % 2 === 0
			);
		}
		s.release.checks.forEach((row, i) => {
			const shown = t >= checkAt(i);
			const value = shown ? '1' : '0.16';
			if (row.style.opacity !== value) {
				row.style.opacity = value;
				s.release.dirty = true;
			}
		});
		const word = [...barrage].reverse().find(([, at]) => t >= at)?.[0] ?? '';
		if (word !== barrageState) {
			barrageState = word;
			s.barrage.element.querySelector('span').textContent = word;
			s.barrage.dirty = true;
		}
		if (t >= T.team - 0.4 && t < T.team + 2.4) {
			const key = [
				...s.team.words.map((_, i) =>
					prog(t, TEAM.in + i * 0.14, TEAM.in + i * 0.14 + 0.5).toFixed(2)
				),
				...TEAM.dots.map((at) => t >= at)
			].join('|');
			if (key !== teamState) {
				teamState = key;
				s.team.words.forEach((word, i) => {
					word.style.opacity = prog(t, TEAM.in + i * 0.14, TEAM.in + i * 0.14 + 0.5).toFixed(2);
				});
				s.team.dots.forEach((dot, i) => {
					dot.style.opacity = t >= TEAM.dots[i] ? '1' : '0';
				});
				s.team.dirty = true;
			}
		}
		// The promise is written beside the mark, erased, and the name is typed in its place.
		if (t >= T.word - 0.2 && t < T.open - 0.7) {
			const written = Math.round(clamp((t - T.word) / WRITE.in) * MEET.length);
			const left = Math.round(
				written * (1 - prog(t, WRITE.erase, WRITE.erase + WRITE.erased, ease.in))
			);
			const named = Math.round(clamp((t - WRITE.name) / WRITE.named) * NAME.length);
			const typing =
				between(t, T.word, T.word + WRITE.in) || between(t, WRITE.erase, WRITE.name + WRITE.named);
			const caret = (typing || Math.floor(t * 4) % 2 === 0) && t < WRITE.name + WRITE.named + 0.5;
			const key = `${left}|${named}|${caret}`;
			if (key !== promiseState) {
				promiseState = key;
				s.promise.first.textContent = MEET.slice(0, Math.min(left, 10));
				s.promise.second.textContent = MEET.slice(10, Math.max(left, 10));
				s.promise.word.textContent = NAME.slice(0, named);
				s.promise.row.classList.toggle('word-mode', t >= WRITE.name);
				s.promise.caret.style.opacity = caret ? '1' : '0';
				s.promise.dirty = true;
			}
		}
	},
	measure(s) {
		const span = s.line.element.querySelector('span');
		span.textContent = `${LINE_A}.`;
		lineWidthA = span.getBoundingClientRect().width;
		span.textContent = LINE_B;
		lineWidthB = span.getBoundingClientRect().width;
		span.textContent = '';
		wordWidth =
			s.wordmark.element.firstElementChild.firstElementChild.getBoundingClientRect().width;
		s.wordmark.textWidth = wordWidth;
	},
	draw(scene, t, s) {
		const world = worldAt(t);
		scene.world = world;
		if (t < T.under) surfaceAct(scene, t, s);
		else if (t < T.breach) underAct(scene, t, s);
		else upAct(scene, t, s);
	},
	shakes
};

function wallAt(t) {
	const p = prog(t, T.wave - 0.5, T.under + 0.1, ease.in);
	return { amp: p > 0 ? 800 * smooth(clamp(p * 1.6)) : 0, z: lerp(-2600, 2500, p) };
}
function worldAt(t) {
	const dark = prog(t, bar(5), bar(7.6), ease.inOut);
	const base = t < T.breach ? blendWorld(paper, storm, dark) : paper;
	const world = { ...base };
	const swellIn = prog(t, bar(4.5), bar(7.8), ease.in);
	world.swell = t < T.breach ? 220 * swellIn : 0;
	world.swellLength = 300;
	const wall = wallAt(t);
	if (t < T.under + 0.3) {
		world.wallAmp = wall.amp;
		world.wallZ = wall.z;
	}
	const drops = [];
	if (t >= T.splash) drops.push({ x: 0, z: 0, t: T.splash, amp: 20 });
	for (const f of flood)
		if (t >= f.at) drops.push({ x: f.x, z: f.z, t: f.at, amp: lerp(14, 26, f.i / flood.length) });
	if (t >= T.breach) drops.push({ x: 0, z: 0, t: T.breach, amp: 34 });
	if (t >= T.breach + 0.5) drops.push({ x: 0, z: 0, t: T.breach + 0.5, amp: 18 });
	world.drops = drops.slice(-48);
	return world;
}
function eyeWater(t, eye) {
	const wall = wallAt(t);
	const z = (eye[2] - wall.z) / 520;
	return wall.amp * Math.exp(-z * z);
}

function forwardOf({ eye, at }) {
	const d = [at[0] - eye[0], at[1] - eye[1], at[2] - eye[2]];
	const l = Math.hypot(...d);
	return [d[0] / l, d[1] / l, d[2] / l];
}

function surfaceAct(scene, t, s) {
	// The whole word stays readable: the camera drifts after the caret instead of sitting on it.
	const width = lineWidthA;
	const left = -width;
	const caretTravel = prog(t, T.typing - 0.2, T.stop + 0.3, ease.sine);
	const caretX = lerp(left * 0.56, left * 0.44, caretTravel);
	const fallStart = T.fall;
	// The camera lets the word finish reading before it follows the drop down, so the line never clips.
	const follow = prog(t, T.fall + 0.1, T.splash + 0.2, ease.inOut);
	const retreat = prog(t, T.splash, T.tell, ease.expoOut);
	// The frame opens before the line starts, so "Now tell everyone." types without drifting off the edge.
	const pull = prog(t, T.tell - 0.55, T.tell + 0.75, ease.inOut);
	const drift = prog(t, T.flood, T.under, ease.linear);
	const engulfed = prog(t, T.wave, T.under, ease.in);
	const eye = [
		lerp(caretX - 90, 0, follow),
		lerp(lerp(460, 420, follow), 330, retreat) + pull * 120 - drift * drift * 260 - engulfed * 300,
		lerp(lerp(1960, 1800, caretTravel), 1950, Math.max(follow * 0.4, retreat)) +
			pull * 700 -
			drift * 300
	];
	const at = [lerp(caretX, 0, follow), lerp(lerp(450, 90, follow), 340, retreat) + pull * 80, 0];
	const sway = prog(t, bar(4.5), bar(7.8), ease.in);
	scene.camera = {
		eye,
		at,
		fov: 30,
		roll: Math.sin(t * 1.3) * 0.06 * sway + Math.sin(t * 2.9) * 0.025 * sway,
		aperture: lerp(10, 26, prog(t, T.flood, bar(6), ease.inOut)),
		focus: Math.hypot(eye[2] - at[2], eye[1] - at[1])
	};
	scene.eyeHeight = eyeWater(t, eye);

	// The line itself: the word ends on the drop's own column.
	const lineOut = 1 - prog(t, T.splash - 0.2, T.splash + 0.25);
	if (t < T.splash + 0.3) {
		scene.text(s.line, { x: left + s.line.w / 2, y: 440, z: 0, o: lineOut });
	}
	const period = { x: -19, size: 42 };
	if (t >= T.fall && t < T.splash) {
		const age = t - fallStart;
		const g = 430 / (BAR / 4) ** 2;
		const y = 395 - 0.5 * g * age * age;
		const stretch = 1 + Math.min(age * 2.4, 0.7);
		if (y > 0) {
			scene.bead({
				x: period.x * (1 - prog(t, T.fall, T.splash)),
				y,
				z: 2,
				tint: DROP,
				fill: 1,
				...facing(eye, 0, y, 0),
				w: period.size / Math.sqrt(stretch),
				h: period.size * stretch
			});
		}
	}
	// A little crown of beads at the first splash.
	if (t >= T.splash && t < T.splash + 0.8) {
		for (let i = 0; i < 26; i++) {
			const a = (i / 26) * Math.PI * 2;
			const age = t - T.splash;
			const speed = 160 + rand(i, 40) * 260;
			const y = (420 + rand(i, 41) * 340) * age - 900 * age * age;
			if (y < 0) continue;
			const x = Math.cos(a) * speed * age,
				z = Math.sin(a) * speed * age;
			scene.bead({
				x,
				y,
				z,
				size: 9 + rand(i, 42) * 13,
				tint: DROP,
				fill: 1,
				...facing(eye, x, y, z)
			});
		}
	}

	// The release rises through the ripple, then steps back to make room for the line.
	if (t >= T.splash - 0.05 && t < T.tell + 0.9) {
		const up = prog(t, T.splash, T.splash + 0.8, ease.back);
		// Done, and already forgotten: the release slips back under as the next job starts.
		const back = prog(t, T.tell - 0.45, T.tell + 0.4, ease.inOut);
		const y = lerp(-340, 372, up) - back * 900;
		scene.plate({
			x: 0,
			y: y - 34,
			z: -60,
			w: 1400,
			h: 925,
			r: 90,
			blur: 110,
			tint: rgb('#c9631f'),
			o: 0.26 * up * (1 - back),
			ry: lerp(-0.3, 0, up)
		});
		scene.panel(s.release, {
			x: 0,
			y,
			z: 0,
			s: 1.25,
			rx: lerp(0.5, 0, up) + Math.sin(t * 1.1) * 0.012,
			ry: lerp(-0.42, 0, up) + Math.sin(t * 0.8) * 0.018,
			th: 12,
			gloss: 0.5,
			k: lerp(0.0006, 0, up)
		});
	}
	// "Now tell everyone." steps forward.
	if (t >= T.tell) {
		const fade = 1 - prog(t, bar(5.5), bar(6), ease.in);
		scene.text(s.line, {
			x: (s.line.w / 2 - lineWidthB / 2) * 0.72,
			y: 440,
			z: 500,
			o: fade,
			s: 0.72
		});
	}
	// The demands land.
	for (const f of flood) {
		if (t < f.at - 0.28) continue;
		const fall = prog(t, f.at - 0.28, f.at, ease.in);
		const settle = prog(t, f.at, f.at + 0.5, ease.spring);
		const bob = Math.sin(t * 2.1 + f.i) * 12 * (1 + sway * 6);
		const lift = prog(t, T.wave, T.under, ease.in);
		const y =
			lerp(f.y + 460, f.y, fall) +
			(t > f.at ? (1 - settle) * -36 + bob : 0) +
			lift * (900 + rand(f.i, 60) * 1300);
		// While a card is still falling it passes behind the headline instead of across the words.
		if (f.i >= 10 && fall < 1 && Math.abs(y - 440) < 150) continue;
		const w = s.chips.chip.w * f.size,
			h = s.chips.chip.h * f.size;
		scene.plate({
			x: f.x,
			y: y - 16,
			z: f.z - 14,
			w: w + 90,
			h: h + 90,
			r: 60,
			blur: 34,
			tint: rgb('#3c2a1e'),
			o: 0.2 * fall,
			rx: f.rx,
			ry: f.ry,
			rz: f.rz
		});
		scene.panel(s.chips, {
			x: f.x,
			y,
			z: f.z,
			w,
			h,
			o: Math.min(fall * 2.5, 1),
			r: 26 * f.size,
			th: 8,
			rx: f.rx,
			ry: f.ry,
			rz: f.rz,
			rect: s.chips.rect(f.i),
			mesh: 'card',
			gloss: 0.5
		});
	}
	// Bubbles rise through the whole frame, above the line as well, thickening with the storm.
	if (t >= T.tell) {
		const stormIn = prog(t, T.tell, T.wave, ease.in);
		for (const b of spray) {
			const age = t - T.tell - b.delay;
			if (age < 0) continue;
			const y = ((b.start + age * b.speed) % 1520) - 60;
			const px = b.x + Math.sin(t * 2 + b.wobble) * 26;
			scene.bead({
				x: px,
				y,
				z: b.z,
				size: b.size * prog(age, 0, 0.32, ease.back),
				tint: rgb('#4d9cbd'),
				fill: 0.6,
				o: 0.6 + stormIn * 0.38,
				mirror: false,
				...facing(eye, px, y, b.z)
			});
		}
	}
	// The words, in the viewer's face.
	if (t >= T.barrage && t < T.wave) {
		// Drawn after the shake is applied: the world rattles and the word stays locked to the eye.
		scene.after = () => {
			const word = [...barrage].reverse().find(([, at]) => t >= at);
			const beat = word ? t - word[1] : 0;
			const pop = 1 + 0.18 * Math.exp(-beat * 9);
			const camera = scene.camera;
			const f = forwardOf(camera);
			const near = 330;
			const c = [
				camera.eye[0] + f[0] * near,
				camera.eye[1] + f[1] * near,
				camera.eye[2] + f[2] * near
			];
			const tilt = {
				rx: Math.asin(f[1]),
				ry: Math.atan2(-f[0], -f[2]),
				rz: -(camera.roll ?? 0) + (rand(Math.floor(t * 8), 50) - 0.5) * 0.07
			};
			camera.focus = near;
			camera.aperture = 7;
			scene.flat({
				x: c[0] + f[0] * 8,
				y: c[1] + f[1] * 8,
				z: c[2] + f[2] * 8,
				...tilt,
				w: 1000,
				h: 600,
				tint: rgb('#160a08'),
				o: 0.6,
				casts: false,
				gloss: 0
			});
			scene.text(s.barrage, { x: c[0], y: c[1], z: c[2], ...tilt, s: 0.154 * pop });
		};
	}
	// The wall takes the lens.
	if (t >= T.wave) {
		const age = t - T.wave;
		for (const [i, c] of crash.entries()) {
			if (i > (age / 0.5) * crash.length) continue;
			const x = eye[0] + (c.x + c.vx * age) * 0.42,
				y = eye[1] - 240 + (c.y + c.vy * age - 900 * age * age) * 0.42,
				z = eye[2] - lerp(260, 1300, c.z);
			scene.bead({
				x,
				y,
				z,
				size: c.size,
				tint: rgb('#cfe9ef'),
				fill: 0,
				o: 0.9,
				...facing(eye, x, y, z)
			});
		}
	}
}

function underAct(scene, t, s) {
	const rise = prog(t, T.rise, T.breach, ease.expoIn);
	const riseSlow = prog(t, T.rise, T.breach, ease.in);
	const sink = prog(t, T.under, T.rise, ease.out);
	const y = lerp(-420, -1500, sink) + riseSlow * 1000 + rise * 900;
	const hit = Math.exp(-(t - T.under) * 3);
	const eye = [Math.sin(t * 0.7) * 30, y, 2000];
	const upTilt = prog(t, T.gather - 0.4, T.rise + 0.8, ease.inOut);
	scene.camera = {
		eye,
		at: [0, y + lerp(-260, 300, upTilt), 0],
		fov: 32,
		roll: Math.sin(t * 0.6) * 0.05 + hit * Math.sin(t * 9) * 0.3,
		aperture: 30,
		focus: 1500
	};
	scene.eyeHeight = 100000;
	const world = scene.world;
	world.mirror = false;
	world.shadowStrength = 0;

	// Everything that was on your plate sinks with you, turning slowly.
	const speedUp = riseSlow * 2600 + rise * 2600;
	for (const c of sinking) {
		const age = t - T.under;
		const fallY = y + 1100 - c.y * 2600 - age * lerp(120, 300, c.y);
		const wrap = ((((fallY + speedUp * -1 - y + 2000) % 4000) + 4000) % 4000) - 2000 + y;
		const w = s.chips.chip.w * 1.3,
			h = s.chips.chip.h * 1.3;
		scene.panel(s.chips, {
			x: c.x,
			y: wrap,
			z: c.z,
			w,
			h,
			r: 30,
			th: 8,
			mesh: 'card',
			rect: s.chips.rect(c.i * 5),
			rx: c.spinX * age + c.phase,
			ry: c.spinY * age + c.phase * 2,
			rz: c.spinZ * age,
			flutter: 5,
			phase: t * 1.1 + c.phase,
			gloss: 0.3,
			casts: false
		});
	}
	for (const b of bubbles) {
		const span = 3400;
		const h =
			(b.phase * span + (t - T.under) * b.speed * (1 + hit * 3) + riseSlow * -2400 * b.phase) %
			span;
		const py = y - span / 2 + h;
		const px = b.x + Math.sin(t * 1.4 + b.phase * 20) * 30;
		scene.bead({
			x: px,
			y: py,
			z: b.z,
			size: b.size,
			tint: rgb('#a7e6f0'),
			fill: 0,
			o: 0.8,
			...facing(eye, px, py, b.z)
		});
	}
	// Four lights come down and find each other.
	if (t >= T.team + 2) {
		const gather = prog(t, T.team + 2, T.gather + BAR * 0.2, ease.inOut);
		const lock = prog(t, T.gather + BAR * 0.2, T.gather + BAR * 0.26, ease.linear);
		const pulse = t >= T.rise ? Math.exp(-(t - T.rise) * 2.5) : 0;
		hero(scene, {
			center: [
				0,
				y +
					lerp(1900, 0, ease.out(prog(t, T.team + 2, T.gather + BAR * 0.2, ease.linear))) +
					rise * 80,
				0
			],
			scale: 5.6,
			spread: lerp(1100, 0, gather),
			spin: [0.12, Math.sin(t * 0.8) * 0.2, lerp(1.2, 0, gather)],
			glow: 0.9 + pulse * 3 + rise * 3 + lock * 0.4,
			eye,
			color: rgb('#d9691c')
		});
	}
}

function upAct(scene, t, s) {
	if (t < T.breach) return;
	const age = t - T.breach;
	const settle = prog(t, T.breach, T.breach + 1.1, ease.expoOut);
	const open = prog(t, T.open, T.workflow + 0.15, ease.expoIn);
	// The mark lands, then steps left and leaves room for the words to write themselves beside it.
	const lockup = prog(t, T.breach + 0.55, T.word - 0.05, ease.expoInOut);
	const leave = prog(t, T.open - 0.1, T.workflow, ease.in);
	const eye = [
		Math.sin(t * 0.5) * 16 * (1 - lockup),
		lerp(120, 330, settle),
		lerp(2000, 2100, settle) - leave * 2000
	];
	const at = [0, lerp(620, 520, settle), 0];
	eye[1] = lerp(eye[1], 520, leave);
	scene.camera = {
		eye,
		at,
		fov: 30,
		roll: Math.exp(-age * 5) * Math.sin(age * 22) * 0.04,
		aperture: 6,
		focus: Math.max(eye[2], 200)
	};
	scene.eyeHeight = -100000;
	scene.world.mirror = true;
	const y =
		lerp(-500, 560, ease.expoOut(clamp(age / 0.75))) + Math.sin(age * 2.2) * 8 * (1 - lockup);
	// Once the name has gone the mark returns to the centre, so the camera can dive through its diamond.
	const home = prog(t, T.open - 0.8, T.open - 0.05, ease.expoInOut);
	const side = lockup * (1 - home);
	const size = lerp(lerp(6.6, 3.4, lockup), 4.6, home);
	const total = 128 * 3.4 + 56 + wordWidth * 0.95;
	hero(scene, {
		center: [lerp(0, -total / 2 + 64 * 3.4, side), lerp(y, 560, lockup), 0],
		scale: size,
		spread: open * 900,
		spin: [lerp(0.5, 0, settle), lerp(Math.PI * 2, 0, settle), 0],
		glow: 0.12 + Math.exp(-age * 2.4) * 0.9,
		eye,
		depth: 13
	});
	for (const c of crown) {
		const a = age - c.delay;
		if (a < 0 || a > 0.9) continue;
		const x = c.x + c.vx * a,
			z = c.z + c.vz * a,
			y2 = c.vy * a - 1500 * a * a;
		if (y2 < 0) continue;
		scene.bead({
			x,
			y: y2,
			z,
			size: c.size,
			tint: rgb('#f7efe6'),
			fill: 0.1,
			...facing(eye, x, y2, z),
			o: 1 - a / 0.9
		});
	}
	const words =
		prog(t, T.word - 0.14, T.word, ease.out) * (1 - prog(t, T.open - 1.05, T.open - 0.82, ease.in));
	if (words > 0.001)
		scene.text(s.promise, {
			x: -total / 2 + 128 * 3.4 + 56 + (s.promise.w * 0.95) / 2,
			y: 556,
			z: 0,
			o: words,
			s: 0.95
		});
}

function shakes() {
	const list = [{ t: T.splash, power: 0.25, decay: 9 }];
	for (const f of flood)
		list.push({ t: f.at, power: lerp(0.18, 1.1, (f.i / flood.length) ** 1.6), decay: 13 });
	list.push({ t: T.under - 0.02, power: 5, decay: 3.2 });
	list.push({ t: T.rise, power: 0.8, decay: 4 });
	list.push({ t: T.breach, power: 4, decay: 4.2 });
	return list;
}
export function openingFx(t) {
	const fx = {};
	const chaos = prog(t, bar(5), bar(7.8), ease.in);
	const hit = flood.reduce(
		(sum, f) => (t >= f.at ? sum + Math.exp(-(t - f.at) * 12) * (f.i / flood.length) : sum),
		0
	);
	if (t < T.under) {
		fx.chromatic = 0.0012 + chaos * 0.01 + hit * 0.012;
		fx.glitch = t > bar(6) ? chaos * 0.8 * (Math.sin(t * 18) > 0.2 ? 1 : 0.2) : 0;
		fx.pulse = [
			0.9,
			0.12,
			0.08,
			chaos * 0.32 * (0.55 + 0.45 * Math.sin((t * Math.PI) / BEAT) ** 2) + hit * 0.1
		];
		fx.vignette = 0.05 + chaos * 0.42;
		if (t >= T.wave) fx.underwater = 1;
		fx.flash = [1, 1, 1, Math.max(0, 1 - Math.abs(t - T.under) * 14) * 0.9];
	} else if (t < T.breach) {
		fx.underwater = 1;
		fx.vignette = 0.46;
		fx.chromatic = 0.003;
		fx.dither = 0.82;
		fx.bloom = 0.26;
		const rise = prog(t, T.rise, T.breach, ease.in);
		fx.exposure = 1 + rise * 0.7;
		fx.flash = [1, 1, 1, prog(t, T.breach - 0.1, T.breach, ease.in) * 0.7];
		// The line sinks a little as it is read, and leaves before the lights arrive.
		fx.caption = t >= TEAM.in ? 1 - prog(t, TEAM.out, TEAM.out + 0.3, ease.in) : 0;
		fx.captionBox = [110, 436 + prog(t, TEAM.in, TEAM.out + 0.3, ease.linear) * 18, 1700, 200];
	} else {
		const age = t - T.breach;
		fx.flash = [1, 1, 1, Math.exp(-age * 6) * 0.85];
		fx.chromatic = 0.0012 + Math.exp(-age * 3) * 0.012;
		fx.droplets = Math.max(0, 1 - age / 1.9) ** 1.6;
		fx.dropletTime = age;
	}
	return fx;
}

// --- Sound ---------------------------------------------------------------------------------------
// The caret is the first sound: a soft tick on each blink before the typing starts.
cue(0.02, 'tick', { gain_db: -4 });
cue(0.25, 'tick', { gain_db: -7 });
for (let i = 0; i < LINE_A.length; i++)
	if (LINE_A[i] !== ' ') cue(T.typing + (i / LINE_A.length) * (T.stop - T.typing), 'key');
cue(T.stop, 'key', { gain_db: 5 });
cue(T.splash, 'plop', { gain_db: 3 });
cue(T.splash + 0.1, 'whoosh', { gain_db: -6 });
[0, 1, 2].forEach((i) => cue(checkAt(i), 'tick'));
for (let i = 0; i < LINE_B.length; i++)
	if (LINE_B[i] !== ' ') cue(T.tell + (i / LINE_B.length) * 1.2, 'key', { gain_db: -2 });
flood.forEach((f, i) => {
	const p = i / flood.length;
	cue(f.at, i < 8 ? 'plop' : 'slam', { gain_db: lerp(-7, 0, p) });
	if (i < 12) cue(f.at + 0.01, 'pop', { gain_db: -4 });
});
barrage.forEach(([, at]) => cue(at, 'slam', { gain_db: 1 }));
cue(T.wave - 0.5, 'riser', { ends: T.under, gain_db: 2 });
cue(T.under, 'splash', { gain_db: 2 });
cue(T.under, 'boom', { gain_db: 3 });
cue(T.under + 0.05, 'bubbles');
cue(T.under, 'ambience', { until: T.breach - 0.25 });
TEAM.dots.forEach((at) => cue(at, 'pop', { gain_db: -5 }));
cue(T.team + 2.2, 'bubbles', { gain_db: -6 });
cue(T.gather + BAR * 0.2, 'boom', { gain_db: -3 });
cue(T.rise - 0.05, 'bubbles', { gain_db: -2 });
cue(T.rise, 'riser', { ends: T.gasp, gain_db: -1 });
cue(T.breach, 'surfacing', { gain_db: 3 });
cue(T.breach, 'boom', { gain_db: 4 });
cue(T.breach, 'impact', { gain_db: 2 });
cue(T.breach + 0.03, 'shimmer');
for (let i = 0; i < 12; i++) cue(T.word + 0.04 + (i / 12) * 0.88, 'key', { gain_db: -5 });
for (let i = 0; i < 5; i++) cue(WRITE.erase + (i / 5) * WRITE.erased, 'key', { gain_db: -8 });
for (let i = 0; i < NAME.length; i++)
	cue(WRITE.name + (i / NAME.length) * WRITE.named, 'key', { gain_db: -3 });
cue(WRITE.name + WRITE.named + 0.02, 'land');
