// OpenPost launch film. Every frame is a pure function of time: render.mjs calls
// window.film.seek(t) and captures the stage. Sound cues come from the same timeline.
// Scenes sit on the bar lines of the edited music track (see mix.py), 128 BPM.
import { ditherThreshold, gradientSvg } from '../../../packages/dither/dist/paint.js';

export const FPS = 60;
export const BPM = 128;
const BAR = 240 / BPM;
const BEAT = BAR / 4;
// The track's measured downbeats: bar(3.5) is the logo, bar(29.25) the final logo card.
const bar = (k) => 1.83 + k * BAR;
export const DURATION = bar(31.25) + 0.006;

const script = await (await fetch('./script.json')).json();
const icons = (await (await fetch('/node_modules/@iconify-json/lucide/icons.json')).json()).icons;
const avatar = '/tests/app/fixtures/product-screenshots/rodrigo-avatar.png';
const marks = (name) => `/assets/postiz-socials/${name}.svg`;

const T = {
	release: 0.25,
	tell: bar(1),
	freeze: bar(3.5) - 0.8,
	logo: bar(3.5),
	dive: bar(3.5) + 3 * BEAT,
	workflow: bar(6),
	composer: bar(8.5),
	networks: bar(11),
	shorten: bar(12.5),
	editor: bar(13.5),
	video: bar(15.5),
	schedule: bar(17.5),
	publish: bar(20),
	results: bar(22.5),
	inbox: bar(25),
	featFast: bar(26.25),
	features: bar(27.25),
	end: bar(29.25)
};

// --- Motion helpers ---------------------------------------------------------------------------
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const lerp = (a, b, p) => a + (b - a) * p;
const ease = {
	linear: (x) => x,
	out: (x) => 1 - (1 - x) ** 3,
	in: (x) => x ** 3,
	inOut: (x) => (x < 0.5 ? 4 * x ** 3 : 1 - (-2 * x + 2) ** 3 / 2),
	expoOut: (x) => (x >= 1 ? 1 : 1 - 2 ** (-10 * x)),
	expoIn: (x) => (x <= 0 ? 0 : 2 ** (10 * x - 10)),
	expoInOut: (x) =>
		x <= 0 ? 0 : x >= 1 ? 1 : x < 0.5 ? 2 ** (20 * x - 10) / 2 : (2 - 2 ** (-20 * x + 10)) / 2,
	back: (x) => 1 + 2.4 * (x - 1) ** 3 + 1.4 * (x - 1) ** 2,
	spring: (x) => (x >= 1 ? 1 : 1 - Math.exp(-7 * x) * Math.cos(10 * x))
};
const prog = (t, a, b, e = ease.out) => e(clamp((t - a) / (b - a)));
const between = (t, a, b) => t >= a && t < b;

const stage = document.getElementById('stage');
const pending = new Set();

function icon(name, size) {
	const body = icons[name]?.body;
	if (!body) throw new Error(`Missing icon ${name}`);
	const style = size ? ` style="font-size:${size}px"` : '';
	return `<svg class="icon" viewBox="0 0 24 24"${style}>${body}</svg>`;
}

function make(parent, className, frame = {}, html = '') {
	const node = document.createElement('div');
	node.className = className;
	if (html) node.innerHTML = html;
	for (const [key, property] of [
		['x', 'left'],
		['y', 'top'],
		['w', 'width'],
		['h', 'height']
	]) {
		if (frame[key] !== undefined) node.style[property] = `${frame[key]}px`;
	}
	parent.append(node);
	return node;
}

function image(parent, src, className = '') {
	const img = document.createElement('img');
	img.alt = '';
	img.className = className;
	img.src = src;
	const decoding = img.decode().catch(() => {
		throw new Error(`Could not load ${src}`);
	});
	pending.add(decoding);
	decoding.finally(() => pending.delete(decoding));
	parent.append(img);
	return img;
}

// Layout positions stay in left/top; motion is a transform on top, so alignment never drifts.
function anim(
	node,
	{ x = 0, y = 0, z = 0, s = 1, sx, sy, r = 0, rx = 0, ry = 0, o = 1, blur = 0 } = {}
) {
	const scale = sx === undefined ? `scale(${s})` : `scale(${sx}, ${sy})`;
	node.style.transform = `translate3d(${x}px, ${y}px, ${z}px) rotateX(${rx}deg) rotateY(${ry}deg) rotate(${r}deg) ${scale}`;
	node.style.opacity = String(clamp(o));
	node.style.filter = blur > 0.05 ? `blur(${blur}px)` : '';
	node.style.visibility = o <= 0.001 ? 'hidden' : 'visible';
}

const layer = (parent = stage) => make(parent, 'layer');
const show = (node, visible) => {
	node.style.display = visible ? 'block' : 'none';
	return visible;
};

// --- Brand textures ---------------------------------------------------------------------------
const ditherUrl = (ink) =>
	`url("data:image/svg+xml,${encodeURIComponent(gradientSvg({ length: 52, kind: 'button', ink }))}")`;
stage.style.setProperty('--dither-light', ditherUrl('rgb(255 255 255 / 0.16)'));
stage.style.setProperty('--dither-dark', ditherUrl('rgb(43 38 33 / 0.08)'));

function ditherCanvas(width, height, glows, rgb, alpha) {
	const canvas = document.createElement('canvas');
	canvas.width = width;
	canvas.height = height;
	const context = canvas.getContext('2d');
	const pixels = context.createImageData(width, height);
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			let coverage = 0;
			for (const [cx, cy, radius, strength] of glows) {
				const dx = (x / width - cx) * (width / height);
				const dy = y / height - cy;
				coverage += strength * Math.exp(-(dx * dx + dy * dy) / (radius * radius));
			}
			pixels.data.set([...rgb, coverage > ditherThreshold(x, y) ? alpha : 0], (y * width + x) * 4);
		}
	}
	context.putImageData(pixels, 0, 0);
	return canvas.toDataURL();
}

// Background: warm paper with slow dithered colour fields that flare on the two hits.
const glow = document.createElement('canvas');
glow.id = 'glow';
glow.width = 480;
glow.height = 270;
stage.append(glow);
const glowContext = glow.getContext('2d');
const glowPixels = glowContext.createImageData(480, 270);
const palette = [
	[232, 140, 80],
	[176, 150, 230],
	[120, 196, 150]
];
function drawGlow(t) {
	const flash = [T.logo, T.end].reduce(
		(sum, at) => sum + (t >= at ? Math.exp(-(t - at) * 2.4) : 0),
		0
	);
	const fields = [
		[0.12 + 0.05 * Math.sin(t / 2.6), 0.9, 0.38, 0.55, 0],
		[0.9, 0.08 + 0.05 * Math.cos(t / 3.1), 0.34, 0.45, 1],
		[0.78 + 0.04 * Math.sin(t / 3.7), 0.95, 0.26, 0.35, 2],
		[0.5, 0.45, 0.25 + 0.25 * flash, 1.1 * flash, 0]
	];
	const data = glowPixels.data;
	for (let y = 0; y < 270; y++) {
		for (let x = 0; x < 480; x++) {
			let best = 0;
			let colour = 0;
			let coverage = 0;
			for (const [cx, cy, radius, strength, hue] of fields) {
				const dx = (x / 480 - cx) * 1.78;
				const dy = y / 270 - cy;
				const value = strength * Math.exp(-(dx * dx + dy * dy) / (radius * radius));
				coverage += value;
				if (value > best) {
					best = value;
					colour = hue;
				}
			}
			const index = (y * 480 + x) * 4;
			const [r, g, b] = palette[colour];
			data[index] = r;
			data[index + 1] = g;
			data[index + 2] = b;
			data[index + 3] =
				coverage * 0.55 > ditherThreshold(x, y) ? 30 + Math.min(40, coverage * 40) : 0;
		}
	}
	glowContext.putImageData(glowPixels, 0, 0);
}

// --- Shared pieces ----------------------------------------------------------------------------
const cues = [];
function cue(t, role, extra) {
	const entry = { t: Math.round(t * 1000) / 1000, role };
	if (extra) Object.assign(entry, extra);
	cues.push(entry);
}
function typingCues(start, end, text, every = 0.11) {
	let last = -1;
	[...text].forEach((character, i) => {
		const at = start + ((end - start) * i) / text.length;
		if (at - last < every || character === ' ') return;
		last = at;
		cue(at, 'key');
	});
}
const typed = (t, start, end, text) =>
	text.slice(0, Math.round(clamp((t - start) / (end - start)) * text.length));

// Titles: words rise out of a blur, one line, always on the same row.
function title(parent, text, accent = []) {
	const node = make(parent, 'box title', { y: 84 });
	const words = text.split(' ').map((word, i, all) => {
		const span = document.createElement('span');
		span.className = `word${accent.includes(word) ? ' accent' : ''}`;
		span.textContent = word + (i < all.length - 1 ? ' ' : '');
		node.append(span);
		return span;
	});
	return (t, start, end) => {
		const visible = t >= start - 0.02 && t < end + 0.45;
		node.style.display = visible ? 'block' : 'none';
		if (!visible) return;
		const last = words.length - 1;
		const band =
			prog(t, start, start + 0.4) * (1 - prog(t, end + last * 0.025, end + last * 0.025 + 0.3));
		node.style.setProperty('--band', String(band));
		words.forEach((word, i) => {
			const enter = prog(t, start + i * 0.06, start + i * 0.06 + 0.55, ease.expoOut);
			const leave = prog(t, end + i * 0.025, end + i * 0.025 + 0.3, ease.in);
			word.style.transform = `translateY(${(1 - enter) * 0.45 - leave * 0.3}em)`;
			word.style.opacity = String(enter * (1 - leave));
			const blur = (1 - enter) * 12 + leave * 10;
			word.style.filter = blur > 0.1 ? `blur(${blur}px)` : '';
		});
	};
}

