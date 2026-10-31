// Acts V and VI: what the founder gets. One clear idea at a time, with the camera easing between them.
// Scenes share one layout: the title centres 150px down the frame and content stays in the band below it.
// Most are framed at PIXEL_D with the camera at y = 540, where a world point sits at (x + 960, 1080 - y).
import { BEAT, DURATION, T, cue } from './timeline.js';
import {
	PIXEL_D,
	between,
	clamp,
	ease,
	facing,
	lerp,
	matrix,
	prog,
	rand,
	rgb,
	screenAt
} from './kit.js';
import { anchorOf, script } from './surfaces.js';
import { hero, paper } from './opening.js';

const DROP = rgb('#c9631f');
const LINE = rgb('#cfc5bc');
const pos = (a, b, p) => [lerp(a[0], b[0], p), lerp(a[1], b[1], p), lerp(a[2], b[2], p)];
const palette = ['#c9631f', '#a48bc4', '#4b966b', '#3d8bfd', '#e9a066'];
// Positions measured from the DOM once, so hands land on the controls they press.
const spots = {};

function hand(scene, s, p, press = 0, o = 1) {
	const scale = 0.5 * (1 - press * 0.14);
	const x = p[0] + 10 * scale,
		y = p[1] - 118 * scale,
		z = p[2] + 34;
	scene.plate({
		x: x + 16,
		y: y - 22,
		z: z - 26,
		w: 170,
		h: 200,
		r: 70,
		blur: 46,
		tint: rgb('#2b1a10'),
		o: 0.3 * o
	});
	scene.text(s.hand, { x, y, z, s: scale, o });
}
function shadowCard(scene, o) {
	scene.plate({
		x: o.x,
		y: o.y - (o.drop ?? 24),
		z: o.z - 40,
		w: o.w + 130,
		h: o.h + 130,
		r: o.r ?? 90,
		blur: 60,
		tint: o.tint ?? rgb('#6a3a1c'),
		o: o.o ?? 0.2,
		rx: o.rx,
		ry: o.ry,
		rz: o.rz
	});
}
function title(scene, surface, nx, ny, dist, scale = 1, o = 1) {
	const at = screenAt(scene.camera, nx, ny, dist);
	scene.text(surface, {
		x: at.x,
		y: at.y,
		z: at.z,
		rx: at.rx,
		ry: at.ry,
		s: at.perPixel * scale,
		o
	});
}
// Every product line sits on the same row at the same size, on the focal plane so it stays sharp.
const heading = (scene, surface, o = 1) =>
	title(scene, surface, 0, 390 / 540, scene.camera.focus, 0.75, o);
const level = (x = 0, y = 540, aperture = 5) => ({
	eye: [x, y, PIXEL_D],
	at: [x, y, 0],
	fov: 30,
	aperture,
	focus: PIXEL_D
});
function state(s, key, apply) {
	if (s.key === key) return;
	s.key = key;
	apply();
	s.dirty = true;
}
function kinetic(s, t, start, end = Infinity) {
	const active = t > start - 0.05 && t < end + 0.7;
	const settled = t > start + 1.1 && t < end;
	if (!active && s.key === 'off') return;
	if (settled && s.key === 'held') return;
	s.key = settled ? 'held' : active ? '' : 'off';
	s.words.forEach((word, i) => {
		const inn = prog(t, start + i * 0.05, start + i * 0.05 + 0.55, ease.expoOut);
		const out = prog(t, end, end + 0.28, ease.in);
		word.style.transform = `translateY(${(1 - inn) * 0.4 - out * 0.3}em)`;
		word.style.opacity = String(inn * (1 - out));
		const blur = (1 - inn) * 12 + out * 8;
		word.style.filter = blur > 0.1 ? `blur(${blur}px)` : '';
	});
	s.dirty = true;
}
// Eased moves between held framings, instead of glueing the lens to whatever is moving.
function track(t, start, moves) {
	let value = start;
	for (const [from, to, target] of moves) {
		const p = prog(t, from, to, ease.inOut);
		value = value.map((v, i) => lerp(v, target[i], p));
	}
	return value;
}
// A hard camera whip, hidden in its own motion blur: the yaw leaves fast and arrives fast.
function whip(t, at, power = 1) {
	const a = prog(t, at - 0.16, at, ease.expoIn);
	const b = t >= at ? 1 - prog(t, at, at + 0.22, ease.expoOut) : 0;
	return t < at ? a * 0.5 * power : -b * 0.5 * power;
}
function yawed(camera, yaw) {
	if (!yaw) return camera;
	const dx = camera.at[0] - camera.eye[0],
		dz = camera.at[2] - camera.eye[2];
	const c = Math.cos(yaw),
		n = Math.sin(yaw);
	camera.at = [camera.eye[0] + dx * c - dz * n, camera.at[1], camera.eye[2] + dx * n + dz * c];
	return camera;
}
function confettiPiece(scene, x, y, z, c, age, o) {
	scene.flat({
		x,
		y,
		z,
		w: c.size,
		h: c.size * 0.62,
		rx: age * c.spin,
		ry: age * c.spin * 0.7,
		rz: c.a,
		tint: c.tint,
		r: 2,
		gloss: 0,
		emissive: 0.1,
		casts: false,
		o
	});
}

