// OpenPost launch film. Every frame is a pure function of time: render.mjs calls window.film.seek(t).
import { createEngine } from './engine.js';
import { DURATION, BPM, FPS, T, BAR, BEAT, cues, score } from './timeline.js';
import { createScene, noise } from './kit.js';
import { createSurfaces } from './surfaces.js';
import { opening, openingFx } from './opening.js';
import { product } from './product.js';

const canvas = document.getElementById('stage');
const engine = createEngine(canvas);
const surfaces = createSurfaces(engine, canvas);
await Promise.all([
	document.fonts.load('600 74px Geist'),
	document.fonts.load('400 30px Geist'),
	document.fonts.load('600 148px Manrope'),
	document.fonts.load('800 100px Inter'),
	document.fonts.load('500 31px Inter'),
	document.fonts.load('400 44px Inter'),
	document.fonts.load('500 36px "Shantell Sans"')
]);
await document.fonts.ready;
await Promise.all(
	[...document.images].map((image) =>
		image.decode().catch(() => {
			throw new Error(`Could not load ${image.src}`);
		})
	)
);
opening.measure(surfaces);
product.measure(surfaces);

// Static surfaces cross once; live ones repaint when their DOM changes.
await engine.uploadSurfaces();
for (const s of Object.values(surfaces)) if (!s.live) s.element.style.display = 'none';

const impacts = [...opening.shakes(), ...product.shakes()].sort((a, b) => a.t - b.t);
function applyShake(camera, t) {
	let power = 0;
	for (const hit of impacts)
		if (t >= hit.t) power += hit.power * Math.exp(-(t - hit.t) * hit.decay);
	if (power < 0.001) return;
	const f = 41;
	const dx = noise(t * f, 1) * 26 * power;
	const dy = noise(t * f * 1.13, 2) * 20 * power;
	camera.eye = [
		camera.eye[0] + dx,
		camera.eye[1] + dy,
		camera.eye[2] + noise(t * f * 0.7, 3) * 18 * power
	];
	camera.at = [camera.at[0] + dx * 1.3, camera.at[1] + dy * 1.3, camera.at[2]];
	camera.roll = (camera.roll ?? 0) + noise(t * f * 0.9, 4) * 0.012 * power;
}

function build(t) {
	const scene = createScene();
	if (t >= T.workflow - 0.02) product.draw(scene, t, surfaces);
	else opening.draw(scene, t, surfaces);
	applyShake(scene.camera, t);
	scene.after?.();
	return scene;
}

const defaults = () => ({
	chromatic: 0.0012,
	lens: 0.012,
	vignette: 0.05,
	grain: 0.0016,
	bloom: 0.42,
	mist: 0,
	dither: 0,
	droplets: 0,
	dropletTime: 0,
	underwater: 0,
	glitch: 0,
	exposure: 1,
	flash: [1, 1, 1, 0],
	wipe: [1, 1, 1, 0],
	pulse: [1, 0, 0, 0],
	bloomThreshold: 1.05,
	caption: 0,
	captionBox: [0, 0, 1, 1],
	captionTexture: surfaces.team.texture
});

let frame = 0;
export async function seek(t, { samples = 24, shutter = 0.5 } = {}) {
	opening.dom(t, surfaces);
	product.dom(t, surfaces);
	const active = new Set(
		[...opening.surfaces(t), ...product.surfaces(t)].map((name) => surfaces[name])
	);
	let woken = false;
	for (const s of Object.values(surfaces)) {
		if (!s.live) continue;
		const value = active.has(s) ? 'block' : 'none';
		if (s.element.style.display === value) continue;
		s.element.style.display = value;
		if (value === 'block') {
			s.dirty = true;
			woken = true;
		}
	}
	if (woken) await engine.settle();
	await engine.uploadSurfaces(active);
	engine.render(
		build,
		{ ...defaults(), ...(t < T.workflow ? openingFx(t) : product.fx(t)) },
		{ t, fps: FPS, samples, shutter, frame: frame++ }
	);
}

cues.sort((a, b) => a.t - b.t);
window.film = {
	seek,
	cues,
	FPS,
	BPM,
	BEAT,
	BAR,
	DURATION,
	sections: T,
	score
};