const logoPaths = [
	'M 24,4 H 60 V 32 L 32,60 H 4 V 24 A 20,20 0 0 1 24,4 Z',
	'm 68,4 h 36 a 20,20 0 0 1 20,20 V 60 H 96 L 68,32 Z',
	'm 4,68 h 28 l 28,28 v 28 H 24 A 20,20 0 0 1 4,104 Z',
	'M 68,96 96,68 h 28 v 36 a 20,20 0 0 1 -20,20 H 68 Z'
];
const quadrants = [
	[-1, -1],
	[1, -1],
	[-1, 1],
	[1, 1]
];
// The Converge mark: four modules, each drawn as its own element so it can fly in.
function convergeMark(parent, size) {
	const holder = make(parent, 'box', { x: 0, y: 0, w: size, h: size });
	holder.style.transformOrigin = '50% 50%';
	const parts = logoPaths.map((d) => {
		const part = make(
			holder,
			'box mark',
			{ x: 0, y: 0, w: size, h: size },
			`<svg viewBox="0 0 128 128" width="${size}" height="${size}"><path d="${d}"/></svg>`
		);
		part.style.transformOrigin = '50% 50%';
		return part;
	});
	const flare = make(holder, 'box', { x: size / 2 - 20, y: size / 2 - 20, w: 40, h: 40 });
	flare.style.background = '#fff';
	// A ring of dithered sparks: square cells, like the brand's Bayer texture.
	const sparks = Array.from({ length: 20 }, (_, i) => {
		const spark = make(parent, 'box', { x: 0, y: 0, w: 12, h: 12 });
		spark.style.background = i % 3 ? 'var(--mark)' : '#e9a066';
		return {
			spark,
			angle: (i / 20) * Math.PI * 2 + (i % 2) * 0.12,
			reach: 0.75 + ((i * 37) % 10) / 20
		};
	});
	return { holder, parts, flare, sparks, size };
}
// Modules arrive from the four corners, lock with a quarter turn, and the centre flares.
function drawMark(mark, t, hit, { cx, cy, scale = 1, spread = 520, blur = 0 }) {
	const arrive = prog(t, hit - 0.55, hit, ease.expoIn);
	const settle = prog(t, hit, hit + 0.55, ease.spring);
	mark.parts.forEach((part, i) => {
		const [dx, dy] = quadrants[i];
		const distance = (1 - arrive) * spread + (t >= hit ? (1 - settle) * -12 : 0);
		anim(part, {
			x: dx * distance,
			y: dy * distance,
			r: (1 - arrive) * dx * dy * 40,
			s: lerp(0.4, 1, arrive),
			o: prog(t, hit - 0.55, hit - 0.4)
		});
	});
	const turn = t >= hit ? lerp(-90, 0, settle) : -90;
	const pop = t >= hit ? 1 + 0.12 * Math.exp(-(t - hit) * 6) * Math.cos((t - hit) * 18) : 1;
	anim(mark.holder, {
		x: cx - mark.size / 2,
		y: cy - mark.size / 2,
		r: turn,
		s: scale * pop,
		o: prog(t, hit - 0.55, hit - 0.45),
		blur
	});
	const flash = t >= hit ? Math.exp(-(t - hit) * 5) : 0;
	anim(mark.flare, { s: 1 + (1 - flash) * 5, o: flash * 0.9, r: 45 });
	const burst = t >= hit ? clamp((t - hit) / 0.9) : 0;
	for (const { spark, angle, reach } of mark.sparks) {
		const distance = ease.expoOut(burst) * mark.size * 1.25 * reach * scale;
		anim(spark, {
			x: cx - 6 + Math.cos(angle) * distance,
			y: cy - 6 + Math.sin(angle) * distance,
			r: 45,
			s: 1 - burst * 0.6,
			o: burst > 0 && burst < 1 ? 1 - burst : 0
		});
	}
}

function wordmark(parent, text) {
	const node = make(parent, 'box wordmark');
	const letters = [...text].map((character) => {
		const span = document.createElement('span');
		span.textContent = character;
		node.append(span);
		return span;
	});
	return {
		node,
		draw(t, start) {
			letters.forEach((letter, i) => {
				const p = prog(t, start + i * 0.035, start + i * 0.035 + 0.45, ease.expoOut);
				letter.style.transform = `translateY(${(1 - p) * 0.35}em)`;
				letter.style.opacity = String(p);
				letter.style.filter = p < 0.98 ? `blur(${(1 - p) * 10}px)` : '';
			});
		}
	};
}

// Each scene keeps its title steady and moves its content on a slow dolly, so no shot holds still.
function cam(parent) {
	const node = make(parent, 'world');
	node.style.transformOrigin = '960px 600px';
	return node;
}
function dolly(t, start, end, amount = 0.05) {
	const p = prog(t, start, end, ease.linear);
	return { s: 1 + amount * p, rx: -1.5 * p, ry: 3 * p - 1.5 * p * p };
}

const cursor = make(
	stage,
	'box cursor',
	{ x: 0, y: 0 },
	'<svg viewBox="0 0 24 24" width="64" height="64"><path d="M5 2.8 19.6 12.3l-6.6 1.5-3.3 6.4z" fill="#fff" stroke="#2b2621" stroke-width="1.3" stroke-linejoin="round"/></svg>'
);
cursor.style.zIndex = '40';
// Cursor keyframes: [time, x, y, scale]; clicks press it for a moment.
const clicks = [T.editor + 1.2, T.editor + 2.7, T.editor + 3.15, T.schedule + 0.6, T.inbox + 1.5];
const cursorPath = [
	// Image editor: select the headline, drag its corner out, recolour, add to the post.
	[T.editor + 0.7, 380, 980, 1],
	[T.editor + 1.15, 570, 650, 1],
	[T.editor + 1.65, 943, 800, 1],
	[T.editor + 2.15, 990, 816, 1],
	[T.editor + 2.65, 820, 1000, 1],
	[T.editor + 3.1, 1666, 284, 1],
	// Schedule: onto the Schedule button of the close-up.
	[T.schedule + 0.02, 1680, 1000, 2.4],
	[T.schedule + 0.55, 1450, 530, 2.4],
	[T.schedule + 1.0, 1480, 560, 2.4],
	// Inbox: type the reply, then hit Reply.
	[T.inbox + 0.9, 1560, 1080, 1],
	[T.inbox + 1.45, 1418, 916, 1],
	[T.inbox + 2.1, 1480, 1090, 1]
];
for (const at of clicks) cue(at, 'click');
function drawCursor(t) {
	const windows = [
		[T.editor + 0.7, T.editor + 3.5],
		[T.schedule + 0.02, T.schedule + 1.0],
		[T.inbox + 0.9, T.inbox + 2.1]
	];
	const active = windows.find(([a, b]) => between(t, a, b));
	if (!active) return anim(cursor, { o: 0 });
	const path = cursorPath.filter(([at]) => at >= active[0] - 0.001 && at <= active[1] + 0.001);
	let [, x, y, s] = path[0];
	for (let i = 1; i < path.length; i++) {
		const [t0, x0, y0, s0] = path[i - 1];
		const [t1, x1, y1, s1] = path[i];
		if (t >= t0) {
			const p = ease.inOut(clamp((t - t0) / (t1 - t0)));
			x = lerp(x0, x1, p);
			y = lerp(y0, y1, p);
			s = lerp(s0, s1, p);
		}
	}
	const pressed = clicks.some((at) => between(t, at - 0.03, at + 0.1));
	const fade = prog(t, active[0], active[0] + 0.15) * (1 - prog(t, active[1] - 0.15, active[1]));
	anim(cursor, { x: x - 8, y: y - 6, s: s * (pressed ? 0.86 : 1), o: fade });
}

// --- The sample launch image (Lumen 2.0) ------------------------------------------------------
const artGlow = ditherCanvas(300, 157, [[0.9, 1.05, 0.55, 1.3]], [126, 240, 210], 120);
function artwork(parent, frame, scale) {
	const holder = make(parent, 'box', frame);
	holder.style.transformOrigin = '0 0';
	const art = make(holder, 'art');
	art.style.transform = `scale(${scale})`;
	image(art, artGlow, 'glow');
	const brand = make(art, 'brand', {}, `<i></i>${script.product}`);
	const headline = make(art, 'headline', {}, `${script.product}<br>2.0`);
	const tag = make(art, 'tag', {}, script.release);
	const device = make(
		art,
		'device',
		{},
		'<span style="width:60%"></span><span></span><span style="width:80%"></span><span style="width:45%"></span><b><em></em>Synced offline</b>'
	);
	return { holder, art, brand, headline, tag, device };
}

if (location.search.includes('artwork')) {
	const piece = artwork(stage, { x: 0, y: 0 }, 1);
	piece.holder.id = 'artwork';
	cursor.style.display = 'none';
	piece.holder.style.width = '1200px';
	piece.holder.style.height = '628px';
	await document.fonts.ready;
	while (pending.size) await Promise.all(pending);
	window.film = { seek: async () => {}, cues: [], FPS, BPM, DURATION, sections: T };
	// Artwork mode renders only the launch image; the film below never builds.
	await new Promise(() => {});
}

// --- 1. Hook: the release, then the pile of work --------------------------------------------
const hookLayer = layer();
const hookTitleA = title(hookLayer, 'You just shipped.', ['shipped.']);
const hookTitleB = title(hookLayer, 'Now tell everyone.', ['everyone.']);
const hookCam = cam(hookLayer);
function releaseCard(parent, frame) {
	const node = make(parent, 'box card', frame);
	node.style.padding = '30px 34px';
	node.innerHTML = `
		<div class="row" style="gap:14px;font-size:22px;color:var(--muted)">${icon('github', 30)}<span>${script.repository}</span>
			<span style="margin-left:auto;padding:4px 14px;border-radius:999px;border:1px solid #9fd3ae;color:var(--green);font-size:18px;font-weight:600">Latest</span></div>
		<div class="row" style="gap:14px;margin-top:22px">${icon('tag', 30)}<span style="font-size:40px;font-weight:600;letter-spacing:-0.02em">${script.product} ${script.tag.replace('v', '')}</span></div>
		<div style="margin-top:8px;font-size:26px;color:var(--muted)">${script.release}</div>
		<div style="margin-top:22px;display:grid;gap:10px;font-size:22px">
			<div class="row check" style="gap:12px">${icon('check', 22)}Offline sync across devices</div>
			<div class="row check" style="gap:12px">${icon('check', 22)}A faster editor</div>
			<div class="row check" style="gap:12px">${icon('check', 22)}Dark mode</div>
		</div>`;
	return { node, checks: [...node.querySelectorAll('.check')] };
}
const release = releaseCard(hookCam, { x: 660, y: 330, w: 600, h: 380 });
const checkAt = [0, 1, 2].map((i) => T.release + 0.95 + i * 0.32);
checkAt.forEach((at) => cue(at, 'tick'));
const networks16 = [
	'X',
	'Linkedin',
	'Bluesky',
	'Threads',
	'Mastodon',
	'Instagram',
	'Youtube',
	'TikTok',
	'Facebook',
	'Pinterest',
	'Telegram',
	'Discord',
	'Pixelfed',
	'Peertube',
	'Lemmy',
	'PieFed'
];
// The work that piles up after a launch, close to the card; networks on an outer ring.
const tasks = [
	['Write the X thread', 230, 250],
	['LinkedIn version', 1400, 230],
	['Design a thumbnail', 150, 500],
	['Cut a teaser', 1500, 480],
	['Resize for Instagram', 260, 790],
	['Write alt text', 1390, 790],
	['Schedule everything', 600, 900],
	['Answer the replies', 1030, 915],
	['Post at the right time', 560, 205],
	['Check the numbers', 1060, 190]
];
const pile = [
	...tasks.map(([text, x, y]) => ({
		node: make(hookCam, 'box task', { x, y }, `<i></i>${text}`),
		x,
		y,
		task: true
	})),
	...networks16.map((name, k) => {
		const angle = (k / networks16.length) * Math.PI * 2 + 0.2;
		const x = 960 + Math.cos(angle) * 860 * (k % 2 ? 1 : 0.9) - 46;
		const y = 560 + Math.sin(angle) * 430 * (k % 2 ? 1 : 0.9) - 46;
		const tile = make(hookCam, 'box tile', { x, y });
		image(tile, marks(name));
		return { node: tile, x, y, task: false };
	})
];
pile.forEach((item, i) => {
	item.quadrant = quadrants[(item.x > 900 ? 1 : 0) + (item.y > 520 ? 2 : 0)];
	item.r = ((i * 47) % 13) - 6;
});
// Pops accelerate as the pile grows.
const pileOrder = pile
	.map((_, i) => i)
	.sort((a, b) => ((a * 11) % pile.length) - ((b * 11) % pile.length));