// --- Workflow: the release runs along a glowing line, one readable step at a time ------------------
const W = T.workflow;
const NODE = { w: 430, h: 158 };
const COMPOSE = { x: 2280, y: 560, z: 0 };
const nodes = {
	nodeRelease: [0, 520],
	nodeStable: [760, 520],
	nodeBuild: [1520, 760],
	nodeReview: [2280, 760],
	nodeWait: [1520, 280],
	nodeCreate: [2280, 280]
};
const edges = [
	['nodeRelease', 'nodeStable'],
	['nodeStable', 'nodeBuild'],
	['nodeBuild', 'nodeReview'],
	['nodeStable', 'nodeWait'],
	['nodeWait', 'nodeCreate']
];
function bezier(a, b, u) {
	const x0 = a[0] + NODE.w / 2,
		x3 = b[0] - NODE.w / 2;
	const y0 = a[1],
		y3 = b[1];
	const h = (x3 - x0) * 0.5;
	const v = 1 - u;
	return [
		v ** 3 * x0 + 3 * v * v * u * (x0 + h) + 3 * v * u * u * (x3 - h) + u ** 3 * x3,
		v ** 3 * y0 + 3 * v * v * u * y0 + 3 * v * u * u * y3 + u ** 3 * y3
	];
}
const legs = [
	{ edge: 0, from: W + 1.6, to: W + 2.4 },
	{ edge: 1, from: W + 3, to: W + 3.8 },
	{ edge: 2, from: W + 7.5, to: W + 8.2 }
];
const nodeAt = {
	nodeRelease: W + 0.5,
	nodeStable: W + 2.4,
	nodeBuild: W + 3.8,
	nodeReview: W + 8.2
};
// The node runs in plain sight first, each step gets time to be read, and Done holds before it closes.
const buildOpen = [W + 4.3, W + 4.7, W + 7.45, W + 7.8];
const buildSteps = [W + 4.8, W + 5.55, W + 6.3];
const buildDone = buildSteps.map((at) => at + 0.75);
// Every check throws its own small burst; the last one throws the big one.
const buildConfetti = Array.from({ length: 80 }, (_, i) => ({
	a: rand(i, 82) * Math.PI * 2,
	sp: 240 + rand(i, 83) * 420,
	up: 380 + rand(i, 84) * 560,
	size: 10 + rand(i, 85) * 13,
	tint: rgb(palette[i % 5]),
	spin: 6 + rand(i, 86) * 12
}));
function flowAct(scene, t, s) {
	const open = prog(t, T.composer - 0.85, T.composer, ease.inOut);
	const arrive = prog(t, W - 0.1, W + 0.7, ease.expoOut);
	const [cx, cy, d] = track(
		t,
		[380, 660, 1620],
		[
			[W + 2.5, W + 3.5, [1140, 620, 1720]],
			[buildOpen[0], buildOpen[1], [1520, 770, 1140]],
			[buildOpen[1], buildOpen[2], [1520, 770, 1085]],
			[buildOpen[2], buildOpen[3] + 0.2, [1900, 760, 1500]],
			[T.composer - 0.85, T.composer, [COMPOSE.x, COMPOSE.y + 75, PIXEL_D]]
		]
	);
	const eye = [cx - 0.16 * d * (1 - open), cy + 60 * (1 - open), d * lerp(0.82, 1, arrive)];
	const at = [cx, cy, 0];
	scene.camera = { eye, at, fov: 30, aperture: 8, focus: Math.hypot(eye[2], eye[0] - at[0]) };
	heading(scene, s.sayFlow);
	const grow =
		prog(t, buildOpen[0], buildOpen[1], ease.inOut) *
		(1 - prog(t, buildOpen[2], buildOpen[3], ease.inOut));
	for (const [name, [x, y]] of Object.entries(nodes)) {
		const later = name === 'nodeWait' || name === 'nodeCreate';
		const shown = prog(t, W - 0.1 + (x / 760) * 0.05, W + 0.6 + (x / 760) * 0.05, ease.expoOut);
		const dim = later ? 1 - 0.6 * prog(t, W + 3, W + 3.5) : 1;
		const away = (name === 'nodeBuild' ? 1 - grow : 1) * (1 - open);
		const hide = name === 'nodeReview' ? 1 - prog(open, 0.25, 0.7, ease.linear) : away;
		shadowCard(scene, { x, y, z: 0, w: NODE.w, h: NODE.h, o: 0.16 * shown * dim * hide, r: 60 });
		scene.panel(s[name], {
			x,
			y: y - (1 - shown) * 40,
			z: 0,
			th: 12,
			o: shown * dim * hide,
			mesh: 'card',
			gloss: 0.5
		});
	}
	edges.forEach(([a, b], e) => {
		const leg = legs.find((l) => l.edge === e);
		const run = leg ? prog(t, leg.from, leg.to, ease.inOut) : 0;
		const later = e > 2;
		const n = 28;
		let head = null;
		for (let i = 0; i < n; i++) {
			const u0 = i / n,
				u1 = (i + 1) / n;
			const [x0, y0] = bezier(nodes[a], nodes[b], u0);
			const [x1, y1] = bezier(nodes[a], nodes[b], u1);
			const lit = (u0 + u1) / 2 <= run;
			if (lit) head = [x1, y1];
			scene.flat({
				x: (x0 + x1) / 2,
				y: (y0 + y1) / 2,
				z: 2,
				rz: Math.atan2(y1 - y0, x1 - x0),
				w: Math.hypot(x1 - x0, y1 - y0) + 3,
				h: lit ? 8 : 4,
				r: 2,
				th: 3,
				tint: lit ? DROP : LINE,
				o: (later ? 0.45 : 1) * prog(t, W, W + 0.5) * (1 - open),
				casts: false,
				gloss: 0,
				emissive: lit ? 0.25 : 0
			});
		}
		if (head && run < 1)
			scene.plate({
				x: head[0],
				y: head[1],
				z: 4,
				w: 150,
				h: 150,
				r: 74,
				blur: 70,
				tint: DROP,
				o: 0.65
			});
	});
	// Build draft opens where it stands, shows the work, and closes again.
	if (grow > 0.01) {
		const [x, y] = nodes.nodeBuild;
		const bump = buildDone.reduce((sum, at) => sum + (t >= at ? Math.exp(-(t - at) * 9) : 0), 0);
		const scale = lerp(0.5, 1, grow) * (1 + bump * 0.014);
		shadowCard(scene, {
			x,
			y,
			z: 100,
			w: 860 * scale,
			h: 380 * scale,
			o: 0.3 * grow,
			r: 90,
			tint: DROP
		});
		scene.panel(s.buildPanel, {
			x,
			y,
			z: 120,
			s: scale,
			th: 22,
			o: prog(grow, 0.1, 0.6, ease.linear),
			gloss: 0.6
		});
	}
	buildDone.forEach((at, step) => {
		const age = t - at;
		if (age < 0 || age > 1.5) return;
		const last = step === buildDone.length - 1;
		const power = last ? 1.35 : 0.72;
		const [nx, ny] = nodes.nodeBuild;
		const from = spots.buildTicks[step];
		for (let i = 0; i < (last ? 80 : 20); i++) {
			const c = buildConfetti[i];
			const drag = 1 - 0.35 * clamp(age / 1.1);
			const x = nx + from.x + Math.cos(c.a) * c.sp * power * age * drag;
			const z = 150 + Math.abs(Math.sin(c.a)) * c.sp * 0.5 * age;
			const y = ny + from.y + c.up * power * age * drag - 820 * age * age;
			confettiPiece(scene, x, y, z, c, age, 1 - clamp((age - 0.9) / 0.5));
		}
	});
	if (open > 0) composerPanel(scene, s, open);
}

// --- Composer: nothing moves but the words -----------------------------------------------------------
const C = T.composer;
const stream = [C + 0.25, C + 2.45];
const approveAt = C + 3.25;
function composerPanel(scene, s, open, leave = 0) {
	const w = s.composer.w,
		h = s.composer.h;
	const from = nodes.nodeReview;
	const scale = lerp(NODE.w / w, 1, open);
	const x = lerp(from[0], COMPOSE.x, open),
		y = lerp(from[1], COMPOSE.y, open);
	shadowCard(scene, {
		x,
		y,
		z: 0,
		w: w * scale,
		h: h * scale,
		o: 0.24 * open * (1 - leave),
		r: 120
	});
	scene.panel(s.composer, {
		x,
		y,
		z: COMPOSE.z,
		s: scale * (1 - leave * 0.97),
		th: 16,
		gloss: 0.4,
		o: prog(open, 0.15, 0.55, ease.linear)
	});
}
function composerAct(scene, t, s) {
	const leave = prog(t, T.networks - 0.35, T.networks - 0.02, ease.expoIn);
	scene.camera = level(COMPOSE.x, COMPOSE.y + 75);
	composerPanel(scene, s, 1, leave);
	heading(scene, s.sayReview);
	if (between(t, stream[1] + 0.3, T.networks)) {
		const target = [COMPOSE.x + spots.approve.x, COMPOSE.y + spots.approve.y, 60];
		const inn = prog(t, stream[1] + 0.3, approveAt - 0.08, ease.inOut);
		hand(
			scene,
			s,
			pos([target[0] + 420, target[1] - 340, 80], target, inn),
			between(t, approveAt - 0.04, approveAt + 0.12) ? 1 : 0,
			1 - leave
		);
	}
}

