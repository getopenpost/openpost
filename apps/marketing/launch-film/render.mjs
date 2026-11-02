// Renders the launch film: bun apps/marketing/launch-film/render.mjs [--stills 1,8,14] [--from s --to s]
// film.js draws each frame on the GPU, averaging --samples renders across the shutter and lens.
// A full render then mixes the soundtrack on the film's cues (mix.py) and muxes the film.
import { chromium } from '@playwright/test';
import { spawn, spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const root = fileURLToPath(new URL('../../..', import.meta.url));
const outputDirectory = join(root, 'tmp/launch-film');
const { values } = parseArgs({
	options: {
		stills: { type: 'string' },
		from: { type: 'string' },
		to: { type: 'string' },
		fps: { type: 'string' },
		samples: { type: 'string' },
		out: { type: 'string' }
	}
});
const samples = Number(values.samples ?? 32);

const types = {
	'.html': 'text/html',
	'.js': 'text/javascript',
	'.css': 'text/css',
	'.png': 'image/png',
	'.svg': 'image/svg+xml',
	'.ttf': 'font/ttf',
	'.json': 'application/json'
};

let sink = null;
const server = Bun.serve({
	port: 0,
	idleTimeout: 0,
	async fetch(request) {
		const path = decodeURIComponent(new URL(request.url).pathname);
		if (request.method === 'POST' && path === '/frame') {
			const frame = new Uint8Array(await request.arrayBuffer());
			if (!sink.write(frame)) await new Promise((resolve) => sink.once('drain', resolve));
			return new Response('ok');
		}
		const relative = normalize(path.endsWith('/') ? `${path}index.html` : path).slice(1);
		if (relative.startsWith('..')) return new Response('Forbidden', { status: 403 });
		const file = Bun.file(join(root, relative));
		if (!(await file.exists())) return new Response('Not found', { status: 404 });
		return new Response(file, {
			headers: {
				'content-type': types[extname(relative)] ?? 'application/octet-stream'
			}
		});
	}
});

function encoder(output, fps) {
	const process = spawn(
		'ffmpeg',
		[
			'-hide_banner',
			'-loglevel',
			'error',
			'-y',
			'-f',
			'image2pipe',
			'-framerate',
			String(fps),
			'-c:v',
			'mjpeg',
			'-i',
			'-',
			'-vf',
			'scale=out_color_matrix=bt709:out_range=tv,format=yuv420p',
			'-c:v',
			'libx264',
			'-preset',
			'medium',
			'-crf',
			'17',
			'-colorspace',
			'bt709',
			'-color_primaries',
			'bt709',
			'-color_trc',
			'bt709',
			'-movflags',
			'+faststart',
			output
		],
		{ stdio: ['pipe', 'inherit', 'inherit'] }
	);
	const finished = new Promise((resolve, reject) => {
		process.on('error', reject);
		process.on('close', (code) =>
			code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`))
		);
	});
	return { stdin: process.stdin, finished };
}

// The film draws live DOM into WebGL: Metal for speed and HTML-in-Canvas for the surfaces.
const browser = await chromium.launch({
	channel: 'chromium',
	args: [
		'--use-angle=metal',
		'--ignore-gpu-blocklist',
		'--enable-blink-features=CanvasDrawElement',
		'--enable-features=CanvasDrawElement'
	]
});
let film;
try {
	const context = await browser.newContext({
		viewport: { width: 1920, height: 1080 },
		deviceScaleFactor: 2
	});
	const page = await context.newPage();
	const errors = [];
	page.on('pageerror', (error) => errors.push(error.message));
	page.on('requestfailed', (request) => errors.push(`${request.url()} failed`));
	page.on('response', (response) => {
		if (response.status() >= 400) errors.push(`${response.url()} ${response.status()}`);
	});
	page.on('console', (message) => {
		if (message.type() === 'error') errors.push(message.text());
	});
	await page.goto(`http://127.0.0.1:${server.port}/apps/marketing/launch-film/`);
	await page
		.waitForFunction(() => window.film, null, { timeout: 30_000 })
		.catch((error) => {
			throw new Error([error.message, ...errors].join('\n'));
		});
	film = await page.evaluate(() => ({
		cues: window.film.cues,
		fps: window.film.FPS,
		duration: window.film.DURATION,
		bpm: window.film.BPM,
		bar: window.film.BAR,
		sections: window.film.sections,
		score: window.film.score
	}));
	await mkdir(join(outputDirectory, 'stills'), { recursive: true });
	await writeFile(join(outputDirectory, 'cues.json'), JSON.stringify(film, null, 2));
	if (values.stills) {
		const stage = page.locator('#stage');
		for (const t of values.stills.split(',').map(Number)) {
			await page.evaluate(([time, n]) => window.film.seek(time, { samples: n }), [t, samples]);
			await stage.screenshot({
				path: join(outputDirectory, 'stills', `${t.toFixed(2)}.png`)
			});
		}
	} else {
		const fps = Number(values.fps ?? film.fps);
		const from = Number(values.from ?? 0);
		const to = Number(values.to ?? film.duration);
		const output = values.out ?? join(outputDirectory, 'picture.mp4');
		const video = encoder(output, fps);
		sink = video.stdin;
		const frames = Math.round((to - from) * fps);
		const started = Date.now();
		for (let frame = 0; frame < frames; frame++) {
			await page.evaluate(
				async ([time, n]) => {
					await window.film.seek(time, { samples: n });
					const image = await new Promise((resolve) =>
						document.getElementById('stage').toBlob(resolve, 'image/jpeg', 0.98)
					);
					const response = await fetch('/frame', {
						method: 'POST',
						body: image
					});
					if (!response.ok) throw new Error('Frame upload failed');
				},
				[from + frame / fps, samples]
			);
			if (errors.length) throw new Error(errors.join('\n'));
			if (frame % 60 === 0) {
				const rate = (frame + 1) / ((Date.now() - started) / 1000);
				process.stdout.write(
					`\r${(frame / fps).toFixed(0)}s / ${(to - from).toFixed(0)}s  ${rate.toFixed(1)} fps\n`
				);
			}
		}
		video.stdin.end();
		await video.finished;
		process.stdout.write(`wrote ${output}\n`);
	}
	if (errors.length) throw new Error(errors.join('\n'));
} finally {
	await browser.close();
	server.stop();
}

function run(command, args) {
	const result = spawnSync(command, args, { cwd: root, stdio: 'inherit' });
	if (result.error) throw result.error;
	if (result.status !== 0) throw new Error(`${command} ${args[0]} failed (${result.status})`);
}

if (!values.stills && !values.from && !values.to) {
	const work = 'tmp/launch-film';
	run('uv', ['run', 'apps/marketing/launch-film/mix.py', work]);
	// AAC adds up to ~1 dB of overshoot; the master keeps a -1.5 dBTP ceiling for it.
	run('ffmpeg', [
		'-hide_banner',
		'-loglevel',
		'error',
		'-y',
		'-i',
		`${work}/picture.mp4`,
		'-i',
		`${work}/soundtrack.wav`,
		'-map',
		'0:v',
		'-map',
		'1:a',
		'-c:v',
		'copy',
		'-c:a',
		'aac',
		'-b:a',
		'256k',
		'-shortest',
		'-movflags',
		'+faststart',
		`${work}/openpost-launch.mp4`
	]);
	console.log(`wrote ${work}/openpost-launch.mp4`);
}