pileOrder.forEach((index, n) => {
	pile[index].at = T.tell + 0.12 + 3.25 * (n / pile.length) ** 0.72;
	cue(pile[index].at, pile[index].task ? 'pop' : 'tick');
});
cue(T.release, 'whoosh');
cue(T.logo, 'riser');

function hookScene(t) {
	if (!show(hookLayer, t < T.logo + 0.05)) return;
	hookTitleA(t, T.release + 0.2, 3.62);
	hookTitleB(t, T.tell + 0.05, T.freeze);
	anim(hookCam, dolly(t, 0, T.logo, 0.06));
	const suck = prog(t, T.freeze + 0.05, T.logo - 0.03, ease.expoIn);
	const enter = prog(t, T.release, T.release + 0.8, ease.expoOut);
	const crowd = prog(t, T.tell - 0.4, T.tell + 0.3, ease.inOut);
	anim(release.node, {
		y: (1 - enter) * 140,
		rx: (1 - enter) * 28 + Math.sin(t * 0.9) * 2,
		ry: Math.cos(t * 0.7) * 3,
		s: lerp(1.25, 1.4, enter) * lerp(1, 0.86, crowd) * (1 - suck * 0.9),
		o: prog(t, T.release, T.release + 0.3) * (1 - prog(t, T.logo - 0.25, T.logo - 0.05)),
		blur: (1 - enter) * 10
	});
	release.checks.forEach((row, i) => {
		const tick = prog(t, checkAt[i], checkAt[i] + 0.35, ease.back);
		anim(row, { x: (1 - tick) * -16, o: 0.25 + 0.75 * prog(t, checkAt[i], checkAt[i] + 0.15) });
	});
	for (const item of pile) {
		const pop = prog(t, item.at, item.at + 0.42, ease.back);
		const [qx, qy] = item.quadrant;
		const targetX = 960 + qx * 110 - item.x - 46;
		const targetY = 540 + qy * 110 - item.y - 46;
		const drift = Math.sin(t * 1.7 + item.r) * 6 * (1 - suck);
		anim(item.node, {
			x: targetX * suck,
			y: targetY * suck + drift,
			r: item.r * (1 - suck) + suck * qx * qy * 60,
			s: pop * lerp(1.3, 0.3, suck),
			o: prog(t, item.at, item.at + 0.08) * (1 - prog(t, T.logo - 0.12, T.logo))
		});
	}
}

// --- 2. The four pieces converge: OpenPost -----------------------------------------------
const revealLayer = layer();
const revealMark = convergeMark(revealLayer, 300);
const revealWord = wordmark(revealLayer, 'OpenPost');
const revealLine = make(
	revealLayer,
	'box closing',
	{ y: 586 },
	'The all-in-one content team for solo founders.'
);
revealLine.style.fontSize = '40px';
revealLine.style.color = 'var(--muted)';
for (let i = 0; i < 4; i++) cue(T.logo - 0.32 + i * 0.08, 'pop');
cue(T.logo, 'land');
cue(T.logo + 0.72, 'whoosh');
cue(T.logo + 1.25, 'tick');
cue(T.logo, 'impact', { gain_db: 2 });
cue(T.logo + 0.02, 'shimmer');
// The dive accelerates into its last frames: the swoosh peaks there.
cue(T.workflow - 0.19, 'swoosh');

function revealScene(t) {
	if (!show(revealLayer, between(t, T.logo - 0.6, T.workflow + 0.1))) return;
	const slide =
		prog(t, T.logo + 0.45, T.logo + 1.05, ease.expoInOut) *
		(1 - prog(t, T.dive - 0.6, T.dive - 0.05, ease.expoInOut));
	const total = 190 + 40 + revealWord.node.offsetWidth;
	// The dive never stops moving: a steady push from the moment the tagline settles,
	// charging into an exponential burst so the swoosh peaks on the last frames.
	const diveAt = T.logo + 2.1;
	const dive = clamp(
		0.24 * prog(t, diveAt, T.workflow - 0.1, ease.linear) +
			0.76 * prog(t, T.workflow - 1.05, T.workflow - 0.1, ease.expoIn)
	);
	drawMark(revealMark, t, T.logo, {
		cx: lerp(960, 960 - total / 2 + 95, slide),
		cy: 470,
		scale: lerp(1, 190 / 300, slide) * lerp(1, 60, dive),
		blur: dive > 0.15 ? Math.min(9, (dive - 0.15) * 26) : 0
	});
	const wordOut = 1 - prog(t, diveAt + 0.3, diveAt + 0.75);
	anim(revealWord.node, { x: 960 - total / 2 + 230, y: 470 - 82, o: slide > 0.02 ? wordOut : 0 });
	revealWord.draw(t, T.logo + 0.7);
	const line = prog(t, T.logo + 1.25, T.logo + 1.85, ease.expoOut) * wordOut;
	anim(revealLine, { y: (1 - line) * 24, o: line, blur: (1 - line) * 8 });
}

// --- 3. Workflows: authored nodes, branching paths and a camera that follows the run ---------
const flowLayer = layer();
const flowTitle = title(flowLayer, 'Your release becomes a draft.', ['a', 'draft.']);
const flowCam = cam(flowLayer);
const flowViewport = make(flowCam, 'box flow-viewport', { x: 0, y: 225, w: 1920, h: 855 });
const flowPan = make(flowViewport, 'world');
flowPan.style.transformOrigin = '0 0';
// These use the app's native node categories: GitHub, condition, Builder, approval and wait.
const flowSpec = [
	['github', 'GitHub release', script.repository, 80, 310, 'trigger', 0.45],
	['git-branch', 'Stable release?', 'Check release type', 620, 310, 'flow', 1.2],
	['sparkles', 'Build draft', 'Release notes to post', 1160, 100, 'ai', 2.05],
	['check', 'Review post', 'Ready for your approval', 1700, 100, 'flow', 3.15],
	['clock', 'Wait', 'Pre-release · wait 1 day', 1160, 580, 'flow', null],
	['square-pen', 'Create draft', 'Keep the release notes', 1700, 580, 'content', null],
	['check', 'Review post', 'Your review comes first', 2240, 580, 'flow', null]
];
const flowNodes = flowSpec.map(([glyph, label, detail, x, y, category, at]) => {
	const node = make(
		flowPan,
		`box flow-node ${category}`,
		{ x, y, w: 390, h: 142 },
		`<span class="flow-port input"></span><div class="row" style="gap:20px"><span class="flow-icon">${icon(glyph, 34)}</span><div><b>${label}</b><p>${detail}</p></div></div><div class="flow-state">${icon('circle', 15)}<span>Ready</span></div><span class="flow-port output"></span>`
	);
	return {
		node,
		x,
		y,
		w: 390,
		h: 142,
		cx: x + 195,
		cy: y + 71,
		at: at === null ? null : T.workflow + at,
		state: node.querySelector('.flow-state')
	};
});
const flowEdges = [
	[0, 1, ''],
	[1, 2, 'Yes'],
	[2, 3, ''],
	[1, 4, 'No'],
	[4, 5, ''],
	[5, 6, '']
].map(([from, to, label]) => {
	const a = flowNodes[from],
		b = flowNodes[to];
	const x = a.x + a.w,
		y = a.cy,
		end = b.x;
	const path = `M${x} ${y} C${x + 76} ${y},${end - 76} ${b.cy},${end} ${b.cy}`;
	const holder = make(
		flowPan,
		'box flow-edge',
		{ x: 0, y: 0, w: 2700, h: 850 },
		`<svg width="2700" height="850"><path d="${path}" fill="none" stroke="var(--border)" stroke-width="3"/><path class="run-path" d="${path}" fill="none" stroke="var(--mark)" stroke-width="4" pathLength="1" stroke-dasharray="1" stroke-dashoffset="1"/></svg>`
	);
	if (label) make(flowPan, 'box flow-branch', { x: x + 56, y: (y + b.cy) / 2 - 17 }, label);
	return { holder, path: holder.querySelector('.run-path'), from: a, to: b };
});
// Edges live behind the nodes, with no screenshot or highlight overlay underneath.
flowNodes.forEach(({ node }) => flowPan.append(node));
const flowKeys = [
	[0, 500, 410, 0.78],
	[0.55, 400, 410, 1.13],
	[1.25, 865, 410, 1.08],
	[2.1, 1385, 250, 1.06],
	// No pull-back after Build draft: the camera glides on to Review post at the same depth.
	[3.5, 1895, 171, 1.13]
];
function flowCamera(t) {
	let [, x, y, zoom] = flowKeys[0];
	for (let i = 1; i < flowKeys.length; i++) {
		const [a, ax, ay, az] = flowKeys[i - 1],
			[b, bx, by, bz] = flowKeys[i];
		if (t >= T.workflow + a) {
			const p = prog(t, T.workflow + a, T.workflow + b, ease.inOut);
			x = lerp(ax, bx, p);
			y = lerp(ay, by, p);
			zoom = lerp(az, bz, p);
		}
	}
	return { x: 960 - x * zoom, y: 400 - y * zoom, s: zoom };
}
const reviewScreen = () => ({
	x: 960 - (390 * 1.13) / 2,
	y: 625 - (142 * 1.13) / 2,
	w: 390 * 1.13,
	h: 142 * 1.13
});
for (const node of flowNodes) if (node.at !== null) cue(node.at, 'land');
cue(T.workflow + 1.47, 'whoosh');
cue(T.workflow + 2.35, 'ding');
cue(T.workflow + 2.65, 'swoosh');
cue(T.workflow + 3.15, 'pop');
function flowScene(t) {
	if (!show(flowLayer, between(t, T.dive + 0.3, T.composer + 0.6))) return;
	flowTitle(t, T.workflow + 0.15, T.composer - 0.6);
	const through = prog(t, T.dive + 0.5, T.workflow + 0.15, ease.expoOut);
	const out = prog(t, T.composer - 0.55, T.composer + 0.2, ease.expoInOut);
	anim(flowCam, { s: lerp(0.7, 1, through), o: through * (1 - out), blur: (1 - through) * 10 });
	anim(flowPan, flowCamera(t));
	flowNodes.forEach(({ node, at, state }, i) => {
		const enter = prog(t, T.workflow - 0.3 + i * 0.055, T.workflow + 0.3 + i * 0.055);
		anim(node, { y: (1 - enter) * 34, o: enter });
		const active = at !== null && t >= at;
		const review = i === 3 && active;
		node.classList.toggle('active', active);
		state.innerHTML = `${icon(review ? 'clock' : active ? 'circle-check' : 'circle', 15)}<span>${review ? 'Awaiting review' : active ? 'Completed' : 'Ready'}</span>`;
		state.style.color = review ? 'var(--amber)' : active ? 'var(--green)' : 'var(--muted)';
	});
	flowEdges.forEach(({ holder, path, from, to }) => {
		anim(holder, { o: through });
		const travel = to.at === null ? 0 : prog(t, from.at + 0.12, to.at - 0.05, ease.inOut);
		path.style.strokeDashoffset = String(1 - travel);
	});
}