// --- Networks: a jackpot reel of real versions lands on X, and the camera reads what perfect means ---
const N = T.networks;
const REEL = { y: 465, radius: 1700, gap: 56, loops: 3, overshoot: 54, centre: 3, settle: 0.38 };
REEL.spin = [N + 0.02, N + 2.78];
const reelCards = [
	'cardPinterest',
	'cardLinkedin',
	'cardInstagram',
	'cardX',
	'cardTikTok',
	'cardYoutube',
	'cardBluesky'
];
const reelScale = (name) => (name === 'cardX' ? 0.56 : 0.9);
const reel = { home: [], length: 1 };
function measureReel(s) {
	const widths = reelCards.map((name) => s[name].w * reelScale(name) + REEL.gap);
	let at = 0;
	const middles = widths.map((w) => {
		at += w;
		return at - w / 2;
	});
	reel.length = at;
	reel.home = middles.map((v) => v - middles[REEL.centre]);
	// A ratchet tick each time a card crosses the centre, so the sound slows down with the reel.
	const pitch = reel.length / reelCards.length;
	let step = Math.floor(reelOffset(REEL.spin[0]) / pitch);
	let last = -1;
	for (let at_ = REEL.spin[0]; at_ < REEL.spin[1]; at_ += 1 / 480) {
		const next = Math.floor(reelOffset(at_) / pitch);
		if (next === step) continue;
		step = next;
		if (at_ - last < 0.055) continue;
		last = at_;
		const p = (at_ - REEL.spin[0]) / (REEL.spin[1] - REEL.spin[0]);
		cue(at_, 'tick', { gain_db: lerp(-13, -1, p) });
	}
}
// Full speed from the first frame, then a long slow-down that passes X and eases back onto it.
function reelOffset(t) {
	const [a, b] = REEL.spin;
	const p = clamp((t - a) / (b - a));
	const home = prog(t, b, b + REEL.settle, ease.inOut);
	return (REEL.loops * reel.length + REEL.overshoot) * (1 - p) ** 3.2 - REEL.overshoot * (1 - home);
}
const closeAt = [N + 3.1, N + 3.7];
const morphAt = [N + 3.95, N + 5.15];
const diveAt = [N + 5.6, N + 6.96];
const WIDE = { eye: [0, 540, PIXEL_D], at: [0, 540, 0] };
// The close-up frames the header, the post and its badge; the picture waits just below the frame.
const CLOSE = { eye: [0, 613, 822], at: [0, 613, 0] };
const media = { eye: [0, 0, 0], at: [0, 0, 0], c: [0, 0, 2], scale: 0.448 };
function networksAct(scene, t, s) {
	const close = prog(t, closeAt[0], closeAt[1], ease.inOut);
	const dive = prog(t, diveAt[0], diveAt[1], ease.inOut);
	const eye = pos(pos(WIDE.eye, CLOSE.eye, close), media.eye, dive);
	const at = pos(pos(WIDE.at, CLOSE.at, close), media.at, dive);
	scene.camera = {
		eye,
		at,
		fov: 30,
		aperture: lerp(5, 3, close),
		focus: Math.hypot(...eye.map((v, i) => v - at[i]))
	};
	scene.world.shadowRange = 3400;
	const burst = prog(t, N - 0.02, N + 0.3, ease.expoOut);
	const offset = reelOffset(t);
	const landed = REEL.spin[1] + REEL.settle;
	const chosen = 1 + 0.045 * Math.sin(prog(t, landed - 0.1, landed + 0.3, ease.linear) * Math.PI);
	const push = prog(t, closeAt[0] - 0.12, closeAt[1] - 0.1, ease.inOut);
	reelCards.forEach((name, i) => {
		const span = reel.length;
		const wrapped = (((reel.home[i] + offset + span / 2) % span) + span) % span;
		const isX = i === REEL.centre;
		const clear = isX ? 0 : (wrapped < span / 2 ? -1 : 1) * 2600 * push;
		const u = (wrapped - span / 2) * burst + clear;
		const a = u / REEL.radius;
		if (Math.abs(a) > 1.4) return;
		scene.panel(s[name], {
			x: Math.sin(a) * REEL.radius,
			y: REEL.y,
			z: (Math.cos(a) - 1) * REEL.radius,
			ry: a,
			s: reelScale(name) * lerp(0.7, 1, burst) * (isX ? chosen : 1),
			th: 10,
			k: -(isX ? 1 - close : 1) / REEL.radius,
			o: isX ? 1 - prog(t, N + 6.5, N + 6.95, ease.linear) : 1,
			gloss: 0.5
		});
	});
	heading(scene, s.sayNetworks);
	// The picture lifts off the card and is already the image editor's canvas when the scene changes.
	if (t >= N + 6.45) artStack(scene, s, { c: media.c, scale: media.scale });
}

// --- Design: a real editor around the picture, with the layers pulled apart ------------------------
const D = T.design;
const ART = { x: -102, y: 465, scale: 0.92, w: 1104 };
const CUT = { eye: [-110, 540, PIXEL_D], at: [0, 540, 0] };
const toolAt = D + 1;
const swatchAt = D + 1.55;
const addAt = D + 2.75;
function artStack(scene, s, { c, scale = 1, gap = 0, rx = 0, ry = 0, o = 1 }) {
	const m = matrix(0, 0, 0, rx, ry, 0);
	['artBack', 'artPhone', 'artQuick', 'artHead'].forEach((name, i) => {
		// A small standing gap keeps the layers apart even when flat, so they can never z-fight.
		const z = i * (gap + 3);
		const p = [c[0] + m[8] * z, c[1] + m[9] * z, c[2] + m[10] * z];
		if (i === 0) {
			shadowCard(scene, {
				x: p[0],
				y: p[1],
				z: p[2],
				w: 1200 * scale,
				h: 628 * scale,
				rx,
				ry,
				o: 0.28 * o,
				r: 80
			});
			scene.panel(s[name], { x: p[0], y: p[1], z: p[2], rx, ry, s: scale, th: 10, o, gloss: 0.6 });
		} else scene.text(s[name], { x: p[0], y: p[1], z: p[2], rx, ry, s: scale, o });
	});
}
function designAct(scene, t, s) {
	// The layers come apart to be worked on, and rejoin as the recolour lands so the image reads whole.
	const apart =
		prog(t, D + 0.25, D + 0.75, ease.inOut) *
		(1 - prog(t, swatchAt + 0.3, swatchAt + 0.75, ease.inOut));
	const gap = apart * 130;
	const toCut = prog(t, T.cut - 0.5, T.cut - 0.07, ease.inOut);
	// The picture arcs in front of the curved editor on its way into the monitor.
	const c = pos([ART.x, ART.y, 0], spots.monitor, toCut);
	c[2] += Math.sin(toCut * Math.PI) * 160;
	const yaw = apart * -0.42;
	const pitch = apart * 0.12;
	const eye = pos(
		[
			Math.sin(yaw) * Math.cos(pitch) * PIXEL_D,
			540 + Math.sin(pitch) * PIXEL_D,
			Math.cos(yaw) * Math.cos(pitch) * PIXEL_D
		],
		CUT.eye,
		toCut
	);
	scene.camera = {
		eye,
		at: pos([0, 540, 0], CUT.at, toCut),
		fov: 30,
		aperture: 5 + apart * 5,
		focus: PIXEL_D
	};
	scene.world.shadowRange = 3000;
	const side = prog(t, D + 0.1, D + 0.55, ease.expoOut) * (1 - toCut);
	const rail = [-730, ART.y, 0],
		panel = [628, ART.y, 0];
	if (side > 0.01) {
		shadowCard(scene, {
			x: rail[0] - (1 - side) * 200,
			y: rail[1],
			z: 0,
			w: 96,
			h: 578,
			o: 0.18 * side,
			r: 60
		});
		scene.panel(s.toolRail, {
			x: rail[0] - (1 - side) * 200,
			y: rail[1],
			z: 0,
			th: 12,
			o: side,
			gloss: 0.4
		});
		shadowCard(scene, {
			x: panel[0] + (1 - side) * 200,
			y: panel[1],
			z: 0,
			w: 300,
			h: 578,
			o: 0.18 * side,
			r: 60
		});
		scene.panel(s.inspector, {
			x: panel[0] + (1 - side) * 200,
			y: panel[1],
			z: 0,
			th: 12,
			o: side,
			gloss: 0.4
		});
	}
	if (toCut > 0) {
		const rise = prog(t, T.cut - 0.5, T.cut - 0.08, ease.expoOut);
		shadowCard(scene, {
			x: 0,
			y: ART.y - (1 - rise) * 1300,
			z: 0,
			w: 1680,
			h: 720,
			o: 0.24 * rise,
			r: 120
		});
		scene.panel(s.editor, {
			x: 0,
			y: ART.y - (1 - rise) * 1300,
			z: 0,
			th: 14,
			k: 0.00018,
			gloss: 0.4
		});
	}
	artStack(scene, s, { c, scale: lerp(ART.scale, 688 / 1200, toCut), gap });
	heading(scene, s.sayDesign, 1 - toCut);
	if (between(t, D + 0.7, T.cut - 0.75)) {
		const tool = [rail[0] + spots.tool.x, rail[1] + spots.tool.y, 40];
		const swatch = [panel[0] + spots.swatch.x, panel[1] + spots.swatch.y, 40];
		const add = [panel[0] + spots.add.x, panel[1] + spots.add.y, 40];
		const first = prog(t, D + 0.7, toolAt - 0.08, ease.inOut);
		const second = prog(t, toolAt + 0.1, swatchAt - 0.08, ease.inOut);
		const third = prog(t, swatchAt + 0.3, addAt - 0.08, ease.inOut);
		const pressed = [toolAt, swatchAt, addAt].some((at) => between(t, at - 0.04, at + 0.12));
		hand(
			scene,
			s,
			pos(pos(pos([-300, 40, 40], tool, first), swatch, second), add, third),
			pressed ? 1 : 0,
			1 - prog(t, T.cut - 1.05, T.cut - 0.8)
		);
	}
}

