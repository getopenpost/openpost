// Renders the launch film: bun apps/marketing/launch-film/render.mjs [--stills 1,8,14] [--from s --to s]
// Frames come from film.js, captured in Chromium and encoded with FFmpeg. Each frame averages
// --blur subframes across a 180-degree shutter, so fast moves blur and still UI stays sharp.
// A full render then mixes the soundtrack on the film's cues (mix.py) and muxes the film.
// --artwork <file.png> writes the sample launch image that the UI capture uploads.
import { chromium } from '@playwright/test';
import { spawn, spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, extname, join, normalize } from 'node:path';
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
		blur: { type: 'string' },
		artwork: { type: 'string' }
	}
});

const types = {
	'.html': 'text/html',
	'.js': 'text/javascript',
	'.css': 'text/css',
	'.png': 'image/png',
	'.svg': 'image/svg+xml',
	'.ttf': 'font/ttf',
	'.json': 'application/json'
};
const server = Bun.serve({
	port: 0,
	async fetch(request) {
		const path = decodeURIComponent(new URL(request.url).pathname);
		const relative = normalize(path.endsWith('/') ? `${path}index.html` : path).slice(1);
		if (relative.startsWith('..')) return new Response('Forbidden', { status: 403 });
		const file = Bun.file(join(root, relative));
		if (!(await file.exists())) return new Response('Not found', { status: 404 });
		return new Response(file, {
			headers: { 'content-type': types[extname(relative)] ?? 'application/octet-stream' }
		});
	}
});

function encoder(output, args) {
	const process = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args, output], {
		stdio: ['pipe', 'inherit', 'inherit']
	});
	const finished = new Promise((resolve, reject) => {
		process.on('error', reject);
		process.on('close', (code) =>
			code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`))
		);
	});
	return { stdin: process.stdin, finished };
}

const browser = await chromium.launch({ channel: 'chromium' });
let film;
try {
	const page = await browser.newPage({
		viewport: { width: 1920, height: 1080 },
		deviceScaleFactor: values.artwork ? 2 : 1
	});
	const errors = [];
	page.on('pageerror', (error) => errors.push(error.message));
	page.on('requestfailed', (request) => errors.push(`${request.url()} failed`));
	page.on('response', (response) => {
		if (response.status() >= 400) errors.push(`${response.url()} ${response.status()}`);
	});
	page.on('console', (message) => {
		if (message.type() === 'error') errors.push(message.text());
	});
	const query = values.artwork ? '?artwork' : '';
	await page.goto(`http://127.0.0.1:${server.port}/apps/marketing/launch-film/${query}`);
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
		sections: window.film.sections
	}));
	const seek = (t) => page.evaluate((time) => window.film.seek(time), t);
	const stage = page.locator('#stage');

	if (values.artwork) {
		await mkdir(dirname(values.artwork), { recursive: true });
		await page.locator('#artwork').screenshot({ path: values.artwork });
	} else if (values.stills) {
		await mkdir(join(outputDirectory, 'stills'), { recursive: true });
		await writeFile(join(outputDirectory, 'cues.json'), JSON.stringify(film, null, 2));
		for (const t of values.stills.split(',').map(Number)) {
			await seek(t);
			await stage.screenshot({ path: join(outputDirectory, 'stills', `${t.toFixed(2)}.png`) });
		}
	} else {
		await mkdir(outputDirectory, { recursive: true });
		await writeFile(join(outputDirectory, 'cues.json'), JSON.stringify(film, null, 2));
		const fps = Number(values.fps ?? film.fps);
		const subframes = Math.max(1, Number(values.blur ?? 3));
		const shutter = 0.5 / fps;
		const from = Number(values.from ?? 0);
		const to = Number(values.to ?? film.duration);
		const output = join(outputDirectory, 'picture.mp4');
		const video = encoder(output, [
			'-f',
			'image2pipe',
			'-framerate',
			String(fps * subframes),
			'-c:v',
			'mjpeg',
			'-i',
			'-',
			'-vf',
			`tmix=frames=${subframes},select='eq(mod(n\\,${subframes})\\,${subframes - 1})',setpts=N/(${fps}*TB)`,
			'-r',
			String(fps),
			'-c:v',
			'libx264',
			'-preset',
			'slow',
			'-crf',
			'15',
			'-pix_fmt',
			'yuv420p',
			'-movflags',
			'+faststart'
		]);
		const frames = Math.round((to - from) * fps);
		for (let frame = 0; frame < frames; frame++) {
			for (let sub = 0; sub < subframes; sub++) {
				await seek(from + frame / fps + (sub * shutter) / subframes);
				const image = await stage.screenshot({ type: 'jpeg', quality: 96 });
				if (!video.stdin.write(image))
					await new Promise((resolve) => video.stdin.once('drain', resolve));
			}
			if (frame % fps === 0)
				process.stdout.write(`\r${(frame / fps).toFixed(0)}s / ${(to - from).toFixed(0)}s`);
		}
		video.stdin.end();
		await video.finished;
		process.stdout.write(`\nwrote ${output}\n`);
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

if (!values.stills && !values.artwork && !values.from && !values.to) {
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