// --- 4. Composer: review the draft once ---------------------------------------------------
const composerLayer = layer();
const composerTitle = title(composerLayer, 'Review it once.', ['once.']);
const composerCam = cam(composerLayer);
const composer = { x: 170, y: 230, w: 1580, h: 700 };
const composerCard = make(composerCam, 'box card', composer);
const accounts = [
	['Linkedin', 'Rodrigo'],
	['Bluesky', '@rgo.pt'],
	['X', '@rodrgds'],
	['Threads', 'rodrgds'],
	['Mastodon', '@rgo']
];
const tabs = make(composerCam, 'box row', { x: composer.x + 48, y: composer.y + 36 });
tabs.style.cssText += ';gap:34px;font-size:25px';
const allTab = make(tabs, '', {}, 'All');
allTab.style.cssText = 'font-weight:600;padding-bottom:14px;border-bottom:3px solid var(--ink)';
const accountTabs = accounts.map(([mark, handle]) => {
	const tab = make(tabs, 'row muted');
	tab.style.cssText += ';gap:12px;padding-bottom:14px';
	const face = make(tab, 'avatar');
	image(face, avatar);
	image(face, marks(mark));
	tab.append(handle);
	return tab;
});
const divider = make(composerCam, 'box', {
	x: composer.x + 48,
	y: composer.y + 112,
	w: composer.w - 96,
	h: 1
});
divider.style.background = 'var(--line)';
const draftText = make(composerCam, 'box', {
	x: composer.x + 52,
	y: composer.y + 150,
	w: composer.w - 104
});
draftText.style.cssText += ';font-size:50px;line-height:1.38;letter-spacing:-0.02em';
const drafted = make(
	composerCam,
	'box row muted',
	{ x: composer.x + 52, y: composer.y + 415 },
	`<span style="color:var(--mark)">${icon('workflow', 20)}</span>Drafted by Workflows · ${script.tag}`
);
drafted.style.cssText += ';gap:10px;font-size:21px';
const composerTools = make(composerCam, 'box row', {
	x: composer.x + 48,
	y: composer.y + composer.h - 96,
	w: composer.w - 96,
	h: 56
});
composerTools.style.justifyContent = 'space-between';
make(
	composerTools,
	'row muted',
	{},
	['image', 'list-checks', 'smile'].map((name) => icon(name, 32)).join('')
).style.gap = '28px';
const toolsRight = make(composerTools, 'row');
toolsRight.style.gap = '22px';
const composerCount = make(toolsRight, 'counter');
make(toolsRight, 'button ordinary', {}, `${icon('sparkles', 22)} Ideate`);
make(toolsRight, 'button focal', {}, `${icon('calendar', 22)} Schedule`);
// The Review post node opens into the composer: a live replica of the node carries its
// content across while the sheet unfolds around it, so nothing pops from white nothing.
const flowMorph = make(composerLayer, 'box flow-node flow', {});
flowMorph.innerHTML = `<span class="flow-port input"></span><span class="flow-port output"></span><div class="morph-body"><div class="row" style="gap:20px"><span class="flow-icon">${icon('check', 34)}</span><div><b>Review post</b><p>Ready for your approval</p></div></div><div class="flow-state">${icon('clock', 15)}<span>Awaiting review</span></div></div>`;
flowMorph.style.boxShadow = '0 24px 70px rgb(43 38 33 / 18%)';
const morphBody = flowMorph.querySelector('.morph-body');
morphBody.style.transformOrigin = '0 0';
const morphPorts = flowMorph.querySelectorAll('.flow-port');
const streamStart = T.composer + 0.5;
const streamEnd = T.composer + 1.7;
accountTabs.forEach((_, i) => cue(T.composer + 1.75 + i * 0.13, 'tick'));

function composerScene(t) {
	if (!show(composerLayer, between(t, T.composer - 0.85, T.networks + 0.3))) return;
	composerTitle(t, T.composer + 0.15, T.networks - 0.55);
	anim(composerCam, dolly(t, T.composer, T.networks, 0.07));
	const morph = prog(t, T.composer - 0.8, T.composer + 0.1, ease.expoInOut);
	const from = reviewScreen();
	Object.assign(flowMorph.style, {
		left: `${lerp(from.x, composer.x, morph)}px`,
		top: `${lerp(from.y, composer.y, morph)}px`,
		width: `${lerp(from.w, composer.w, morph)}px`,
		height: `${lerp(from.h, composer.h, morph)}px`
	});
	flowMorph.style.borderColor = morph < 0.5 ? 'var(--mark)' : 'var(--border)';
	// The node's content holds still while the sheet unfolds, then dissolves into the composer.
	const bodyScale = lerp(1.13, 1, morph);
	const dissolve = prog(t, T.composer - 0.28, T.composer + 0.02);
	anim(morphBody, { s: bodyScale, o: 1 - dissolve, blur: dissolve * 6 });
	for (const port of morphPorts)
		anim(port, { o: 1 - prog(t, T.composer - 0.55, T.composer - 0.3) });
	anim(flowMorph, { o: 1 - prog(t, T.composer + 0.12, T.composer + 0.5) });
	const burst = prog(t, T.networks - 0.05, T.networks + 0.2, ease.in);
	const inside = prog(t, T.composer + 0.1, T.composer + 0.55) * (1 - burst);
	anim(composerCard, { o: t >= T.composer + 0.1 ? inside : 0, s: 1 - burst * 0.25 });
	for (const node of [tabs, divider, composerTools]) anim(node, { o: inside, s: 1 - burst * 0.25 });
	accountTabs.forEach((tab, i) => {
		const at = T.composer + 1.75 + i * 0.13;
		anim(tab, {
			y: (1 - prog(t, at, at + 0.35, ease.back)) * 14,
			o: 0.25 + 0.75 * prog(t, at, at + 0.2)
		});
	});
	const text = typed(t, streamStart, streamEnd, script.draft);
	draftText.textContent = text;
	anim(draftText, { o: inside, s: 1 - burst * 0.25 });
	composerCount.innerHTML = `${icon('circle-check', 20)} ${text.length} / 280`;
	const badge = prog(t, streamEnd, streamEnd + 0.4);
	anim(drafted, { y: (1 - badge) * 12, o: badge * inside, blur: (1 - badge) * 4 });
}

// --- 5. Every network, its own version -----------------------------------------------------
const cardsLayer = layer();
const cardsTitle = title(cardsLayer, 'Every network, its own version.', ['its', 'own', 'version.']);
const ring = make(cardsLayer, 'world');
const cardWidth = 600;
const cardTop = 430;
const networkCards = [
	['linkedin', 'Linkedin', 3000],
	['bluesky', 'Bluesky', 300],
	['x', 'X', 280],
	['threads', 'Threads', 500],
	['mastodon', 'Mastodon', 500]
].map(([platform, mark, limit], i) => {
	const holder = make(ring, 'box', { x: 960 - cardWidth / 2, y: cardTop, w: cardWidth });
	const native = make(holder, `social-card social-${platform}`);
	const networkHeader = make(native, 'social-header row');
	image(networkHeader, avatar, 'social-avatar');
	make(
		networkHeader,
		'',
		{},
		`<b>Rodrigo</b><div class="muted">${platform === 'linkedin' ? 'Founder at Lumen · 1h' : '@lumen.app · 1h'}</div>`
	);
	make(networkHeader, 'social-more muted', {}, icon('ellipsis', 24));
	const postText = make(native, 'social-copy', {}, script.draft);
	const media = make(native, 'social-media', { w: 554, h: 290 });
	artwork(media, { x: 0, y: 0 }, 554 / 1200);
	const actions =
		platform === 'linkedin'
			? ['thumbs-up', 'message-circle', 'repeat-2', 'send']
			: ['message-circle', 'repeat-2', 'heart', 'share'];
	make(
		native,
		'social-actions row muted',
		{},
		actions
			.map(
				(name) =>
					`<span class="row" style="gap:8px">${icon(name, 23)}<span>${name === 'heart' || name === 'thumbs-up' ? '24' : '3'}</span></span>`
			)
			.join('')
	);
	const badge = make(holder, 'box badge', { x: -24, y: -24 });
	image(badge, marks(mark));
	const note = make(
		holder,
		'box chip-note',
		{ x: cardWidth - 176, y: -26 },
		`${[...script.draft].length} / ${limit.toLocaleString('en-US')}`
	);
	return { holder, postText, badge, note, i };
});
const xCard = networkCards[2];
const shortNote = make(
	xCard.holder,
	'box chip-note',
	{ x: 190, y: -96 },
	`<span class="accent">${icon('sparkles', 20)}</span>Perfected for X`
);
shortNote.style.fontSize = '21px';
// The short copy lives on a crossfade twin aligned to the live text (offsets are
// transform-independent), so the swap reads as a motion-designed change.
const xShortText = make(xCard.holder, 'social-copy');
xShortText.style.cssText += ';position:absolute;margin:0;opacity:0';
let xShortAligned = false;
networkCards.forEach((card) => cue(T.networks + 0.1 + Math.abs(card.i - 2) * 0.09, 'pop'));
cue(T.shorten, 'tick');
cue(T.shorten + 0.15, 'pop');
// The zoom-through is fastest halfway: the swoosh peaks there.
cue(T.editor - 0.29, 'swoosh');
// The authored media slot is stable while the X text changes, preserving the zoom-through.
const xMedia = { x: 300, y: 383, w: 554 };