// --- Cut: a whole edit, ending with a fade the viewer can actually watch play -----------------------
const K = T.cut;
const dragFade = [K + 2.05, K + 2.85];
const playOut = [K + 3, K + 4.6];
const FADE_PX = 240;
function headPosition(t) {
	return (
		prog(t, K + 0.3, K + 2, ease.linear) * 776 + prog(t, playOut[0], playOut[1], ease.linear) * 776
	);
}
function cutAct(scene, t, s) {
	const ride = prog(t, K + 0.4, T.schedule - 0.5, ease.sine);
	const eye = pos(CUT.eye, [110, 540, PIXEL_D], ride);
	scene.camera = {
		eye,
		at: CUT.at,
		fov: 30,
		aperture: 5,
		focus: Math.hypot(...eye.map((v, i) => v - CUT.at[i]))
	};
	shadowCard(scene, { x: 0, y: ART.y, z: 0, w: 1680, h: 720, o: 0.24, r: 120 });
	scene.panel(s.editor, { x: 0, y: ART.y, z: 0, th: 14, k: 0.00018, gloss: 0.4 });
	heading(scene, s.sayCut);
	if (between(t, K + 1.6, K + 3.2)) {
		const start = [spots.fadeEnd.x, ART.y + spots.fadeEnd.y, 60],
			end = [spots.fadeEnd.x - FADE_PX, ART.y + spots.fadeEnd.y, 60];
		const inn = prog(t, K + 1.6, dragFade[0], ease.inOut);
		const drag = prog(t, dragFade[0], dragFade[1], ease.inOut);
		hand(
			scene,
			s,
			pos(pos([1000, -40, 80], start, inn), end, drag),
			between(t, dragFade[0], dragFade[1]) ? 1 : 0,
			1 - prog(t, K + 3, K + 3.2)
		);
	}
}

// --- Schedule: one click, and the post lands on the month -------------------------------------------
const S = T.schedule;
const CAL = { w: 1600, h: 786, head: 136, cols: 7, rows: 5, rx: -0.62 };
const clickAt = S + 0.6;
const landing = S + 1.75;
const ourCell = 17;
function cellOf(i) {
	const col = i % CAL.cols,
		row = Math.floor(i / CAL.cols);
	const w = CAL.w / CAL.cols,
		h = (CAL.h - CAL.head) / CAL.rows;
	return {
		col,
		row,
		w,
		h,
		x: (col + 0.5) * w - CAL.w / 2,
		y: CAL.h / 2 - CAL.head - (row + 0.5) * h
	};
}
const confetti = Array.from({ length: 90 }, (_, i) => ({
	a: rand(i, 70) * Math.PI * 2,
	sp: 500 + rand(i, 71) * 900,
	up: 500 + rand(i, 72) * 1100,
	size: 12 + rand(i, 73) * 18,
	tint: rgb(palette[i % 5]),
	spin: 6 + rand(i, 74) * 14
}));
function scheduleAct(scene, t, s) {
	const pull = prog(t, S + 0.95, S + 1.5, ease.inOut);
	const base = { y: 420, rx: CAL.rx };
	const target = cellOf(ourCell);
	const mat = matrix(0, base.y, 0, base.rx, 0, 0);
	const world = (lx, ly, lz = 0) => [
		lx * mat[0] + ly * mat[4] + lz * mat[8],
		base.y + lx * mat[1] + ly * mat[5] + lz * mat[9],
		lx * mat[2] + ly * mat[6] + lz * mat[10]
	];
	const hit = world(target.x, target.y, 24);
	const eye = pos([0, 560, 1300], [-120, 1420, 1960], pull);
	const at = pos([0, 560, 0], [0, 452, 0], pull);
	scene.camera = {
		eye,
		at,
		fov: 30,
		aperture: 5,
		focus: Math.hypot(...eye.map((v, i) => v - at[i]))
	};
	const bar_ = 1 - prog(pull, 0, 0.35, ease.linear);
	if (bar_ > 0.01) {
		const press = between(t, clickAt - 0.04, clickAt + 0.14) ? 1 : 0;
		const inn = prog(t, S - 0.1, S + 0.25, ease.back);
		const s2 = 0.8 * inn * (1 - press * 0.03);
		shadowCard(scene, {
			x: 0,
			y: 560,
			z: -40,
			w: 1020 * s2,
			h: 200 * s2,
			r: 120,
			o: 0.2 * bar_ * inn
		});
		scene.panel(s.scheduleBar, { x: 0, y: 560, z: 0, s: s2, th: 20, o: bar_, gloss: 0.6 });
		hand(
			scene,
			s,
			pos([700, 120, 200], [216, 560, 70], prog(t, S + 0.02, clickAt - 0.06, ease.inOut)),
			press,
			bar_
		);
	}
	if (t >= clickAt + 0.05 && t < S + 3) {
		const age = t - (clickAt + 0.05);
		for (const c of confetti) {
			const drag = 1 - 0.4 * clamp(age / 1.6);
			const x = 216 + Math.cos(c.a) * c.sp * age * drag;
			const z = 80 + Math.sin(c.a) * c.sp * age * drag * 0.5;
			const y = 560 + c.up * age * drag - 900 * age * age;
			if (y < 0) continue;
			confettiPiece(scene, x, y, z, c, age, 1 - clamp((age - 1.2) / 0.8));
		}
	}
	if (pull > 0.01) {
		const rise = prog(t, S + 0.95, S + 1.45, ease.expoOut);
		scene.panel(s.calendar, {
			x: 0,
			y: base.y + Math.cos(CAL.rx) * ((CAL.h - CAL.head) / 2),
			z: -Math.sin(-CAL.rx) * ((CAL.h - CAL.head) / 2) - 8,
			rx: CAL.rx,
			w: CAL.w,
			h: CAL.head,
			r: 16,
			rect: [0, 0, 1, CAL.head / CAL.h],
			th: 10,
			o: rise,
			mesh: 'card'
		});
		for (let i = 0; i < CAL.cols * CAL.rows; i++) {
			const c = cellOf(i);
			const stagger = prog(
				t,
				S + 0.95 + (c.col + c.row) * 0.02,
				S + 1.4 + (c.col + c.row) * 0.02,
				ease.back
			);
			// Only the day the post lands on answers it.
			const age = t - landing;
			const lift = i === ourCell && age > 0 ? Math.sin(age * 15) * Math.exp(-age * 5) * 34 : 0;
			const p = world(c.x, c.y, 16 + lift + (1 - stagger) * -220);
			const u0 = (c.col * c.w) / CAL.w,
				v0 = (CAL.head + c.row * c.h) / CAL.h;
			scene.panel(s.calendar, {
				x: p[0],
				y: p[1],
				z: p[2],
				rx: CAL.rx,
				w: c.w - 4,
				h: c.h - 4,
				r: 10,
				th: 26,
				rect: [u0, v0, u0 + c.w / CAL.w, v0 + c.h / CAL.h],
				o: stagger > 0.02 ? 1 : 0,
				mesh: 'card',
				gloss: 0.3,
				tint: i === ourCell && t >= landing ? rgb('#fff6ec') : undefined
			});
		}
		if (t >= S + 1.28 && t < landing + 0.02) {
			const u = prog(t, S + 1.3, landing, ease.inOut);
			const p = pos([216, 780, 320], [hit[0], hit[1] + 14, hit[2]], u);
			scene.panel(s.flyingPost, {
				x: p[0],
				y: p[1],
				z: p[2],
				rx: lerp(0, CAL.rx, u),
				rz: (1 - u) * -0.3,
				s: lerp(1, 0.66, u),
				th: 8,
				mesh: 'card',
				gloss: 0.5,
				casts: false
			});
		}
	}
	heading(scene, s.saySchedule);
}