function cardsScene(t) {
	if (!show(cardsLayer, between(t, T.networks - 0.05, T.editor + 0.1))) return;
	cardsTitle(t, T.networks + 0.2, T.editor - 0.6);
	const spin = lerp(12, 0, prog(t, T.networks, T.editor - 0.5, ease.inOut));
	// Punch in on the X card's text while it shortens, then settle before the zoom-through.
	const punch =
		prog(t, T.shorten - 0.2, T.shorten + 0.55, ease.expoInOut) *
		(1 - prog(t, T.editor - 0.95, T.editor - 0.62, ease.expoInOut));
	ring.style.transformOrigin = '960px 600px';
	anim(ring, { s: 1 + punch * 0.95 });
	// Zoom through the X card's image: it grows until it is the editor canvas.
	const zoom = prog(t, T.editor - 0.5, T.editor, ease.expoInOut);
	const canvasCentre = { x: canvas.x + 600 * canvas.scale, y: canvas.y + 314 * canvas.scale };
	if (t >= T.shorten - 0.6 && !xShortAligned) {
		xShortAligned = true;
		xShortText.style.left = `${xCard.postText.offsetLeft}px`;
		xShortText.style.top = `${xCard.postText.offsetTop}px`;
		xShortText.style.width = `${xCard.postText.clientWidth}px`;
	}
	networkCards.forEach((card) => {
		const delay = Math.abs(card.i - 2) * 0.09;
		const fly = prog(t, T.networks + delay, T.networks + delay + 0.7, ease.back);
		// 32 degrees keeps neighbours clear of each other: no clipped text, colliding
		// count pills or badges floating over the next card, and the outer two stay in frame.
		const angle = (card.i - 2) * 38 + spin * (card.i === 2 ? 0 : 1);
		const radians = (angle * Math.PI) / 180;
		const radius = 1150;
		const isX = card.i === 2;
		card.holder.style.transformOrigin = isX ? `${xMedia.x}px ${xMedia.y}px` : '50% 50%';
		anim(card.holder, {
			x:
				Math.sin(radians) * radius * fly +
				(isX ? (canvasCentre.x - (960 - cardWidth / 2 + xMedia.x)) * zoom : 0),
			y: lerp(260, 0, fly) + (isX ? (canvasCentre.y - (cardTop + xMedia.y)) * zoom : 0),
			z: (Math.cos(radians) - 1) * radius * fly - (isX ? 0 : zoom * 500),
			ry: -angle * fly,
			s: lerp(0.5, 1, fly) * (isX ? lerp(1, (1200 * canvas.scale) / xMedia.w, zoom) : 1),
			o: prog(t, T.networks + delay, T.networks + delay + 0.12) * (isX ? 1 : 1 - zoom)
		});
		anim(card.badge, {
			s: prog(t, T.networks + delay + 0.25, T.networks + delay + 0.6, ease.back),
			o: 1 - zoom
		});
		anim(card.note, {
			o: prog(t, T.networks + delay + 0.4, T.networks + delay + 0.7) * (1 - zoom)
		});
	});
	// The copy swaps as a crossfade: the long text lifts out while the short one rises in.
	const swapOut = prog(t, T.shorten, T.shorten + 0.28, ease.in);
	const swapIn = prog(t, T.shorten + 0.06, T.shorten + 0.34);
	xCard.postText.textContent = script.draft;
	xShortText.textContent = script.short;
	anim(xCard.postText, { o: 1 - swapOut, y: swapOut * -12, blur: swapOut * 5 });
	anim(xShortText, { o: swapIn, y: (1 - swapIn) * 12, blur: (1 - swapIn) * 5 });
	xCard.note.textContent = `${t >= T.shorten + 0.15 ? [...script.short].length : [...script.draft].length} / 280`;
	// The count hides while the punch pushes it into the title band, then pops back settled.
	const punchHide =
		prog(t, T.shorten - 0.2, T.shorten + 0.3) * (1 - prog(t, T.editor - 0.8, T.editor - 0.5));
	anim(xCard.note, {
		o: prog(t, T.networks + 0.4, T.networks + 0.7) * (1 - punchHide) * (1 - zoom),
		s: (1 - punchHide) * (1 + 0.2 * Math.sin(clamp((t - T.shorten - 0.15) / 0.4) * Math.PI))
	});
	const noteIn = prog(t, T.shorten + 0.1, T.shorten + 0.5, ease.back);
	anim(shortNote, { s: noteIn, o: noteIn * (1 - zoom) });
}

// --- 6. Design the image, cut the video ----------------------------------------------------
const editorLayer = layer();
const editorTitle = title(editorLayer, 'Design the visuals.', ['visuals.']);
const editorCam = cam(editorLayer);
const editorPanel = make(editorCam, 'box card', { x: 110, y: 230, w: 1700, h: 810 });
const editorBar = make(
	editorCam,
	'box row',
	{ x: 150, y: 256, w: 1620, h: 56 },
	`<span class="row" style="gap:12px;font-size:23px;font-weight:600">${icon('image', 26)}${script.product} 2.0 launch</span>`
);
editorBar.style.justifyContent = 'space-between';
const addPostButton = make(editorBar, 'button focal', {}, `${icon('send', 20)} Add to post`);
const rail = make(
	editorCam,
	'box',
	{ x: 150, y: 350, w: 70, h: 560 },
	['move', 'type', 'image', 'pen-tool', 'wand-sparkles', 'layers']
		.map((name) => icon(name, 32))
		.join('')
);
rail.style.cssText +=
	';display:flex;flex-direction:column;align-items:center;gap:40px;color:var(--muted)';
const canvas = { x: 286, y: 350, scale: 0.98 };
const editorArt = artwork(editorCam, { x: canvas.x, y: canvas.y }, canvas.scale);
editorArt.art.style.borderRadius = '10px';
const layersPanel = make(editorCam, 'box', { x: 1490, y: 350, w: 290, h: 520 });
make(
	layersPanel,
	'',
	{},
	'<div style="font-size:20px;color:var(--muted);padding:0 16px 14px">Layers</div>'
);
const layerRows = [
	['type', 'Headline'],
	['square', 'Device'],
	['type', 'Tagline'],
	['image', 'Background']
].map(([name, label]) =>
	make(layersPanel, 'layer-row', {}, `${icon(name, 22)}<span>${label}</span>`)
);
const swatches = make(editorCam, 'box row', { x: 286, y: 980, w: 1176, h: 40 });
swatches.style.cssText += ';justify-content:center;gap:14px';
const swatchNodes = ['#f4fbff', '#ffd27a', '#7ef0a8', '#b8f3ff', '#ff9f87'].map((colour) => {
	const node = make(swatches, 'swatch');
	node.style.background = colour;
	return node;
});
const selection = make(
	editorArt.art,
	'selection',
	{ x: 70, y: 170, w: 600, h: 290 },
	'<i style="left:-8px;top:-8px"></i><i style="right:-8px;top:-8px"></i><i style="left:-8px;bottom:-8px"></i><i style="right:-8px;bottom:-8px"></i>'
);
const layerAt = [0, 1, 2, 3].map((i) => T.editor + 0.45 + i * 0.12);
layerAt.forEach((at) => cue(at, 'tick'));
// Feedback for the recolour and the final Add to post press.
const swatchRipple = make(editorCam, 'box', { x: 800, y: 980, w: 40, h: 40 });
swatchRipple.style.cssText += ';border:3px solid var(--mark);border-radius:12px;opacity:0';
const addedChip = make(
	editorCam,
	'box chip-note',
	{ x: 1408, y: 336 },
	`<span style="color:var(--green)">${icon('circle-check', 20)}</span>Added to the post`
);
cue(clicks[2] + 0.08, 'ding');

// The video: the same image becomes the first shot on a timeline.
const videoLayer = layer();
const videoTitle = title(videoLayer, 'Cut the video.', ['video.']);
const videoCam = cam(videoLayer);
const monitor = { x: 528, y: 200, scale: 0.72 };
make(videoCam, 'box card', {
	x: monitor.x - 14,
	y: monitor.y - 14,
	w: 1200 * monitor.scale + 28,
	h: 628 * monitor.scale + 28
});
const monitorArt = artwork(videoCam, { x: monitor.x, y: monitor.y }, monitor.scale);
monitorArt.art.style.borderRadius = '10px';
monitorArt.headline.style.color = '#ffd27a';
const captionLine = make(videoCam, 'box', {
	x: monitor.x,
	y: monitor.y + 628 * monitor.scale - 72,
	w: 1200 * monitor.scale
});
captionLine.style.textAlign = 'center';
const captionWords = ['Offline', 'sync', 'is', 'here.'].map((word) =>
	make(captionLine, 'caption-word', {}, word)
);
const trackRows = [
	['film', 700],
	['captions', 776],
	['music', 852]
].map(([name, y]) => ({
	head: make(videoCam, 'box row muted', { x: 170, y: y + 14, w: 60, h: 34 }, icon(name, 30)),
	track: make(videoCam, 'box track', { x: 250, y, w: 1530 })
}));
const videoClips = [
	[0, 480, 'Intro', '#d7eef3'],
	[488, 520, 'Offline sync', '#e7e1f7'],
	[1016, 500, 'Dark mode', '#f6e3d6']
].map(([x, w, label, colour], i) => {
	const clip = make(trackRows[0].track, 'clip', { x, w }, `${icon('film', 20)}${label}`);
	clip.style.cssText += `;background:${colour};border:1px solid rgb(43 38 33 / 10%)`;
	return { clip, at: T.video + 0.25 + i * 0.14 };
});
videoClips.forEach(({ at }) => cue(at, 'tick'));
const captionClips = captionWords.map((word, i) => {
	const clip = make(trackRows[1].track, 'clip', { x: 120 + i * 200, w: 184 }, word.textContent);
	clip.style.cssText += ';background:rgb(180 83 9 / 14%);color:var(--mark)';
	return { clip, at: T.video + 0.95 + i * 0.22 };
});
captionClips.forEach(({ at }) => cue(at, 'pop'));
const wave = make(trackRows[2].track, 'clip', { x: 0, w: 1530 });
wave.style.cssText += ';background:rgb(61 139 253 / 10%);gap:3px';
wave.innerHTML = Array.from({ length: 150 }, (_, i) => {
	const h = 8 + Math.abs(Math.sin(i * 0.7) * Math.cos(i * 0.23)) * 32;
	return `<i style="display:block;width:7px;height:${h.toFixed(0)}px;border-radius:2px;background:#3d8bfd;opacity:.75;flex:none"></i>`;
}).join('');
const playhead = make(videoCam, 'box', { x: 250, y: 686, w: 3, h: 240 });
playhead.style.background = 'var(--mark)';
cue(T.video, 'whoosh');