// --- Results: the launch climbs the frame, then the app says what to do about it ---------------------
const R = T.results;
const values = [180, 220, 190, 310, 270, 460, 390, 520, 470, 680, 950, 3400, 2420, 2810];
const SPIKE = 11;
const COLUMN = { pitch: 116, w: 90, depth: 86, tall: 640 };
const columnX = (i) => (i - 6.5) * COLUMN.pitch;
const repurposeAt = R + 4.2;
// Water meets the frame at y = 975, the bottom of the shared content band.
const FLOOR = 435;
function resultsAct(scene, t, s) {
	// Close and low on the first columns, then the crane climbs back to reveal the launch towering over them.
	const crane = prog(t, R + 0.2, R + 2, ease.inOut);
	const eye = [lerp(-760, 0, crane), lerp(150, FLOOR, crane), lerp(980, PIXEL_D, crane)];
	const at = [lerp(-470, 0, crane), lerp(205, FLOOR, crane), 0];
	scene.camera = yawed(
		{ eye, at, fov: 30, aperture: 8, focus: Math.hypot(...eye.map((v, i) => v - at[i])) },
		whip(t, T.inbox)
	);
	scene.world.shadowRange = 3400;
	heading(scene, s.sayResults);
	values.forEach((value, i) => {
		const start = R + 0.05 + i * 0.1;
		const rise = prog(t, start, start + 0.55, ease.spring);
		const h = (value / 3400) * COLUMN.tall * rise;
		if (h < 2) return;
		const launch = i === SPIKE;
		scene.flat({
			x: columnX(i),
			y: h / 2,
			z: 0,
			w: COLUMN.w,
			h,
			r: 10,
			th: COLUMN.depth,
			tint: rgb(launch ? '#8e3f0a' : '#a14c12'),
			gloss: 0.5
		});
		scene.panel(launch ? s.columnLaunch : s.columnFace, {
			x: columnX(i),
			y: h / 2,
			z: 1,
			w: COLUMN.w,
			h,
			r: 10,
			th: 0,
			mesh: 'card',
			casts: false,
			gloss: 0.6,
			rect: [0, Math.max(1 - h / COLUMN.tall, 0), 1, 1]
		});
	});
	const spikeX = columnX(SPIKE);
	const tag = prog(t, R + 1.5, R + 1.9, ease.back);
	if (tag > 0.01) {
		const px = spikeX - 210,
			py = 556;
		shadowCard(scene, { x: px, y: py, z: 60, w: 270, h: 168, o: 0.24 * tag, r: 70 });
		scene.panel(s.launchTag, {
			x: px,
			y: py + (1 - tag) * 60,
			z: 90,
			s: 0.94 * tag,
			th: 12,
			gloss: 0.5
		});
	}
	const sticker = prog(t, R + 1.95, R + 2.3, ease.spring);
	if (sticker > 0.01)
		scene.panel(s.viralSticker, {
			x: spikeX + 12,
			y: 668,
			z: 150,
			rz: -0.09,
			s: 0.84 * sticker,
			th: 16,
			gloss: 0.7,
			casts: false
		});
	const cards = [
		['insightPost', 620, R + 2.4],
		['insightDestination', 455, R + 2.7],
		['repurpose', 322, R + 3]
	];
	for (const [name, y, start] of cards) {
		const p = prog(t, start, start + 0.45, ease.expoOut);
		if (p < 0.01) continue;
		const x = -520 - (1 - p) * 480;
		shadowCard(scene, { x, y, z: 0, w: s[name].w, h: s[name].h, o: 0.18 * p, r: 70, drop: 14 });
		scene.panel(s[name], { x, y, z: 40, th: 10, mesh: 'card', o: p, gloss: 0.4 });
	}
	if (between(t, R + 3.5, R + 5.6)) {
		const target = [-520 + spots.repurpose.x, 322 + spots.repurpose.y, 80];
		hand(
			scene,
			s,
			pos([-240, -60, 240], target, prog(t, R + 3.5, repurposeAt - 0.08, ease.inOut)),
			between(t, repurposeAt - 0.04, repurposeAt + 0.12) ? 1 : 0,
			1 - prog(t, R + 5.2, R + 5.6)
		);
	}
}

// --- Inbox ---------------------------------------------------------------------------------------
const I = T.inbox;
const corners = [
	[-1800, 900],
	[1800, 900],
	[-1800, -200],
	[1800, -200]
];
const ROW = { s: 0.9, pitch: 134, first: 733 };
function inboxAct(scene, t, s) {
	const drift = Math.sin(t * 0.7) * 30;
	const camera = level(drift, 540);
	camera.at = [0, 540, 0];
	scene.camera = yawed(camera, whip(t, I) + whip(t, T.features));
	heading(scene, s.sayInbox);
	[0, 1, 2, 3].forEach((i) => {
		const start = I + 0.15 + i * 0.25;
		const p = prog(t, start, start + 0.5, ease.expoOut);
		const y = ROW.first - i * ROW.pitch;
		const [cx, cy] = corners[i];
		const x = lerp(cx, 0, p),
			yy = lerp(cy, y, p);
		shadowCard(scene, { x, y: yy, z: 0, w: 936, h: 122, o: 0.16 * p, r: 60, drop: 14 });
		scene.panel(s[`msg${i}`], {
			x,
			y: yy,
			z: 0,
			s: ROW.s,
			rz: (1 - p) * (i % 2 ? -0.25 : 0.25),
			ry: (1 - p) * 0.6,
			th: 10,
			mesh: 'card',
			gloss: 0.4
		});
	});
	const barIn = prog(t, I + 1.25, I + 1.6, ease.expoOut);
	const barY = ROW.first - 4 * ROW.pitch;
	shadowCard(scene, { x: 0, y: barY, z: 0, w: 936, h: 122, o: 0.2 * barIn, r: 60, drop: 14 });
	scene.panel(s.reply, {
		x: 0,
		y: barY - (1 - barIn) * 80,
		z: 0,
		s: ROW.s,
		th: 10,
		o: barIn,
		mesh: 'card',
		gloss: 0.4
	});
	const click = I + 2.75;
	if (between(t, I + 2.2, I + 3.5)) {
		const target = [spots.reply.x * ROW.s, barY + spots.reply.y * ROW.s, 50];
		hand(
			scene,
			s,
			pos([900, -180, 120], target, prog(t, I + 2.2, click - 0.08, ease.inOut)),
			between(t, click - 0.04, click + 0.12) ? 1 : 0,
			1 - prog(t, I + 3.2, I + 3.5)
		);
	}
}

// --- Everything else -----------------------------------------------------------------------------
const F = T.features;
const PRISM = { y: 465, radius: 390, scale: 0.84 };
// A prism of words with no background: each face turns into the light on the beat, then falls away.
function featuresAct(scene, t, s) {
	const rows = s.drum.rows;
	const facet = (Math.PI * 2) / rows;
	const step = BEAT / 2;
	const n = Math.floor((t - F - 0.35) / step);
	const f = (t - F - 0.35) / step - n;
	const landed =
		t >= F + 0.35 ? Math.min(n, rows - 1) + (n < rows - 1 ? ease.expoOut(clamp(f / 0.7)) : 0) : 0;
	scene.camera = yawed(level(0, 540, 6), whip(t, F));
	scene.world.mirror = false;
	const inn = prog(t, F + 0.05, F + 0.4, ease.expoOut);
	const turn = landed + (1 - inn) * 2;
	for (let i = 0; i < rows; i++) {
		const a = Math.atan2(Math.sin((turn - i) * facet), Math.cos((turn - i) * facet));
		if (Math.abs(a) > 1.2) continue;
		const y = PRISM.y + Math.sin(a) * PRISM.radius;
		const z = (Math.cos(a) - 1) * PRISM.radius;
		scene.text(s.drum, {
			x: 0,
			y,
			z,
			rx: -a,
			w: s.drum.w * PRISM.scale,
			h: 300 * PRISM.scale,
			rect: [0, i / rows, 1, (i + 1) / rows],
			o: inn * (1 - prog(Math.abs(a), 0.55, 1.15, ease.linear))
		});
	}
	heading(scene, s.sayEverything);
}

// --- Every network circles the line, then spirals down into the mark ------------------------------
const L = T.logos;
const RING = { x: 730, y: 196, z: 500, size: 150 };
const burstAt = (i) => L + 0.02 + i * 0.016;
function logosAct(scene, t, s) {
	scene.camera = level(0, 540, 3);
	scene.world.shadowRange = 3000;
	const pull = prog(t, T.converge, T.end, ease.expoIn);
	const turn = (t - L) * 0.62 + pull * pull * 11;
	for (let i = 0; i < 16; i++) {
		const out = prog(t, burstAt(i), burstAt(i) + 0.38, ease.back);
		if (out < 0.01) continue;
		const a = (i / 16) * Math.PI * 2 + turn;
		const reach = out * (1 - pull);
		const x = Math.cos(a) * RING.x * reach;
		const y = 552 + Math.sin(a) * RING.y * reach;
		const z = -Math.sin(a) * RING.z * reach;
		const size = RING.size * lerp(0.4, 1, out) * (1 - pull * 0.72);
		scene.text(s.logos, {
			x,
			y,
			z,
			w: size * 1.34,
			h: size * 1.34,
			rect: s.logos.rect(i),
			...facing(scene.camera.eye, x, y, z),
			rz: Math.sin(a * 2 + i) * 0.1 * (1 - pull)
		});
	}
	if (t < T.converge + 0.1) title(scene, s.sayLogos, 0, -12 / 540, PIXEL_D, 0.7);
}