function editorScene(t) {
	if (!show(editorLayer, between(t, T.editor - 0.02, T.video + 0.3))) return;
	editorTitle(t, T.editor + 0.25, T.video - 0.45);
	const leave = prog(t, T.video - 0.15, T.video + 0.2, ease.expoIn);
	anim(editorLayer, { x: -leave * 2100, o: t >= T.editor ? 1 : 0 });
	anim(editorCam, dolly(t, T.editor, T.video, 0.035));
	const chrome = prog(t, T.editor + 0.2, T.editor + 0.6, ease.expoOut);
	for (const node of [editorPanel, editorBar, rail, layersPanel, swatches])
		anim(node, { o: chrome });
	layerRows.forEach((row, i) => {
		anim(row, {
			x: (1 - prog(t, layerAt[i], layerAt[i] + 0.35, ease.expoOut)) * 24,
			o: prog(t, layerAt[i], layerAt[i] + 0.15)
		});
		row.style.background = i === 0 && t >= clicks[0] ? 'var(--selection)' : 'transparent';
	});
	// Select the headline, drag its corner out, recolour it, then add the art to the post.
	selection.style.display = t >= clicks[0] ? 'block' : 'none';
	const grow = prog(t, T.editor + 1.7, T.editor + 2.2, ease.inOut);
	anim(editorArt.headline, { s: 1 + grow * 0.12 });
	selection.style.width = `${600 * (1 + grow * 0.12)}px`;
	selection.style.height = `${290 * (1 + grow * 0.12)}px`;
	const recolour = t >= clicks[1] + 0.05;
	editorArt.headline.style.color = recolour ? '#ffd27a' : '';
	swatchNodes[1].style.borderColor = recolour ? 'var(--ink)' : '';
	const ripple = prog(t, clicks[1] + 0.02, clicks[1] + 0.5);
	anim(swatchRipple, { s: 1 + ripple * 1.6, o: ripple > 0 ? 0.9 * (1 - ripple) : 0 });
	anim(addPostButton, { s: between(t, clicks[2] - 0.03, clicks[2] + 0.12) ? 0.94 : 1 });
	const added = prog(t, clicks[2] + 0.05, clicks[2] + 0.45, ease.back);
	anim(addedChip, { y: (1 - added) * 14, o: added });
}

function videoScene(t) {
	if (!show(videoLayer, between(t, T.video - 0.2, T.schedule + 0.3))) return;
	videoTitle(t, T.video + 0.2, T.schedule - 0.45);
	const enter = prog(t, T.video - 0.15, T.video + 0.35, ease.expoOut);
	const leave = prog(t, T.schedule - 0.2, T.schedule + 0.15, ease.expoIn);
	anim(videoLayer, { x: (1 - enter) * 2100, s: 1 + leave * 1.2, o: 1 - leave, blur: leave * 6 });
	anim(videoCam, dolly(t, T.video, T.schedule, 0.05));
	trackRows.forEach(({ head, track }, i) => {
		const rise = prog(t, T.video + 0.05 + i * 0.07, T.video + 0.45 + i * 0.07, ease.expoOut);
		anim(track, { y: (1 - rise) * 30, o: rise });
		anim(head, { o: rise });
	});
	videoClips.forEach(({ clip, at }) => {
		anim(clip, { x: (1 - prog(t, at, at + 0.35, ease.expoOut)) * 260, o: prog(t, at, at + 0.08) });
	});
	captionClips.forEach(({ clip, at }, i) => {
		anim(clip, { s: prog(t, at, at + 0.3, ease.back), o: prog(t, at, at + 0.06) });
		anim(captionWords[i], {
			y: (1 - prog(t, at, at + 0.3, ease.expoOut)) * 14,
			o: prog(t, at, at + 0.1)
		});
	});
	wave.style.clipPath = `inset(0 ${(1 - prog(t, T.video + 0.3, T.video + 1.0, ease.inOut)) * 100}% 0 0)`;
	const head = prog(t, T.video + 0.4, T.schedule - 0.1, ease.linear);
	anim(playhead, { x: head * 1400 });
	anim(monitorArt.art, { s: monitor.scale * (1 + head * 0.05) });
	monitorArt.art.style.transformOrigin = '0 0';
}