// --- The end ---------------------------------------------------------------------------------------
const E = T.end;
// The domain stands on the water at the foot of the frame; the camera sits so the waterline is at y = 905.
// One centred column on calm paper. The camera sits level, so no water reflects the last card.
const END = {
	logo: { y: 683, size: 236 },
	tagline: { y: 471, s: 0.875 },
	note: { y: 392, s: 0.85 },
	link: { y: 292 },
	stop: 447,
	rest: 280,
	hop: 0.62,
	dot: 11
};
const stopLanding = T.period + END.hop;
function endAct(scene, t, s) {
	const hit = E;
	const rise = prog(t, hit + 0.5, hit + 1.15, ease.expoInOut);
	scene.camera = level(0, 540, 3);
	const settle = prog(t, hit, hit + 0.55, ease.spring);
	// The 3D mark turns once as it rises, thins out, and is the real logo by the time it faces us again.
	const turn = (1 - ease.inOut(clamp((t - hit - 0.45) / 0.75))) * Math.PI * 2;
	const flat = prog(t, hit + 1.05, hit + 1.4, ease.inOut);
	const size = lerp(5.2 * 128, END.logo.size, rise);
	const y = lerp(540, END.logo.y, rise);
	if (flat < 1)
		hero(scene, {
			center: [0, y, 0],
			scale: size / 128,
			spin: [0, t < hit + 0.45 ? (1 - settle) * -0.9 : turn, ((1 - settle) * -Math.PI) / 2],
			glow: 0.08 + Math.exp(-(t - hit) * 3) * 0.8,
			eye: scene.camera.eye,
			depth: lerp(13, 3.2, rise)
		});
	if (flat > 0) {
		const z = 30;
		const scale = (PIXEL_D - z) / PIXEL_D;
		scene.text(s.logoFlat, { x: 0, y, z, w: size * scale, h: size * scale, o: flat });
	}
	const line = prog(t, hit + 1.2, hit + 1.75, ease.expoOut);
	scene.text(s.tagline, {
		x: 0,
		y: END.tagline.y - (1 - line) * 20,
		z: 0,
		s: END.tagline.s,
		o: line
	});
	const note = prog(t, hit + 1.5, hit + 2.05, ease.expoOut);
	scene.text(s.urlNote, { x: 0, y: END.note.y - (1 - note) * 14, z: 0, s: END.note.s, o: note });
	const link = prog(t, T.period - 0.55, T.period - 0.05, ease.expoOut);
	scene.text(s.urlLine, { x: 0, y: END.link.y - (1 - link) * 18, z: 0, o: link });
	if (t >= T.period) {
		// The film's last full stop falls off the line and lands as the dot of the domain.
		const p = clamp((t - T.period) / END.hop);
		const [x0, y0] = spots.stop;
		const age = t - stopLanding;
		const x = lerp(x0, spots.slot, p);
		const y1 = lerp(y0, END.rest, p) + 24 * 4 * p * (1 - p);
		const squash = age > 0 ? 1 + 0.4 * Math.exp(-age * 9) * Math.cos(age * 26) : 1;
		scene.bead({
			x,
			y: y1,
			z: 6,
			size: END.dot,
			tint: DROP,
			fill: 1,
			w: END.dot * squash,
			h: END.dot / squash,
			...facing(scene.camera.eye, x, y1, 6)
		});
	}
}

// --- Sound ---------------------------------------------------------------------------------------
cue(T.open + 0.2, 'whoosh');
cue(W - 0.12, 'swoosh');
cue(W + 0.5, 'pop');
for (const leg of legs) {
	cue(leg.from + 0.1, 'tick');
	cue(leg.to, 'land');
}
cue(buildOpen[0], 'whoosh');
// The checks climb a major triad, and the last one opens into the burst.
buildDone.forEach((at, i) => {
	cue(at, 'chime', { semitones: [0, 4, 7][i], gain_db: 3 });
	cue(at, 'pop', { gain_db: -4 });
});
for (let at = buildSteps[1] + 0.06; at < buildDone[1] - 0.06; at += 0.09)
	cue(at, 'key', { gain_db: -9 });
cue(buildDone[2] + 0.02, 'shimmer', { gain_db: -3 });
cue(T.composer - 0.7, 'swoosh');
for (let at = stream[0]; at < stream[1]; at += 0.17) cue(at, 'key', { gain_db: -5 });
cue(approveAt, 'click');
cue(approveAt + 0.02, 'pop');
cue(N, 'swoosh', { gain_db: -2 });
cue(REEL.spin[1] + REEL.settle - 0.1, 'land', { gain_db: 1 });
cue(REEL.spin[1] + REEL.settle - 0.08, 'ding', { gain_db: -2 });
cue(closeAt[0] + 0.05, 'whoosh', { gain_db: -3 });
cue(morphAt[0], 'shimmer', { gain_db: -6 });
for (let at = morphAt[0] + 0.1; at < morphAt[1]; at += 0.2) cue(at, 'tick', { gain_db: -8 });
cue(morphAt[1], 'ding');
cue(diveAt[0] + 0.25, 'swoosh');
cue(D + 0.45, 'whoosh');
cue(toolAt, 'click');
cue(swatchAt, 'click');
cue(swatchAt + 0.05, 'ding', { gain_db: -4 });
cue(addAt, 'click');
cue(T.cut - 0.4, 'whoosh');
cue(T.cut, 'land');
[0, 1, 2].forEach((i) => cue(K + 0.05 + i * 0.18, 'tick'));
[0, 1, 2, 3].forEach((i) => cue(K + 0.85 + i * 0.22, 'pop'));
cue(dragFade[0], 'click');
cue(dragFade[0] + 0.1, 'whoosh', { gain_db: -5 });
cue(playOut[1], 'land', { gain_db: -3 });
cue(T.schedule - 0.14, 'swoosh');
cue(clickAt, 'click');
cue(clickAt + 0.05, 'shimmer');
cue(S + 1.1, 'whoosh');
cue(landing, 'land', { gain_db: 0 });
cue(T.results - 0.14, 'swoosh');
values.forEach((_, i) => {
	if (i === SPIKE || i % 2 === 0)
		cue(R + 0.05 + i * 0.1, i === SPIKE ? 'land' : 'pop', { gain_db: i === SPIKE ? 4 : -6 });
});
cue(R + 1.95, 'impact', { gain_db: -4 });
[2.4, 2.7, 3].forEach((at) => cue(R + at, 'pop'));
cue(repurposeAt, 'click');
cue(repurposeAt + 0.05, 'ding');
cue(T.inbox - 0.12, 'swoosh');
[0, 1, 2, 3].forEach((i) => cue(I + 0.15 + i * 0.25, 'pop'));
for (let at = I + 1.5; at < I + 2.4; at += 0.16) cue(at, 'key', { gain_db: -5 });
cue(I + 2.75, 'click');
cue(I + 2.8, 'whoosh');
cue(T.features - 0.12, 'swoosh');
for (let i = 1; i < 10; i += 2) cue(F + 0.35 + i * 0.25, 'tick', { gain_db: -3 });
cue(L - 0.14, 'swoosh');
// Every network arrives on its own bell, a pentatonic run up two and a half octaves in half a second.
[-12, -10, -8, -5, -3, 0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24].forEach((semitones, i) =>
	cue(burstAt(i) + 0.06, 'chime', { semitones, gain_db: -4 + i * 0.25 })
);
cue(T.converge, 'riser', { ends: T.end });
cue(T.end, 'boom');
cue(T.end, 'land', { gain_db: 3 });
cue(T.end + 0.02, 'shimmer');
cue(T.end + 0.5, 'whoosh');
cue(T.end + 1.2, 'tick', { gain_db: -4 });
cue(T.period - 0.5, 'tick', { gain_db: -5 });
cue(T.period + 0.02, 'tick');
cue(stopLanding, 'plop', { gain_db: 1 });