// --- 7. Schedule once, then every outcome --------------------------------------------------
const scheduleLayer = layer();
const scheduleTitle = title(scheduleLayer, 'Schedule it once.', ['once.']);
const outcomeTitle = title(scheduleLayer, 'Every outcome, visible.', ['visible.']);
const calendarCam = make(scheduleLayer, 'world');
calendarCam.style.transformOrigin = '0 0';
const calendar = { x: 160, y: 225, w: 1600, header: 136, row: 130, col: 1600 / 7 };
const calendarBoard = make(calendarCam, 'box calendar-board', {
	x: calendar.x,
	y: calendar.y,
	w: calendar.w,
	h: 786
});
make(
	calendarBoard,
	'calendar-toolbar row',
	{},
	`<b>Posts</b><span class="calendar-view">Calendar <span class="muted">List</span></span><span class="month-nav">${icon('chevron-left', 22)} October 2026 ${icon('chevron-right', 22)}</span><span class="button ordinary">Today</span><span class="button focal">${icon('plus', 20)} New post</span>`
);
const week = make(calendarBoard, 'calendar-week');
for (const day of ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']) make(week, '', {}, day);
const monthGrid = make(calendarBoard, 'calendar-grid');
Array.from({ length: 35 }, (_, i) => {
	const day = i < 3 ? 28 + i : i > 33 ? i - 33 : i - 2;
	const node = make(
		monthGrid,
		`calendar-day${i < 3 || i > 33 ? ' outside' : ''}`,
		{},
		`<span class="date${day === 15 && i === 17 ? ' today' : ''}">${day}</span>`
	);
	return { node, day, i };
});
const slot = (index) => ({
	x: calendar.x + (index % 7) * calendar.col + 10,
	y: calendar.y + calendar.header + Math.floor(index / 7) * calendar.row + 45,
	w: calendar.col - 20,
	h: 77
});
const ourSlot = slot(17);
const retrySlot = slot(18);
const centre = (frame) => ({ x: frame.x + frame.w / 2, y: frame.y + frame.h / 2 });
function calendarChip(frame, label, time, mark = 'Bluesky') {
	const chip = make(calendarCam, 'box cal-chip', frame);
	chip.innerHTML = `<div class="cal-text">${label}</div><div class="meta"><span class="status"></span><span class="row" style="gap:6px">${time}<img src="${marks(mark)}" alt="" width="16" height="16"></span></div>`;
	return { chip, status: chip.querySelector('.status') };
}
const backgroundPosts = [
	[4, 'What we shipped this week', '10 AM', 'Threads'],
	[7, 'Building in the open', '2 PM', 'Mastodon'],
	[9, 'A small update. A big difference.', '9 AM', 'X'],
	[12, 'The idea behind Lumen', '11 AM', 'Linkedin'],
	[14, 'Offline, wherever you work', '10 AM', 'Bluesky'],
	[23, 'A closer look at sync', '3 PM', 'Threads'],
	[25, 'Your questions, answered', '11 AM', 'Linkedin'],
	[28, 'What comes next', '2 PM', 'Mastodon']
].map(([index, label, time, mark]) => {
	const post = calendarChip(slot(index), label, time, mark);
	post.status.innerHTML = `${icon('check', 14)}${index < 17 ? 'Published' : 'Scheduled'}`;
	post.chip.classList.add(index < 17 ? 'past' : 'planned');
	return post;
});
const ourChip = calendarChip(ourSlot, `${script.product} 2.0 is live`, '5 PM', 'X');
const retryChip = calendarChip(retrySlot, 'The story behind 2.0', '5 PM', 'Linkedin');
// The close-up: a time, the Schedule button, one click.
const closeup = make(scheduleLayer, 'box row', { x: 560, y: 480, w: 800, h: 120 });
closeup.style.cssText += ';gap:18px;justify-content:center';
make(closeup, 'button ordinary', {}, `${icon('clock', 22)} Today, 5:00 PM`);
const scheduleButton = make(closeup, 'button focal', {}, `${icon('calendar', 22)} Schedule`);
// Confetti when the post is scheduled, like the composer celebration in the app.
const confettiAt = clicks[3] + 0.04;
cue(confettiAt, 'shimmer');
const confetti = Array.from({ length: 40 }, (_, i) => {
	const node = make(scheduleLayer, 'box confetti');
	const size = 14 + ((i * 7) % 4) * 6;
	node.style.cssText += `;width:${size}px;height:${Math.round(size * 0.62)}px;background:${
		['#cf793e', '#a48bc4', '#4b966b', '#3d8bfd', '#e9a066'][i % 5]
	};opacity:0`;
	return {
		node,
		angle: (i / 40) * Math.PI * 2 + (i % 3) * 0.19,
		speed: 300 + ((i * 53) % 9) * 30,
		flip: 200 + ((i * 29) % 7) * 90
	};
});
// The Schedule button sits large in the close-up; the burst starts at its centre.
const confettiOrigin = { x: 1469, y: 540 };
const sample = make(stage, 'label', {}, 'Sample data');
const states = (at, fails) => [
	[at, 'Publishing', 'var(--amber)'],
	...(fails
		? [
				[at + 0.55, 'Failed', 'var(--red)'],
				[at + 1.1, 'Retrying', 'var(--amber)']
			]
		: []),
	[at + (fails ? 1.65 : 0.55), 'Published', 'var(--green)']
];
const ourStates = states(T.publish, false);
const retryStates = states(T.publish + 1.1, true);
cue(T.schedule + 1.05, 'land');
backgroundPosts.forEach((_, i) => cue(T.schedule + 1.25 + i * 0.055, 'tick'));
cue(T.publish, 'tick');
cue(ourStates[1][0], 'ding');
cue(retryStates[1][0], 'error');
cue(retryStates[2][0], 'tick');
cue(retryStates[3][0], 'ding');
cue(T.results - 0.1, 'whoosh');

function chipState(chip, t, sequence) {
	const current = [...sequence].reverse().find(([at]) => t >= at);
	const [label, colour] = current ? [current[1], current[2]] : ['Scheduled', 'var(--muted)'];
	const published = label === 'Published';
	const failed = label === 'Failed';
	chip.status.innerHTML = `<i></i>${label}`;
	chip.status.style.color = colour;
	chip.chip.style.background = published
		? 'var(--green-soft)'
		: failed
			? '#fbe9e7'
			: 'var(--peach)';
	chip.chip.style.border = `1px solid ${published ? '#bcd8c2' : failed ? '#efb8b2' : 'var(--peach-line)'}`;
	chip.chip.style.color = published ? 'var(--green)' : 'var(--ink)';
	return current ? Math.exp(-(t - current[0]) * 9) : 0;
}

function scheduleScene(t) {
	if (!show(scheduleLayer, between(t, T.schedule - 0.2, T.results + 0.3))) return;
	scheduleTitle(t, T.schedule + 0.2, T.publish - 0.45);
	outcomeTitle(t, T.publish + 0.1, T.results - 0.45);
	const enter = prog(t, T.schedule - 0.15, T.schedule + 0.25, ease.expoOut);
	const pull = prog(t, T.schedule + 0.75, T.schedule + 1.55, ease.expoInOut);
	const leave = prog(t, T.results - 0.3, T.results + 0.15, ease.expoIn);
	anim(closeup, {
		s: lerp(3.2, 0.3, pull),
		o: enter * (1 - prog(t, T.schedule + 0.9, T.schedule + 1.2))
	});
	anim(scheduleButton, { s: between(t, clicks[3] - 0.03, clicks[3] + 0.12) ? 0.94 : 1 });
	// Confetti: a radial burst with drag and gravity, gone before the calendar settles.
	const burst = clamp((t - confettiAt) / 1.6);
	if (burst > 0 && burst < 1) {
		for (const { node, angle, speed, flip } of confetti) {
			const drag = 1 - 0.4 * burst;
			anim(node, {
				x: confettiOrigin.x + Math.cos(angle) * speed * burst * drag,
				y: confettiOrigin.y + Math.sin(angle) * speed * burst * drag + 1500 * burst * burst,
				r: flip * burst,
				s: 1 - burst * 0.3,
				o: 1 - ease.in(clamp((burst - 0.55) / 0.45))
			});
		}
	} else for (const { node } of confetti) anim(node, { o: 0 });
	// Camera: from the landing chip, out to the month, then in on the two outcomes.
	const outcome = prog(t, T.publish - 0.5, T.publish + 0.2, ease.expoInOut);
	const ours = centre(ourSlot);
	const both = { x: (ours.x + centre(retrySlot).x) / 2, y: ours.y };
	const focus = { x: lerp(ours.x, both.x, outcome), y: lerp(ours.y, both.y, outcome) };
	const drift = prog(t, T.schedule + 1.55, T.publish - 0.5, ease.linear) * 0.06;
	const zoom = lerp(2.4, 1 + drift, pull) * lerp(1, 1.9, outcome);
	const screen = { x: lerp(focus.x, 960, outcome), y: lerp(focus.y, 600, outcome) };
	anim(calendarCam, {
		x: screen.x - focus.x * zoom,
		y: screen.y - focus.y * zoom - leave * 1300,
		s: zoom,
		o: prog(t, T.schedule + 0.7, T.schedule + 1.0),
		blur: leave * 6
	});
	const land = prog(t, T.schedule + 0.9, T.schedule + 1.35, ease.back);
	const bumpOur = chipState(ourChip, t, ourStates);
	anim(ourChip.chip, {
		s: land * (1 + bumpOur * 0.1),
		y: (1 - land) * -60,
		o: prog(t, T.schedule + 0.9, T.schedule + 1.0)
	});
	backgroundPosts.forEach(({ chip }, i) => {
		const at = T.schedule + 1.25 + i * 0.055;
		const p = prog(t, at, at + 0.35);
		anim(chip, { y: (1 - p) * 12, o: p });
	});
	const bumpRetry = chipState(retryChip, t, retryStates);
	anim(retryChip.chip, { s: 1 + bumpRetry * 0.1, o: prog(t, T.publish + 1.0, T.publish + 1.1) });
}

// --- 8. Results and replies ------------------------------------------------------------------
const resultsLayer = layer();
const resultsTitle = title(resultsLayer, 'See what lands.', ['lands.']);
const resultsCam = make(resultsLayer, 'world');
resultsCam.style.transformOrigin = '0 0';
const stats = [
	['eye', 'Views', 13290, (v) => `${(v / 1000).toFixed(1)}K`],
	['heart', 'Engagement', 1284, (v) => Math.round(v).toLocaleString('en-US')],
	['users', 'New followers', 312, (v) => `+${Math.round(v)}`]
].map(([name, label, value, format], i) => {
	const card = make(resultsCam, 'box card stat', { x: 140 + i * 555, y: 230, w: 530, h: 160 });
	make(card, 'k', {}, `${icon(name, 24)}${label}`);
	return { card, number: make(card, 'v'), value, format };
});
const chart = { x: 140, y: 430, w: 1640 };
const chartCard = make(resultsCam, 'box card', { x: chart.x, y: chart.y, w: chart.w, h: 560 });
chartCard.style.overflow = 'hidden';
make(
	chartCard,
	'chart-toolbar row',
	{},
	`<div><b>Views over time</b><p class="muted">Across your connected accounts</p></div><span class="button ordinary">Last 14 days ${icon('chevron-down', 18)}</span>`
);
const chartValues = [180, 220, 190, 310, 270, 460, 390, 520, 470, 680, 950, 3400, 2420, 2810];
const chartPlot = { x: 100, y: 140, w: 1460, h: 320 };
const chartPoints = chartValues.map((value, i) => [
	chartPlot.x + (i * chartPlot.w) / 13,
	chartPlot.y + chartPlot.h * (1 - value / 4000)
]);
make(
	chartCard,
	'box',
	{ x: 0, y: 0, w: 1640, h: 560 },
	`<svg width="1640" height="560">${[0, 1000, 2000, 3000, 4000]
		.map((value) => {
			const y = chartPlot.y + chartPlot.h * (1 - value / 4000);
			return `<line x1="100" y1="${y}" x2="1560" y2="${y}" stroke="var(--line)"/><text x="76" y="${y + 6}" text-anchor="end" fill="var(--muted)" font-size="18">${value ? value / 1000 + 'K' : '0'}</text>`;
		})
		.join(
			''
		)}${[0, 3, 6, 9, 13].map((i) => `<text x="${chartPoints[i][0]}" y="505" text-anchor="middle" fill="var(--muted)" font-size="18">Oct ${i + 2}</text>`).join('')}</svg>`
);
// Dithered stacked columns mirror the app chart, with an authored sample-data series.
const chartSeries = make(chartCard, 'box chart-series', { x: 0, y: 0, w: 1640, h: 560 });
const chartBars = chartValues.map((value, i) => {
	const height = (value / 4000) * chartPlot.h;
	const column = make(chartSeries, 'box chart-column', {
		x: chartPoints[i][0] - 24,
		y: chartPlot.y + chartPlot.h - height,
		w: 48,
		h: height
	});
	column.style.transformOrigin = '50% 100%';
	for (const [ratio, color] of [
		[0.28, '#a48bc4'],
		[0.22, '#4b966b'],
		[0.5, '#cf793e']
	]) {
		const segment = make(column, '');
		segment.style.cssText = `height:${ratio * 100}%;background-color:${color};background-image:${ditherUrl('rgb(255 255 255 / 0.3)')};background-size:8px 100%;border:1px solid rgb(43 38 33 / 12%)`;
	}
	return column;
});
const spike = { x: chart.x + chartPoints[11][0], y: chart.y + chartPoints[11][1] };
const launchDay = make(
	resultsCam,
	'box chart-tooltip',
	{ x: spike.x - 280, y: spike.y - 20, w: 232 },
	`<span class="row" style="gap:8px">${icon('sparkles', 20)}Launch day</span><b>3,400 views</b><span class="muted">October 13 · Sample data</span>`
);
cue(T.results + 0.2, 'tick');
cue(T.results + 0.65, 'tick');
cue(T.results + 1.15, 'tick');
cue(T.results + 1.55, 'pop');
cue(T.results + 1.65, 'ding');

const inboxLayer = layer();
const inboxTitle = title(inboxLayer, 'Reply in one place.', ['one', 'place.']);
const inboxCam = cam(inboxLayer);
make(inboxCam, 'box card', { x: 410, y: 240, w: 1100, h: 780 });
const messages = script.comments.map(([mark, name, text], i) => {
	const row = make(inboxCam, 'box message', { x: 410, y: 262 + i * 136, w: 1100 });
	image(row, marks(mark), 'mark');
	make(row, '', {}, `<div class="who"><b>${name}</b>just now</div><div class="text">${text}</div>`);
	return { row, at: T.inbox + 0.1 + i * 0.12 };
});
for (const { at } of messages) cue(at, 'tick');
const replyBar = make(inboxCam, 'box row', { x: 440, y: 868, w: 1040, h: 96 });
replyBar.style.cssText +=
	';gap:16px;padding:0 16px 0 28px;border-radius:18px;background:var(--sunken);border:1px solid var(--line);font-size:28px';
const replyText = make(replyBar, '');
replyText.style.flex = '1';
make(replyBar, 'button focal', {}, `${icon('send', 20)} Reply`);
typingCues(T.inbox + 0.55, T.inbox + 1.25, script.reply, 0.12);
cue(clicks[3] + 0.05, 'ding');

function resultsScene(t) {
	if (!show(resultsLayer, between(t, T.results - 0.2, T.inbox + 0.3))) return;
	resultsTitle(t, T.results + 0.15, T.inbox - 0.4);
	const enter = prog(t, T.results - 0.1, T.results + 0.4, ease.expoOut);
	const leave = prog(t, T.inbox - 0.2, T.inbox + 0.15, ease.expoIn);
	// After the reveal, the camera pushes in on the launch-day spike.
	const push = prog(t, T.results + 1.4, T.inbox - 0.1, ease.inOut);
	const zoom = lerp(1, 1.55, push);
	anim(resultsCam, {
		x: lerp(0, 1100 - spike.x * zoom, push),
		y: lerp(0, 700 - spike.y * zoom, push) + (1 - enter) * 900 - leave * 1100,
		s: zoom,
		blur: leave * 6
	});
	stats.forEach(({ card, number, value, format }, i) => {
		number.textContent = format(
			value * prog(t, T.results + 0.3 + i * 0.1, T.results + 1.5, ease.expoOut)
		);
		anim(card, {
			y: (1 - prog(t, T.results + i * 0.08, T.results + 0.5 + i * 0.08, ease.expoOut)) * 40,
			o: 1 - prog(t, T.results + 1.4, T.results + 1.9)
		});
	});
	chartBars.forEach((column, i) => {
		const rise = prog(t, T.results + 0.3 + i * 0.055, T.results + 0.75 + i * 0.055, ease.expoOut);
		anim(column, { sx: 1, sy: rise, o: rise });
	});
	const tag = prog(t, T.results + 1.55, T.results + 1.95, ease.back);
	anim(launchDay, { s: lerp(0.94, 1, tag), y: (1 - tag) * 12, o: tag });
}

function inboxScene(t) {
	if (!show(inboxLayer, between(t, T.inbox - 0.2, T.featFast + 0.3))) return;
	inboxTitle(t, T.inbox + 0.1, T.featFast - 0.35);
	const enter = prog(t, T.inbox - 0.1, T.inbox + 0.35, ease.expoOut);
	const leave = prog(t, T.featFast - 0.15, T.featFast + 0.2, ease.expoIn);
	anim(inboxLayer, { y: (1 - enter) * 1000, s: 1 - leave * 0.15, o: 1 - leave, blur: leave * 8 });
	anim(inboxCam, dolly(t, T.inbox, T.featFast, 0.04));
	for (const { row, at } of messages) {
		anim(row, { x: (1 - prog(t, at, at + 0.4, ease.expoOut)) * 140, o: prog(t, at, at + 0.1) });
	}
	if (t >= clicks[4] + 0.05) {
		replyText.innerHTML = `<span class="row" style="gap:10px;color:var(--green)">${icon('circle-check', 26)} Replied on Threads</span>`;
	} else replyText.textContent = typed(t, T.inbox + 0.55, T.inbox + 1.25, script.reply);
}

// --- 9. The headliners pop fast, then everything scrolls by ----------------------------------
const popLayer = layer();
const popChips = [
	['workflow', 'Workflows'],
	['images', 'Media library'],
	['lightbulb', 'AI ideas'],
	['mic', 'Recorder'],
	['repeat', 'Auto repost'],
	['users-round', 'Teams']
].map(([name, label], i) => {
	// Each chip pops on its own full-width slot so the label stays centred.
	const slotNode = make(popLayer, 'box row', { x: 0, y: 462, w: 1920, h: 150 });
	slotNode.style.justifyContent = 'center';
	const chip = make(slotNode, 'feature', {}, `${icon(name)}${label}`);
	chip.style.fontSize = '40px';
	const at = T.featFast + 0.3 + i * 0.24;
	cue(at, 'pop');
	return { slotNode, at, tilt: (((i * 37) % 9) - 4) * 0.8, dx: ((i * 53) % 5) - 2 };
});
cue(T.features, 'whoosh');

function popScene(t) {
	if (!show(popLayer, between(t, T.featFast - 0.05, T.features + 0.25))) return;
	popChips.forEach(({ slotNode, at, tilt, dx }, i) => {
		const pop = prog(t, at, at + 0.32, ease.spring);
		const outAt = i < popChips.length - 1 ? popChips[i + 1].at : T.features - 0.05;
		const gone = prog(t, outAt, outAt + 0.24, ease.in);
		anim(slotNode, {
			x: dx * 26,
			y: (1 - pop) * 44 - gone * 30,
			r: tilt * (1 - pop) + gone * tilt * 4,
			s: pop * (1 - gone * 0.35),
			o: pop * (1 - gone),
			blur: gone * 14
		});
	});
}

const featureLayer = layer();
const featureTitle = title(featureLayer, 'Everything your content needs.', ['Everything']);
const featureCam = make(featureLayer, 'world');
featureCam.style.transformOrigin = '960px 620px';
const featureRows = [
	[
		['workflow', 'Workflows'],
		['images', 'Media library'],
		['smile-plus', 'Memes'],
		['mic', 'Recorder'],
		['repeat', 'Auto repost'],
		['lightbulb', 'AI ideas'],
		['users-round', 'Teams']
	],
	[
		['terminal', 'CLI'],
		['code', 'API'],
		['bot', 'MCP'],
		['smartphone', 'iOS and Android'],
		['server', 'Self-hosting'],
		['shield-check', 'Passkeys'],
		['calendar-clock', 'Queues']
	]
].map((items, r) => {
	const row = make(featureCam, 'box row', { x: 0, y: 330 + r * 128 });
	row.style.gap = '24px';
	// Two copies of each row make the marquee loop seamlessly.
	for (let copy = 0; copy < 2; copy++) {
		for (const [name, label] of items) make(row, 'feature', {}, `${icon(name)}${label}`);
	}
	return { row, direction: r % 2 ? 1 : -1 };
});
const networkRow = make(featureCam, 'box row', { x: 0, y: 600 });
networkRow.style.gap = '24px';
for (let copy = 0; copy < 2; copy++) {
	for (const name of networks16) {
		const tile = make(networkRow, 'tile');
		tile.style.position = 'relative';
		image(tile, marks(name));
	}
}
const finaleMark = convergeMark(featureLayer, 300);
cue(T.end - 0.05, 'riser');

function featureScene(t) {
	if (!show(featureLayer, between(t, T.features - 0.1, T.end + 0.05))) return;
	featureTitle(t, T.features + 0.15, T.end - 1.4);
	const gather = prog(t, T.end - 1.25, T.end - 0.15, ease.expoIn);
	anim(featureCam, { rx: 16, r: -5, s: 1.05 + gather * 0.2 });
	// A shorter window scrolls faster: the marquee reads as energy, not a list.
	const scroll = (t - T.features) * 520 + gather * gather * 2400;
	featureRows.forEach(({ row, direction }, i) => {
		const width = row.scrollWidth / 2;
		const offset = (((direction * scroll + i * 160) % width) + width) % width;
		anim(row, {
			x: -offset,
			y: lerp(0, 620 - 330 - i * 128 - 46, gather),
			sx: lerp(1, 0.25, gather),
			sy: lerp(1, 0.25, gather),
			o: prog(t, T.features, T.features + 0.3) * (1 - gather)
		});
	});
	const tileWidth = networkRow.scrollWidth / 2;
	const tileOffset = (((scroll * 0.8) % tileWidth) + tileWidth) % tileWidth;
	anim(networkRow, {
		x: -tileOffset,
		y: lerp(0, 620 - 600 - 46, gather),
		sx: lerp(1, 0.25, gather),
		sy: lerp(1, 0.25, gather),
		o: prog(t, T.features + 0.1, T.features + 0.4) * (1 - gather)
	});
	drawMark(finaleMark, t, T.end, { cx: 960, cy: 540, spread: 900 });
	anim(finaleMark.holder, { o: t < T.end - 0.55 ? 0 : 1, x: 960 - 150, y: 540 - 150, r: -90 });
	for (const { spark } of finaleMark.sparks) anim(spark, { o: 0 });
}

// --- 10. Logo -------------------------------------------------------------------------------------
const endLayer = layer();
const endMark = convergeMark(endLayer, 300);
const endWord = wordmark(endLayer, 'OpenPost');
const endTagline = make(endLayer, 'box closing', { y: 570 }, 'Your socials, on steroids.');
endTagline.style.cssText += ';font-size:50px;font-weight:600;letter-spacing:-0.025em';
const endUrl = make(
	endLayer,
	'box closing',
	{ y: 664 },
	'<b style="color:var(--mark)">openpo.st</b> <span class="muted">· Open source. Hosted or self-hosted.</span>'
);
endUrl.style.fontSize = '32px';
for (let i = 0; i < 4; i++) cue(T.end - 0.32 + i * 0.08, 'pop');
cue(T.end, 'land');
cue(T.end + 0.75, 'whoosh');
cue(T.end + 1.4, 'pop');
cue(T.end + 2.0, 'tick');
cue(T.end, 'impact', { gain_db: 2 });
cue(T.end + 0.02, 'shimmer');

function endScene(t) {
	if (!show(endLayer, t >= T.end - 0.05)) return;
	const slide = prog(t, T.end + 0.5, T.end + 1.15, ease.expoInOut);
	const total = 190 + 40 + endWord.node.offsetWidth;
	drawMark(endMark, t, T.end, {
		cx: lerp(960, 960 - total / 2 + 95, slide),
		cy: lerp(540, 450, slide),
		scale: lerp(1, 190 / 300, slide)
	});
	anim(endWord.node, { x: 960 - total / 2 + 230, y: 450 - 82, o: slide > 0.02 ? 1 : 0 });
	endWord.draw(t, T.end + 0.75);
	const tag = prog(t, T.end + 1.4, T.end + 2.0, ease.expoOut);
	anim(endTagline, { y: (1 - tag) * 24, o: tag, blur: (1 - tag) * 8 });
	const link = prog(t, T.end + 2.0, T.end + 2.6, ease.expoOut);
	anim(endUrl, { y: (1 - link) * 20, o: link });
}

// --- Seek ---------------------------------------------------------------------------------------
await document.fonts.load('600 74px Geist');
await document.fonts.load('400 30px Geist');
await document.fonts.load('600 148px Manrope');
await document.fonts.load('800 136px Manrope');

export async function seek(t) {
	drawGlow(t);
	sample.style.opacity = between(t, T.schedule + 1.3, T.featFast) ? '1' : '0';
	hookScene(t);
	revealScene(t);
	flowScene(t);
	composerScene(t);
	cardsScene(t);
	editorScene(t);
	videoScene(t);
	scheduleScene(t);
	resultsScene(t);
	inboxScene(t);
	popScene(t);
	featureScene(t);
	endScene(t);
	drawCursor(t);
	while (pending.size) await Promise.all(pending);
}

cues.sort((a, b) => a.t - b.t);
window.film = { seek, cues, FPS, BPM, BEAT, DURATION, sections: T };