// --- Assembly ------------------------------------------------------------------------------------
const windows = [
	[T.open, T.composer, flowAct],
	[T.composer, T.networks, composerAct],
	[T.networks, T.design, networksAct],
	[T.design, T.cut - 0.05, designAct],
	[T.cut - 0.05, T.schedule, cutAct],
	[T.schedule, T.results, scheduleAct],
	[T.results, T.inbox, resultsAct],
	[T.inbox, T.features, inboxAct],
	[T.features, T.logos, featuresAct],
	[T.logos, T.end, logosAct],
	[T.end, DURATION + 1, endAct]
];
// Nothing in the product falls into water, so the water stays still.
function worldProduct() {
	return { ...paper, drops: [] };
}

const nodeLabel = (t, name) => {
	const at = nodeAt[name];
	if (at === undefined || t < at) return 'Ready';
	if (name === 'nodeReview') return 'Awaiting review';
	if (name === 'nodeBuild') return t < buildOpen[2] ? 'Running' : 'Completed';
	return 'Completed';
};
const DRAFTING = 'Todoist 12 is live.';
function buildDom(t, panel) {
	const finished = buildDone[2];
	panel.bar.style.width = `${prog(t, buildSteps[0], finished, ease.linear) * 100}%`;
	panel.status.textContent = t < finished ? 'Working' : 'Done';
	panel.status.style.color = t < finished ? 'var(--focal)' : 'var(--green)';
	panel.status.style.background = t < finished ? 'var(--selection)' : 'var(--green-soft)';
	panel.rows.forEach((row, i) => {
		const at = buildSteps[i],
			done = buildDone[i];
		const active = between(t, at, done);
		const complete = t >= done;
		const enter = prog(
			t,
			buildOpen[0] + 0.12 + i * 0.07,
			buildOpen[0] + 0.5 + i * 0.07,
			ease.expoOut
		);
		row.row.style.transform = `translateY(${(1 - enter) * 24}px)`;
		row.row.style.opacity = String(enter);
		const flash = complete ? Math.exp(-(t - done) * 5) : 0;
		row.row.style.background = active
			? 'rgb(246 227 214 / 72%)'
			: flash > 0.02
				? `rgb(47 143 87 / ${(0.22 * flash).toFixed(3)})`
				: '';
		row.label.style.color = active || complete ? 'var(--ink)' : 'var(--faint)';
		row.ring.style.stroke = active ? 'var(--mark)' : 'var(--border)';
		row.ring.style.strokeDasharray = active ? '0.3 0.7' : '1 0';
		row.ring.style.transform = active ? `rotate(${(t - at) * 560}deg)` : '';
		row.ring.style.opacity = complete ? '0' : '1';
		row.disc.style.transform = `scale(${complete ? prog(t, done, done + 0.4, ease.spring) : 0})`;
		row.stroke.style.strokeDashoffset = String(1 - prog(t, done + 0.05, done + 0.27, ease.out));
		row.work.forEach((item, k) => {
			const pop = prog(t, at + 0.1 + k * 0.11, at + 0.46 + k * 0.11, ease.spring);
			item.style.transform = `scale(${pop})`;
			item.style.opacity = String(clamp(pop));
		});
		if (row.stream)
			row.stream.textContent = DRAFTING.slice(
				0,
				Math.round(prog(t, at + 0.04, done - 0.04, ease.linear) * DRAFTING.length)
			);
	});
	panel.dirty = true;
}
// The rewrite is a magic move. Cut words dissolve, kept words travel to their new places, new words rise
// in, and the type grows into the room the shorter post leaves.
function rewriteDom(t, card) {
	const [a, b] = morphAt;
	const r = card.rewrite;
	r.words.forEach((word) => {
		const { node } = word;
		if (word.kept) {
			const from = r.fromBoxes[word.old],
				to = r.toBoxes[word.fresh];
			// They file into the new sentence in reading order, so they never cross as one clump.
			const delay = (word.fresh - 9) * 0.036;
			const p = prog(t, a + 0.3 + delay, a + 0.78 + delay, ease.expoInOut);
			node.textContent = p > 0.5 ? word.next : word.text;
			node.style.transform = `translate(${lerp(from.x, to.x, p)}px, ${lerp(from.y, to.y, p)}px) scale(${lerp(1, 1 / r.size, p)})`;
			node.style.color = p > 0.02 && p < 0.98 ? 'var(--mark)' : '';
			node.style.visibility = 'visible';
		} else if (word.old !== null) {
			const from = r.fromBoxes[word.old];
			const start = a + (word.old / 55) * 0.38;
			const gone = prog(t, start, start + 0.24, ease.in);
			node.style.transform = `translate(${from.x}px, ${from.y - gone * 12}px)`;
			node.style.opacity = String(1 - gone);
			node.style.filter = gone > 0.01 ? `blur(${gone * 7}px)` : '';
			node.style.visibility = gone >= 1 ? 'hidden' : 'visible';
		} else {
			const to = r.toBoxes[word.fresh];
			const start = a + 0.7 + word.fresh * 0.024;
			const inn = prog(t, start, start + 0.3, ease.expoOut);
			node.style.transform = `translate(${to.x}px, ${to.y + (1 - inn) * 22}px) scale(${1 / r.size})`;
			node.style.opacity = String(inn);
			node.style.filter = inn < 0.99 ? `blur(${(1 - inn) * 9}px)` : '';
			node.style.visibility = inn <= 0 ? 'hidden' : 'visible';
		}
	});
	const count = Math.round(
		lerp(
			[...script.tooLong].length,
			[...script.perfect].length,
			prog(t, a + 0.05, a + 1.05, ease.inOut)
		)
	);
	const over = count > 280;
	card.countText.textContent = `${count} / 280`;
	card.countBox.style.color = over ? 'var(--red)' : 'var(--green)';
	card.countBox.style.borderColor = over ? 'var(--red)' : '#9fd3ae';
	card.countRing.style.stroke = over ? 'var(--red)' : '#2f8f57';
	card.countRing.style.strokeDashoffset = String(1 - Math.min(count / 280, 1));
	const badge = prog(t, b - 0.04, b + 0.3, ease.back);
	card.perfected.style.transform = `scale(${badge})`;
	card.perfected.style.opacity = String(clamp(badge));
}
export const product = {
	surfaces(t) {
		const on = [];
		const span = (a, b, ...names) => {
			if (t >= a && t < b) on.push(...names);
		};
		span(
			T.open,
			T.composer + 0.1,
			'sayFlow',
			'nodeRelease',
			'nodeStable',
			'nodeBuild',
			'nodeReview',
			'nodeWait',
			'nodeCreate',
			'buildPanel'
		);
		span(T.composer - 0.9, T.networks + 0.1, 'composer', 'sayReview');
		span(T.networks - 0.2, T.design + 0.1, 'cardX', 'sayNetworks');
		span(N + 6.4, T.cut + 0.3, 'artHead');
		span(T.design - 0.1, T.cut + 0.3, 'sayDesign', 'toolRail', 'inspector');
		span(T.cut - 0.6, T.schedule + 0.1, 'editor', 'sayCut');
		span(T.schedule, T.results + 0.1, 'calendar', 'saySchedule');
		span(T.results, T.inbox + 0.1, 'launchTag', 'sayResults', 'repurpose');
		span(T.inbox, T.features + 0.1, 'reply', 'sayInbox');
		span(T.features, T.logos + 0.1, 'sayEverything');
		span(T.logos - 0.1, T.converge + 0.1, 'sayLogos');
		span(T.end, DURATION + 1, 'tagline');
		return on;
	},
	dom(t, s) {
		kinetic(s.sayFlow, t, W, W + 2.6);
		kinetic(s.sayReview, t, C + 0.2, T.networks - 0.4);
		kinetic(s.sayNetworks, t, N + 0.25, closeAt[0] - 0.1);
		kinetic(s.sayDesign, t, D + 0.3, T.cut - 0.7);
		kinetic(s.sayCut, t, K + 0.2, T.schedule - 0.3);
		kinetic(s.saySchedule, t, landing + 0.05, T.results - 0.35);
		kinetic(s.sayResults, t, R + 0.35, T.inbox - 0.35);
		kinetic(s.sayInbox, t, I + 0.1, T.features - 0.4);
		kinetic(s.sayEverything, t, F + 0.05, T.logos - 0.3);
		kinetic(s.sayLogos, t, L + 0.12, T.converge - 0.2);
		for (const node of ['nodeRelease', 'nodeStable', 'nodeBuild', 'nodeReview']) {
			const label = nodeLabel(t, node);
			state(s[node], label, () => {
				s[node].stateRow.lastElementChild.textContent = label;
				const lit = label !== 'Ready';
				s[node].stateRow.style.color =
					label === 'Awaiting review'
						? 'var(--amber)'
						: label === 'Running'
							? 'var(--mark)'
							: lit
								? 'var(--green)'
								: 'var(--muted)';
				s[node].card.style.borderColor = lit ? 'var(--mark)' : 'var(--border)';
			});
		}
		if (t >= buildOpen[0] - 0.1 && t < buildOpen[3] + 0.1) buildDom(t, s.buildPanel);
		const typedText = script.draft.slice(
			0,
			Math.round(clamp((t - stream[0]) / (stream[1] - stream[0])) * script.draft.length)
		);
		const pressed = between(t, approveAt - 0.04, approveAt + 0.14);
		state(s.composer, `${typedText.length}|${t >= stream[1] + 0.2}|${pressed}`, () => {
			s.composer.text.textContent = typedText;
			s.composer.caret.style.opacity = t < stream[1] + 0.1 ? '1' : '0';
			s.composer.drafted.style.opacity = t >= stream[1] + 0.2 ? '1' : '0';
			s.composer.count.textContent = `${[...typedText].length} / 280`;
			s.composer.approve.style.transform = pressed ? 'scale(.94)' : '';
		});
		const morph = clamp((t - morphAt[0] + 0.02) / (morphAt[1] - morphAt[0] + 0.4));
		state(s.cardX, morph.toFixed(4), () => rewriteDom(t, s.cardX));
		const selected = t >= toolAt && t < swatchAt + 0.55;
		const sweep = prog(t, swatchAt + 0.03, swatchAt + 0.4, ease.inOut);
		state(s.artHead, `${selected}|${sweep.toFixed(3)}`, () => {
			s.artHead.selection.style.display = selected ? 'block' : 'none';
			s.artHead.hot.style.setProperty('--sweep', `${sweep * 100}%`);
		});
		state(s.toolRail, String(selected), () => {
			const tool = s.toolRail.tools[1].style;
			tool.background = selected ? 'var(--selection)' : '';
			tool.color = selected ? 'var(--focal)' : '';
		});
		const picked = t >= swatchAt;
		const added = t >= addAt + 0.05;
		state(s.inspector, `${picked}|${added}`, () => {
			s.inspector.dots[1].style.outline = picked ? '3px solid var(--ink)' : '';
			s.inspector.dots[1].style.outlineOffset = '2px';
			s.inspector.add.lastChild.textContent = added ? ' Added' : ' Add to post';
		});
		const e = s.editor;
		state(e, `monitor|${t >= K - 0.06}`, () => {
			e.monitor.style.visibility = t >= K - 0.06 ? 'visible' : 'hidden';
		});
		if (t >= K - 0.6 && t < T.schedule + 0.1) {
			e.clips.forEach((clip, i) => {
				const q = prog(t, K + 0.05 + i * 0.18, K + 0.4 + i * 0.18, ease.expoOut);
				clip.style.transform = `translateX(${(1 - q) * 260}px)`;
				clip.style.opacity = String(q);
			});
			e.captionClips.forEach((clip, i) => {
				const at = K + 0.85 + i * 0.22;
				const q = prog(t, at, at + 0.3, ease.back);
				clip.style.transform = `scale(${q})`;
				clip.style.opacity = String(prog(t, at, at + 0.06));
				e.caps[i].style.opacity = String(prog(t, at, at + 0.1));
			});
			e.wave.style.clipPath = `inset(0 ${(1 - prog(t, K + 0.3, K + 1, ease.inOut)) * 100}% 0 0)`;
			const head = headPosition(t);
			e.head.style.transform = `translateX(${head}px)`;
			const width = prog(t, dragFade[0], dragFade[1], ease.inOut) * FADE_PX;
			e.wedge.style.width = `${width}px`;
			// Playing the edit: the picture really fades as the head crosses the wedge.
			e.fade.style.opacity = String(clamp((head - (e.track.width - FADE_PX)) / FADE_PX));
			e.dirty = true;
		}
		const landed = t >= landing;
		state(s.calendar, String(landed), () => {
			s.calendar.ours.style.opacity = landed ? '1' : '0';
		});
		const views = Math.round(3400 * prog(t, R + 1.5, R + 2.5, ease.expoOut));
		state(s.launchTag, String(views), () => {
			s.launchTag.views.textContent = views.toLocaleString('en-US');
		});
		const made = t >= repurposeAt + 0.1;
		state(s.repurpose, String(made), () => {
			s.repurpose.text.textContent = made ? 'New draft ready' : 'Do more of what worked';
			s.repurpose.text.style.color = made ? 'var(--green)' : '';
		});
		const reply = script.reply.slice(
			0,
			Math.round(prog(t, I + 1.5, I + 2.4, ease.linear) * script.reply.length)
		);
		const sent = t >= I + 2.8;
		state(s.reply, `${reply.length}|${sent}`, () => {
			s.reply.text.textContent = sent ? 'Replied on Threads' : reply;
			s.reply.text.style.color = sent ? 'var(--green)' : '';
			s.reply.text.style.fontWeight = sent ? '600' : '';
		});
		const stopGone = t >= T.period;
		state(s.tagline, String(stopGone), () => {
			s.tagline.stop.style.visibility = stopGone ? 'hidden' : 'visible';
		});
	},
	measure(s) {
		measureReel(s);
		const r = s.cardX.rewrite;
		const box = (node) => ({ x: node.offsetLeft, y: node.offsetTop });
		r.fromBoxes = r.from.map(box);
		r.toBoxes = r.to.map(box);
		const picture = anchorOf(s.cardX, s.cardX.media);
		const scale = reelScale('cardX');
		media.scale = (960 * scale) / 1200;
		media.c = [picture.x * scale, REEL.y + picture.y * scale, 4];
		// The camera ends where the picture covers exactly what the image editor's canvas will.
		const zoom = ART.w / (960 * scale);
		const eye = [media.c[0] - ART.x / zoom, media.c[1] + 75 / zoom, PIXEL_D / zoom];
		media.eye = eye;
		media.at = [eye[0], eye[1], 0];
		spots.buildTicks = s.buildPanel.rows.map((row) => anchorOf(s.buildPanel, row.tick));
		spots.approve = anchorOf(s.composer, s.composer.approve);
		spots.tool = anchorOf(s.toolRail, s.toolRail.tools[1]);
		spots.swatch = anchorOf(s.inspector, s.inspector.dots[1]);
		spots.add = anchorOf(s.inspector, s.inspector.add);
		const monitor = anchorOf(s.editor, s.editor.monitor);
		spots.monitor = [monitor.x, ART.y + monitor.y, 6];
		const outro = anchorOf(s.editor, s.editor.clips[2]);
		spots.fadeEnd = { x: outro.x + 260, y: outro.y };
		spots.repurpose = anchorOf(s.repurpose, s.repurpose.button);
		spots.reply = anchorOf(s.reply, s.reply.button);
		spots.slot = anchorOf(s.urlLine, s.urlLine.slot).x;
		const stop = anchorOf(s.tagline, s.tagline.stop);
		spots.stop = [stop.x * END.tagline.s, END.stop];
	},
	draw(scene, t, s) {
		scene.world = worldProduct();
		scene.eyeHeight = -100000;
		windows.find(([a, b]) => t >= a && t < b)?.[2](scene, t, s);
	},
	shakes() {
		return [
			{ t: REEL.spin[1] + REEL.settle - 0.1, power: 0.32, decay: 8 },
			{ t: landing, power: 0.25, decay: 7 },
			{ t: R + 0.05 + SPIKE * 0.1, power: 1.1, decay: 6 },
			{ t: T.end, power: 2.6, decay: 4.5 }
		];
	},
	fx(t) {
		const fx = {};
		// Scene changes dissolve through the brand's Bayer pattern, sweeping left to right.
		const wipe = [T.schedule, T.results, T.logos].reduce(
			(sum, at) => Math.max(sum, 1 - Math.abs(t - at) / 0.24),
			0
		);
		if (wipe > 0) fx.wipe = [...paper.skyHorizon, wipe];
		if (between(t, T.end - 0.1, T.end + 0.6)) {
			fx.flash = [1, 1, 1, Math.max(0, 1 - Math.abs(t - T.end) * 7) * 0.9];
			fx.chromatic = 0.008 * Math.exp(-Math.max(t - T.end, 0) * 4);
		}
		return fx;
	}
};
