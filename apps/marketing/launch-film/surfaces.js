// DOM surfaces: authored UI that reaches the GPU through HTML-in-Canvas. Live surfaces repaint on change.
import { ditherThreshold, gradientSvg } from '../../../packages/dither/dist/paint.js';

export const script = await (await fetch('./script.json')).json();
const icons = (await (await fetch('/node_modules/@iconify-json/lucide/icons.json')).json()).icons;
// Every sample account belongs to Todoist, so its own mark is the avatar.
const avatar = './todoist/mark.png';
export const marks = (name) => `/assets/postiz-socials/${name}.svg`;

export function icon(name, size) {
	const body = icons[name]?.body;
	if (!body) throw new Error(`Missing icon ${name}`);
	const style = size ? ` style="font-size:${size}px"` : '';
	return `<svg class="icon" viewBox="0 0 24 24"${style}>${body}</svg>`;
}

export const networks = [
	'Instagram',
	'Facebook',
	'Linkedin',
	'X',
	'TikTok',
	'Youtube',
	'Threads',
	'Bluesky',
	'Mastodon',
	'Pixelfed',
	'Peertube',
	'Lemmy',
	'PieFed',
	'Discord',
	'Pinterest',
	'Telegram'
];

// Lemmy's and PieFed's files sit on a white plate; the film shows every network's own shape.
const bareMark = async (name) => {
	const svg = await (await fetch(marks(name))).text();
	return `data:image/svg+xml,${encodeURIComponent(svg.replace(/<rect[^>]*fill="white"[^>]*\/>/, ''))}`;
};
const bare = { Lemmy: await bareMark('Lemmy'), PieFed: await bareMark('PieFed') };

// What a launch actually asks of one person: real tasks first, then what each network rejects.
export const demands = [
	['X', 'Write the X thread', 'Due today'],
	['Instagram', 'Crop for Instagram', 'Needs 4:5'],
	['Linkedin', 'LinkedIn version', 'Needs a longer story'],
	['TikTok', 'Cut a vertical teaser', 'No video yet'],
	['Youtube', 'Add a thumbnail', 'Required to publish'],
	['Bluesky', 'Shorten for Bluesky', '312 / 300'],
	['X', 'Too long for X', '312 / 280'],
	['Linkedin', 'Reconnect LinkedIn', 'Session expired'],
	['Threads', 'Rewrite for Threads', 'Not started'],
	['Mastodon', 'Add alt text', 'Missing on 3 images'],
	['Facebook', 'Reconnect Facebook', 'Token expired'],
	['Pinterest', 'Make a vertical pin', '2:3 required'],
	['Telegram', 'Post to the channel', 'Not scheduled'],
	['Discord', 'Tell the community', 'Not started'],
	['Youtube', 'Write the description', 'Empty'],
	['Instagram', 'Upload failed', 'Image too large'],
	['X', 'Answer 47 replies', 'Unread'],
	['Linkedin', 'Reply to 18 comments', 'Unread'],
	['TikTok', 'Add captions', 'Not started'],
	['Threads', 'Schedule for 9 AM', 'Wrong time zone'],
	['Bluesky', 'Post failed', 'Try again'],
	['Mastodon', 'Check the numbers', 'Six dashboards'],
	['Peertube', 'Upload the video', 'Queued 2h'],
	['Lemmy', 'Pick a community', 'Not started']
];

// The brand's Bayer gradient at film scale: cells stay visible after the frame is scaled and encoded.
function bayer(w, h, cell, from, to) {
	const canvas = document.createElement('canvas');
	canvas.width = Math.ceil(w / cell);
	canvas.height = Math.ceil(h / cell);
	const context = canvas.getContext('2d');
	for (let y = 0; y < canvas.height; y++)
		for (let x = 0; x < canvas.width; x++) {
			context.fillStyle = 1 - y / canvas.height > ditherThreshold(x, y) ? to : from;
			context.fillRect(x, y, 1, 1);
		}
	return canvas.toDataURL();
}
const pixelated = (url) =>
	`background-image:url(${url});background-size:100% 100%;image-rendering:pixelated`;

// Where an element sits on its surface, in surface pixels from the centre with y up, like the world.
export function anchorOf(surface, node) {
	const a = surface.element.getBoundingClientRect();
	const b = node.getBoundingClientRect();
	return {
		x: b.left + b.width / 2 - (a.left + a.width / 2),
		y: a.top + a.height / 2 - (b.top + b.height / 2)
	};
}

export function createSurfaces(engine, canvas) {
	const dither = (ink) =>
		`url("data:image/svg+xml,${encodeURIComponent(gradientSvg({ length: 52, kind: 'button', ink }))}")`;
	canvas.style.setProperty('--dither-light', dither('rgb(255 255 255 / 0.2)'));
	canvas.style.setProperty('--dither-dark', dither('rgb(43 38 33 / 0.1)'));

	const all = {};
	function surface(
		name,
		w,
		h,
		html = '',
		{ radius = 0, live = false, className = '', font = '' } = {}
	) {
		const element = document.createElement('div');
		element.className = `surface ${className}`;
		element.style.cssText = `width:${w}px;height:${h}px;${font}`;
		element.innerHTML = html;
		canvas.append(element);
		const entry = engine.surface(element);
		Object.assign(entry, { name, w, h, radius, live });
		all[name] = entry;
		return entry;
	}

	surface(
		'line',
		2400,
		320,
		'<div class="type-line" style="height:320px;font-size:236px"><span></span><i></i></div>',
		{ live: true }
	);
	const release = surface(
		'release',
		900,
		520,
		`
		<div style="padding:40px 44px">
			<div class="row" style="gap:14px;font-size:24px;color:var(--muted)">${icon('github', 32)}<span>${script.repository}</span>
				<span style="margin-left:auto;padding:5px 16px;border-radius:999px;border:1px solid #9fd3ae;color:var(--green);font-size:20px;font-weight:600">Latest</span></div>
			<div class="row" style="gap:18px;margin-top:30px"><img src="${avatar}" width="64" height="64" style="border-radius:14px" alt=""><span style="font-size:58px;font-weight:600;letter-spacing:-0.03em">${script.product} ${script.tag.replace('v', '').replace('.0.0', '')}</span></div>
			<div style="margin-top:8px;font-size:30px;color:var(--muted)">${script.release}</div>
			<div style="margin-top:30px;display:grid;gap:14px;font-size:27px">
				${script.notes.map((note) => `<div class="row check" style="gap:14px;color:var(--green)">${icon('circle-check', 28)}<span style="color:var(--ink)">${note}</span></div>`).join('')}
			</div>
		</div>`,
		{ radius: 28, live: true, className: 'sheet' }
	);
	release.checks = [...release.element.querySelectorAll('.check')];

	const columns = 4;
	const chip = { w: 500, h: 112, gap: 12 };
	const rows = Math.ceil(demands.length / columns);
	const atlas = surface(
		'chips',
		columns * (chip.w + chip.gap),
		rows * (chip.h + chip.gap),
		demands
			.map(([mark, title, detail], i) => {
				const x = (i % columns) * (chip.w + chip.gap);
				const y = Math.floor(i / columns) * (chip.h + chip.gap);
				const alert = /\d \/ |expired|failed|required|Required|too large|Try again/.test(
					`${title} ${detail}`
				);
				const count = i % 3 === 2 ? `<span class="count">${((i * 7) % 23) + 2}</span>` : '';
				return `<div class="chip${alert ? ' alert' : ''}" style="left:${x}px;top:${y}px"><img src="${marks(mark)}" alt=""><div><div>${title}</div><small>${detail}</small></div>${count}</div>`;
			})
			.join('')
	);
	atlas.rect = (i) => {
		const k = i % demands.length;
		const x = (k % columns) * (chip.w + chip.gap);
		const y = Math.floor(k / columns) * (chip.h + chip.gap);
		return [x / atlas.w, y / atlas.h, (x + chip.w) / atlas.w, (y + chip.h) / atlas.h];
	};
	atlas.chip = chip;

	surface(
		'barrage',
		1800,
		460,
		'<div class="type-line" style="height:460px;justify-content:center;font-size:330px;color:#fff"><span></span></div>',
		{ live: true }
	);
	// Printed on the finished frame, clear of the water. The words drift in; the dots land on the beat.
	const team = surface(
		'team',
		1700,
		200,
		`<div class="team-line">${['You’re ', 'a ', 'team ', 'of ', 'one'].map((word) => `<span class="team-word">${word}</span>`).join('')}<span class="team-dot">.</span><span class="team-dot">.</span><span class="team-dot">.</span></div>`,
		{ live: true }
	);
	team.words = [...team.element.querySelectorAll('.team-word')];
	team.dots = [...team.element.querySelectorAll('.team-dot')];
	surface(
		'wordmark',
		1100,
		240,
		`<div style="font-family:Manrope,sans-serif;font-weight:600;font-size:196px;letter-spacing:-0.035em;line-height:240px;white-space:nowrap;color:var(--ink)"><span>OpenPost</span></div>`
	);
	// The promise writes itself beside the mark, is erased, and the name is typed in the same spot.
	const promise = surface(
		'promise',
		1120,
		420,
		'<div class="promise-line"><span class="promise-a"></span><span class="promise-b"></span><span class="promise-word"></span><i></i></div>',
		{ live: true }
	);
	promise.row = promise.element.querySelector('.promise-line');
	promise.first = promise.element.querySelector('.promise-a');
	promise.second = promise.element.querySelector('.promise-b');
	promise.word = promise.element.querySelector('.promise-word');
	promise.caret = promise.element.querySelector('i');
	surface(
		'hand',
		200,
		240,
		`<svg viewBox="0 0 24 28" width="200" height="233" style="overflow:visible"><path d="M8.6 12.6V3.9a1.9 1.9 0 0 1 3.8 0v7.2l.2-1a1.8 1.8 0 0 1 3.5.5l-.1 1.2.3-.7a1.7 1.7 0 0 1 3.2 1l-.2 1.3.4-.5a1.6 1.6 0 0 1 2.8 1.4l-1 6.6a5.8 5.8 0 0 1-5.7 4.9h-3.5a6 6 0 0 1-4.9-2.6L1.9 15.7a1.8 1.8 0 0 1 2.8-2.2z" fill="#fff" stroke="#2b2621" stroke-width="1.15" stroke-linejoin="round"/><path d="M12.4 16v5M15.6 16v5M18.6 16.4v4.6" stroke="#2b2621" stroke-width="1" stroke-linecap="round" fill="none"/></svg>`
	);

	// Kinetic lines share one size so every title reads the same; words rise out of a blur, then the
	// surface stops repainting.
	function line(name, text, accent = [], { size = 112, width = 2200 } = {}) {
		const entry = surface(
			name,
			width,
			Math.round(size * 1.5),
			`<div class="type-line" style="height:100%;justify-content:center;font-size:${size}px;letter-spacing:-0.035em"></div>`,
			{ live: true }
		);
		const row = entry.element.firstElementChild;
		entry.words = text.split(' ').map((word, i, words) => {
			const span = document.createElement('span');
			span.textContent = word + (i < words.length - 1 ? ' ' : '');
			span.style.display = 'inline-block';
			if (accent.includes(word)) span.style.color = 'var(--mark)';
			row.append(span);
			return span;
		});
		return entry;
	}
	line('sayFlow', 'Ship it. Your posts write themselves.', ['themselves.']);
	line('sayReview', 'One click and it’s ready.', ['ready.']);
	line('sayNetworks', 'One post. Perfect for every network.', ['Perfect']);
	line('sayDesign', 'Visuals that stop the scroll.', ['scroll.']);
	line('sayCut', 'Edit the whole video, right here.', ['whole', 'video,']);
	line('saySchedule', 'Set it once. It posts itself.', ['itself.']);
	line('sayResults', 'Find what worked. Make more of it.', ['more']);
	line('sayInbox', 'Every reply, one inbox.', ['one']);
	line('sayEverything', 'Plus the rest of your content team.', ['content', 'team.']);
	line('sayLogos', 'Everywhere your audience is.', ['audience']);

	// Workflow nodes, in the app's categories.
	const nodes = [
		['nodeRelease', 'github', 'GitHub release', script.repository, 'trigger'],
		['nodeStable', 'git-branch', 'Stable release?', 'Check release type', 'flow'],
		['nodeBuild', 'sparkles', 'Build draft', 'Release notes to post', 'ai'],
		['nodeReview', 'check', 'Review post', 'Ready for your approval', 'flow'],
		['nodeWait', 'clock', 'Wait', 'Pre-release · wait 1 day', 'flow'],
		['nodeCreate', 'square-pen', 'Create draft', 'Keep the release notes', 'content']
	];
	for (const [name, glyph, label, detail, category] of nodes) {
		const node = surface(
			name,
			430,
			158,
			`<div class="flow-node ${category}" style="position:absolute;inset:0;border-radius:24px"><div class="row" style="gap:20px"><span class="flow-icon">${icon(glyph, 34)}</span><div><b>${label}</b><p>${detail}</p></div></div><div class="flow-state">${icon('circle', 15)}<span>Ready</span></div></div>`,
			{ radius: 24, live: true }
		);
		node.card = node.element.firstElementChild;
		node.stateRow = node.element.querySelector('.flow-state');
	}
	// Each step shows its own work on the right of its row while its check draws itself.
	const stepNetworks = ['X', 'Linkedin', 'Instagram', 'TikTok', 'Bluesky'];
	const steps = [
		[
			'Reading the release notes',
			['Focus mode', 'Quick Add', 'Widgets']
				.map((note) => `<span class="build-pill work">${note}</span>`)
				.join('')
		],
		['Writing the post', '<span class="build-stream"></span>'],
		[
			'Perfecting it for each network',
			stepNetworks
				.map((name) => `<img class="work" src="${marks(name)}" width="40" height="40" alt="">`)
				.join('')
		]
	];
	const build = surface(
		'buildPanel',
		860,
		380,
		`
		<div style="position:absolute;inset:0;padding:26px 32px;${pixelated(bayer(860, 380, 4, '#fbf1e7', '#ffffff'))}">
			<div class="row" style="gap:14px;font-size:34px;font-weight:600;letter-spacing:-0.02em"><span class="flow-icon" style="width:58px;height:58px">${icon('sparkles', 32)}</span>Build draft<span class="build-status">Working</span></div>
			<div class="build-progress"><i></i></div>
			<div style="margin-top:10px;display:grid;gap:4px">${steps
				.map(
					([label, work]) =>
						`<div class="build-row"><svg class="tick" viewBox="0 0 40 40" width="40" height="40"><circle class="ring" cx="20" cy="20" r="16" pathLength="1"/><circle class="disc" cx="20" cy="20" r="18"/><path class="stroke" d="M11.5 20.5l6 6 11-12.5" pathLength="1"/></svg><span class="build-label">${label}</span><span class="build-work">${work}</span></div>`
				)
				.join('')}</div>
		</div>`,
		{ radius: 30, live: true }
	);
	build.rows = [...build.element.querySelectorAll('.build-row')].map((row) => ({
		row,
		tick: row.querySelector('.tick'),
		ring: row.querySelector('.ring'),
		disc: row.querySelector('.disc'),
		stroke: row.querySelector('.stroke'),
		label: row.querySelector('.build-label'),
		work: [...row.querySelectorAll('.work')],
		stream: row.querySelector('.build-stream')
	}));
	build.bar = build.element.querySelector('.build-progress i');
	build.status = build.element.querySelector('.build-status');

	// Composer.
	const accounts = [
		['Linkedin', 'Todoist'],
		['Bluesky', '@todoist.com'],
		['X', '@todoist'],
		['Threads', 'todoist'],
		['Mastodon', '@todoist']
	];
	const composer = surface(
		'composer',
		1560,
		640,
		`
		<div class="row" style="position:absolute;left:48px;top:32px;gap:34px;font-size:25px">
			<div style="font-weight:600;padding-bottom:14px;border-bottom:3px solid var(--ink)">All</div>
			${accounts.map(([mark, handle]) => `<div class="row muted" style="gap:12px;padding-bottom:14px"><div class="avatar"><img src="${avatar}" alt=""><img src="${marks(mark)}" alt=""></div>${handle}</div>`).join('')}
		</div>
		<div style="position:absolute;left:48px;right:48px;top:102px;height:1px;background:var(--line)"></div>
		<div class="draft" style="position:absolute;left:52px;top:128px;width:1456px;font-size:74px;line-height:1.24;letter-spacing:-0.025em"><span></span><i style="display:inline-block;width:6px;height:0.95em;margin-left:5px;vertical-align:-0.12em;background:var(--mark);border-radius:2px"></i></div>
		<div class="drafted row muted" style="position:absolute;left:52px;top:424px;gap:10px;font-size:24px"><span style="color:var(--mark)">${icon('workflow', 24)}</span>Drafted by Workflows · ${script.tag}</div>
		<div class="row" style="position:absolute;left:48px;right:48px;bottom:34px;height:56px;justify-content:space-between">
			<div class="row muted" style="gap:28px">${['image', 'list-checks', 'smile'].map((name) => icon(name, 32)).join('')}</div>
			<div class="row" style="gap:22px"><span class="counter">${icon('circle-check', 20)} <span class="count-text">0 / 280</span></span><span class="button ordinary">${icon('sparkles', 22)} Ideate</span><span class="button focal approve">${icon('check', 22)} Approve</span></div>
		</div>`,
		{ radius: 30, live: true, className: 'sheet' }
	);
	composer.text = composer.element.querySelector('.draft span');
	composer.caret = composer.element.querySelector('.draft i');
	composer.drafted = composer.element.querySelector('.drafted');
	composer.count = composer.element.querySelector('.count-text');
	composer.approve = composer.element.querySelector('.approve');

	// The launch image in Todoist's own language: warm white, a huge near-black line, soft peach waves,
	// its logo and its product. Each piece is a layer, so the image editor can pull them apart.
	const waves = `<svg class="waves" viewBox="0 0 1200 628" preserveAspectRatio="none" aria-hidden="true"><defs><linearGradient id="wave-a" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff3ea"/><stop offset="1" stop-color="#ffdccb"/></linearGradient><linearGradient id="wave-b" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffe8dc"/><stop offset="1" stop-color="#ffc9b3"/></linearGradient></defs><rect width="1200" height="628" fill="#fffdfc"/><path d="M0 438C190 360 340 372 520 438S880 560 1200 300V628H0Z" fill="url(#wave-a)"/><path d="M0 540C240 470 420 520 620 556S980 590 1200 470V628H0Z" fill="url(#wave-b)"/></svg>`;
	const artParts = {
		brand: `<img class="logo" src="./todoist/logo.svg" alt="">`,
		phone: `<img class="phone" src="./todoist/today.png" alt="">`,
		quick: `<div class="quick"><img src="./todoist/quick-add.png" alt=""></div>`,
		// The headline's second line starts near-black; the image editor recolours it.
		words: (edited) =>
			`<div class="headline">Just today.<br><span class="hot" style="--sweep:${edited ? 100 : 0}%">Nothing else.</span></div><div class="tag">Focus mode, new in ${script.product} 12</div><div class="note">finally quiet</div>`
	};
	const artAll = (edited) =>
		`<div class="art">${waves}${artParts.phone}${artParts.quick}${artParts.brand}${artParts.words(edited)}</div>`;

	// Each network gets a native card with its own copy and its own picture.
	const playIcon = (size) =>
		`<span style="width:${size}px;height:${size}px;border-radius:50%;background:rgb(255 255 255 / 94%);color:#25221e;display:grid;place-items:center;box-shadow:0 8px 24px rgb(37 34 30 / 24%)">${icon('play', size * 0.5)}</span>`;
	const cover = (file, position = '50% 50%') =>
		`<img src="./todoist/${file}" alt="" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:${position}">`;
	const pictures = {
		linkedin: cover('og.png'),
		instagram: `${cover('voice.png', '50% 62%')}<span style="position:absolute;right:16px;top:16px;padding:5px 13px;border-radius:999px;background:rgb(37 34 30 / 72%);color:#fff;font-size:19px;font-weight:600">1 / 5</span>`,
		tiktok: `<div style="position:absolute;inset:0;background:linear-gradient(170deg,#fff3ea,#ffc9b3)"></div><img src="./todoist/today.png" alt="" style="position:absolute;left:-74px;top:176px;width:540px"><div style="position:absolute;left:22px;right:22px;top:26px;font-size:38px;line-height:1.12;font-weight:800;letter-spacing:-0.03em;color:#25221e">${script.tiktok}</div><div style="position:absolute;right:20px;bottom:20px">${playIcon(76)}</div>`,
		youtube: `${cover('quick-add.png', '50% 47%')}<div style="position:absolute;left:0;top:0;padding:14px 22px 16px 22px;border-bottom-right-radius:18px;background:#e44332;color:#fff;font-size:33px;font-weight:800;letter-spacing:-0.03em">${script.youtube}</div><div style="position:absolute;right:20px;bottom:18px">${playIcon(72)}</div>`,
		pinterest: `${cover('board.png', '12% 60%')}<div style="position:absolute;left:0;right:0;bottom:0;padding:34px 22px 22px;background:linear-gradient(180deg,rgb(255 253 252 / 0%),#fffdfc 36%);font-size:37px;line-height:1.08;font-weight:800;letter-spacing:-0.03em;color:#25221e">${script.pinterest}</div>`,
		bluesky: `<div style="position:absolute;inset:0;background:#e44332"></div><img src="${avatar}" alt="" style="position:absolute;left:-6px;top:0;height:290px"><div style="position:absolute;left:304px;top:0;bottom:0;display:flex;align-items:center;color:#fff;font-size:74px;line-height:0.98;font-weight:800;letter-spacing:-0.045em">Todoist<br>12</div>`
	};
	const social = [
		[
			'cardLinkedin',
			'linkedin',
			'Linkedin',
			'Todoist · 1h',
			3000,
			script.linkedin,
			620,
			560,
			572,
			300
		],
		['cardInstagram', 'instagram', 'Instagram', 'todoist · 1h', 2200, '', 560, 680, 512, 560],
		['cardTikTok', 'tiktok', 'TikTok', '@todoist · 1h', 2200, '', 440, 760, 392, 640],
		['cardYoutube', 'youtube', 'Youtube', 'Todoist · 1h', 5000, '', 640, 453, 592, 333],
		[
			'cardBluesky',
			'bluesky',
			'Bluesky',
			'@todoist.com · 1h',
			300,
			script.bluesky,
			600,
			540,
			552,
			290
		],
		['cardPinterest', 'pinterest', 'Pinterest', 'Todoist · 1h', 500, '', 440, 740, 392, 588]
	];
	for (const [name, platform, mark, sub, limit, text, w, h, mw, mh] of social) {
		const count = text
			? `<span class="chip-note" style="height:38px;font-size:17px;box-shadow:none">${[...text].length} / ${limit.toLocaleString('en-US')}</span>`
			: '';
		surface(
			name,
			w,
			h,
			`
			<div style="position:absolute;inset:0;padding:24px;display:flex;flex-direction:column;gap:16px;font-family:Inter,sans-serif;letter-spacing:-0.01em">
				<div class="social-header row"><img class="social-avatar" src="${avatar}" alt=""><div><b>${script.product}</b><div class="muted">${sub}</div></div>
					<div style="margin-left:auto;display:flex;align-items:center;gap:12px">${count}<img src="${marks(mark)}" width="44" height="44" style="border-radius:11px" alt=""></div></div>
				${text ? `<div style="height:110px;font-size:26px;line-height:1.3;overflow:hidden">${text}</div>` : ''}
				<div class="social-media" style="width:${mw}px;height:${mh}px;flex:none">${pictures[platform]}</div>
			</div>`,
			{ radius: 26, className: 'sheet' }
		);
	}

	// The X card is drawn large because the camera reads it up close. Its words are separate elements, so
	// the rewrite can move the ones it keeps instead of scrambling letters.
	const POST = { w: 944, wrap: 830, from: [44, 57], to: [54, 70] };
	const cardX = surface(
		'cardX',
		1040,
		1266,
		`
		<div style="position:absolute;inset:0;font-family:Inter,sans-serif;color:#0f1419">
			<div class="row" style="position:absolute;left:48px;right:48px;top:40px;height:92px;gap:22px">
				<img src="${avatar}" width="92" height="92" style="border-radius:50%" alt="">
				<div style="letter-spacing:-0.015em"><b style="font-size:38px;font-weight:700">${script.product}</b><div style="margin-top:2px;font-size:30px;color:#536471">@todoist · 1h</div></div>
				<div class="row" style="margin-left:auto;gap:20px"><span class="post-count"><svg viewBox="0 0 36 36" width="36" height="36"><circle cx="18" cy="18" r="15" fill="none" stroke="#e7e2dc" stroke-width="4"/><circle class="count-ring" cx="18" cy="18" r="15" fill="none" stroke-width="4" stroke-linecap="round" pathLength="1" stroke-dasharray="1" transform="rotate(-90 18 18)"/></svg><span class="count-text"></span></span><img src="${marks('X')}" width="76" height="76" style="border-radius:18px" alt=""></div>
			</div>
			<div class="post" style="position:absolute;left:48px;top:156px;width:${POST.w}px;height:476px"></div>
			<div class="post-perfected" style="position:absolute;left:48px;top:640px;${pixelated(bayer(330, 56, 4, '#9b4214', '#c9631f'))}">${icon('sparkles', 28)}Perfected for X</div>
			<div class="social-media" style="position:absolute;left:40px;top:716px;width:960px;height:502px;border-radius:24px"><div style="position:absolute;left:0;top:0;width:1200px;height:628px;transform:scale(0.8);transform-origin:0 0">${artAll(false)}</div></div>
		</div>`,
		{ radius: 44, live: true, className: 'sheet' }
	);
	const post = cardX.element.querySelector('.post');
	const measured = (text, [size, height], width) => {
		const box = document.createElement('div');
		box.style.cssText = `position:absolute;left:0;top:0;width:${width}px;visibility:hidden;font-size:${size}px;line-height:${height}px;letter-spacing:-0.012em;white-space:pre-wrap`;
		box.innerHTML = text
			.split(/( |\n)/)
			.filter(Boolean)
			.map((part) => (part === ' ' || part === '\n' ? part : `<span>${part}</span>`))
			.join('');
		post.append(box);
		return [...box.querySelectorAll('span')];
	};
	const tokensOf = (text) => text.split(/\s+/);
	const from = tokensOf(script.tooLong);
	const to = tokensOf(script.perfect);
	// Words the rewrite keeps, as [word in the new post, word in the old one], so they travel.
	const kept = new Map([
		[9, 0],
		[10, 1],
		[11, 17],
		[12, 18],
		[13, 19],
		[14, 20],
		[15, 15],
		[16, 16],
		[17, 2],
		[18, 3],
		[20, 22],
		[21, 23]
	]);
	const moved = new Map([...kept].map(([next, old]) => [old, next]));
	const word = (text) => {
		const node = document.createElement('span');
		node.className = 'post-word';
		node.textContent = text;
		post.append(node);
		return node;
	};
	cardX.rewrite = {
		size: POST.from[0] / POST.to[0],
		from: measured(script.tooLong, POST.from, POST.w),
		to: measured(script.perfect, POST.to, POST.wrap),
		words: []
	};
	let offset = 0;
	from.forEach((text, i) => {
		const start = offset;
		offset += text.length + 1;
		const node = word(text);
		// X paints what runs past the limit; the film keeps that truth instead of inventing a warning.
		if (start + text.length > 280) node.classList.add('over');
		cardX.rewrite.words.push({
			node,
			text,
			next: moved.has(i) ? to[moved.get(i)] : null,
			old: i,
			fresh: moved.has(i) ? moved.get(i) : null,
			kept: moved.has(i)
		});
	});
	to.forEach((text, i) => {
		if (kept.has(i)) return;
		cardX.rewrite.words.push({
			node: word(text),
			text,
			next: null,
			old: null,
			fresh: i,
			kept: false
		});
	});
	cardX.countText = cardX.element.querySelector('.count-text');
	cardX.countBox = cardX.element.querySelector('.post-count');
	cardX.countRing = cardX.element.querySelector('.count-ring');
	cardX.perfected = cardX.element.querySelector('.post-perfected');
	cardX.media = cardX.element.querySelector('.social-media');

	// The launch image, separated into the layers a designer sees.
	const layerStyle = 'position:absolute;inset:0;overflow:hidden';
	surface('artBack', 1200, 628, `<div class="art" style="${layerStyle}">${waves}</div>`, {
		radius: 22
	});
	surface(
		'artPhone',
		1200,
		628,
		`<div class="art" style="${layerStyle};background:none">${artParts.phone}</div>`
	);
	surface(
		'artQuick',
		1200,
		628,
		`<div class="art" style="${layerStyle};background:none">${artParts.quick}</div>`
	);
	surface(
		'artHead',
		1200,
		628,
		`<div class="art" style="${layerStyle};background:none">${artParts.brand}${artParts.words(false)}<div class="selection" style="left:50px;top:254px;width:668px;height:120px;display:none"><i style="left:-8px;top:-8px"></i><i style="right:-8px;top:-8px"></i><i style="left:-8px;bottom:-8px"></i><i style="right:-8px;bottom:-8px"></i></div></div>`,
		{ live: true }
	);
	all.artHead.hot = all.artHead.element.querySelector('.hot');
	all.artHead.selection = all.artHead.element.querySelector('.selection');

	const tools = [
		['mouse-pointer-2', 'Select'],
		['type', 'Text'],
		['image', 'Image'],
		['shapes', 'Shapes'],
		['pen-tool', 'Draw'],
		['crop', 'Crop'],
		['wand-sparkles', 'Effects'],
		['layers', 'Layers']
	];
	const rail = surface(
		'toolRail',
		96,
		578,
		`<div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:space-evenly;color:var(--muted)">${tools.map(([name, label]) => `<span class="tool" data-tool="${label}" style="width:64px;height:56px;display:grid;place-items:center;border-radius:14px">${icon(name, 34)}</span>`).join('')}</div>`,
		{ radius: 26, live: true, className: 'sheet' }
	);
	rail.tools = [...rail.element.querySelectorAll('.tool')];
	const slider = (label, value, shown) =>
		`<div style="margin-top:20px"><div class="row" style="justify-content:space-between;font-size:21px;color:var(--muted)"><span>${label}</span><span>${shown}</span></div><div style="height:10px;border-radius:5px;background:var(--sunken);margin-top:10px;overflow:hidden"><div style="height:100%;width:${value}%;background:var(--mark);border-radius:5px"></div></div></div>`;
	const inspector = surface(
		'inspector',
		300,
		578,
		`<div style="position:absolute;inset:0;padding:26px 24px;display:flex;flex-direction:column">
		<div style="font-size:26px;font-weight:600">Headline</div>
		<div style="margin-top:6px;font-size:20px;color:var(--muted)">Inter · ExtraBold</div>
		<div style="margin-top:24px;font-size:21px;color:var(--muted)">Colour</div>
		<div class="row" style="gap:11px;margin-top:12px">${['#25221e', '#e44332', '#ee6449', '#246fe0', '#058527'].map((colour) => `<span class="swatch-dot" style="width:40px;height:40px;border-radius:50%;background:${colour};border:2px solid rgb(43 38 33 / 12%)"></span>`).join('')}</div>
		${slider('Size', 58, '104')}${slider('Tracking', 28, '-4%')}
		<div class="button focal add-post" style="margin-top:auto;width:100%;height:60px">${icon('send', 22)} Add to post</div>
	</div>`,
		{ radius: 26, live: true, className: 'sheet' }
	);
	inspector.dots = [...inspector.element.querySelectorAll('.swatch-dot')];
	inspector.add = inspector.element.querySelector('.add-post');

	// Video editor: the same image as the first shot, on a full timeline.
	const TRACK = { left: 96, width: 1556 };
	const clips = [
		[0, 500, 'Intro', '#fbe9df'],
		[508, 520, 'Focus mode', '#e7e1f7'],
		[1036, 520, 'Outro', '#f6e3d6']
	];
	const words = ['Focus', 'mode', 'is', 'here.'];
	const wave = Array.from(
		{ length: 156 },
		(_, i) =>
			`<i style="display:block;width:6px;height:${(8 + Math.abs(Math.sin(i * 0.7) * Math.cos(i * 0.23)) * 30).toFixed(0)}px;border-radius:2px;background:#3d8bfd;opacity:.75;flex:none"></i>`
	).join('');
	const panels = [
		['film', 'Media'],
		['type', 'Text'],
		['captions', 'Captions'],
		['sparkles', 'Effects'],
		['blend', 'Transitions'],
		['music', 'Audio']
	];
	const editor = surface(
		'editor',
		1680,
		720,
		`
		<div style="position:absolute;left:28px;top:26px;width:236px;display:grid;gap:4px;font-size:24px">${panels.map(([name, label], i) => `<div class="row" style="gap:14px;height:54px;padding:0 16px;border-radius:14px;${i === 4 ? 'background:var(--selection);color:var(--focal);font-weight:600' : 'color:var(--muted)'}">${icon(name, 26)}${label}</div>`).join('')}</div>
		<div class="monitor" style="position:absolute;left:496px;top:24px;width:688px;height:360px;border-radius:14px;overflow:hidden;box-shadow:0 0 0 1px var(--border),0 10px 26px rgb(43 38 33 / 14%)"><div style="transform:scale(.57333);transform-origin:0 0;width:1200px;height:628px;position:absolute">${artAll(true)}</div><div class="caps" style="position:absolute;left:0;right:0;bottom:18px;text-align:center">${words.map((item) => `<span class="caption-word" style="font-size:24px">${item}</span>`).join('')}</div><div class="fade" style="position:absolute;inset:0;background:#000;opacity:0"></div></div>
		<div style="position:absolute;left:1240px;top:30px;width:412px;font-size:23px"><div style="font-weight:600;font-size:27px">Fade to black</div><div class="muted" style="margin-top:6px">Applied to Outro</div>${['Length', 'Softness'].map((label, i) => `<div style="margin-top:26px"><div class="row muted" style="justify-content:space-between;font-size:22px"><span>${label}</span><span>${i ? '60%' : '1.5s'}</span></div><div style="height:10px;border-radius:5px;background:var(--sunken);margin-top:10px"><div style="height:100%;width:${i ? 60 : 44}%;background:var(--mark);border-radius:5px"></div></div></div>`).join('')}</div>
		${['film', 'captions', 'music'].map((name, i) => `<div class="row muted" style="position:absolute;left:32px;top:${404 + i * 100 + 26}px;font-size:34px">${icon(name, 34)}</div><div class="track" style="left:${TRACK.left}px;top:${404 + i * 100}px;width:${TRACK.width}px;height:88px" data-track="${i}"></div>`).join('')}
		<div class="head" style="position:absolute;left:${TRACK.left}px;top:392px;width:4px;height:312px;background:var(--mark);border-radius:2px"></div>`,
		{ radius: 30, live: true, className: 'sheet' }
	);
	const tracks = editor.element.querySelectorAll('.track');
	editor.clips = clips.map(([x, w, label, colour]) => {
		const clip = document.createElement('div');
		clip.className = 'clip';
		clip.style.cssText = `left:${x}px;width:${w}px;height:76px;top:5px;font-size:24px;background:${colour};border:1px solid rgb(43 38 33 / 10%)`;
		clip.innerHTML = `${icon('film', 26)}${label}`;
		tracks[0].append(clip);
		return clip;
	});
	const wedge = document.createElement('div');
	wedge.style.cssText =
		'position:absolute;right:0;top:0;bottom:0;width:0;background:linear-gradient(90deg,rgb(0 0 0 / 0),rgb(0 0 0 / 78%));clip-path:polygon(0 0,100% 0,100% 100%)';
	editor.clips[2].style.overflow = 'hidden';
	editor.clips[2].append(wedge);
	editor.wedge = wedge;
	editor.captionClips = words.map((item, i) => {
		const clip = document.createElement('div');
		clip.className = 'clip';
		clip.style.cssText = `left:${120 + i * 210}px;width:194px;height:76px;top:5px;font-size:24px;background:rgb(180 83 9 / 14%);color:var(--mark)`;
		clip.textContent = item;
		tracks[1].append(clip);
		return clip;
	});
	const waveClip = document.createElement('div');
	waveClip.className = 'clip';
	waveClip.style.cssText = `left:0;width:${TRACK.width}px;height:76px;top:5px;background:rgb(61 139 253 / 10%);gap:4px`;
	waveClip.innerHTML = wave;
	tracks[2].append(waveClip);
	editor.wave = waveClip;
	editor.track = TRACK;
	editor.head = editor.element.querySelector('.head');
	editor.monitor = editor.element.querySelector('.monitor');
	editor.fade = editor.element.querySelector('.fade');
	editor.caps = [...editor.element.querySelectorAll('.caption-word')];

	// One big Schedule action with the app's dithered button, then the month.
	surface(
		'scheduleBar',
		1020,
		200,
		`<div class="row" style="position:absolute;inset:0;gap:26px;justify-content:center;background:#fff"><span class="row" style="gap:14px;font-size:46px;font-weight:600;color:var(--ink)">${icon('clock', 46)} Today, 5:00 PM</span><span class="row" style="height:124px;padding:0 50px;border-radius:30px;gap:16px;font-size:52px;font-weight:600;color:#fffaf6;${pixelated(bayer(420, 124, 4, '#8f3a10', '#bd5a1d'))}">${icon('calendar', 48)} Schedule</span></div>`,
		{ radius: 100 }
	);
	const posts = {
		4: ['What we shipped this week', 'Threads'],
		7: ['Building in the open', 'Mastodon'],
		9: ['A small update. A big difference.', 'X'],
		12: ['The idea behind Focus mode', 'Linkedin'],
		14: ['Quick Add, wherever you are', 'Bluesky'],
		23: ['A closer look at widgets', 'Threads'],
		25: ['Your questions, answered', 'Linkedin'],
		28: ['What comes next', 'Mastodon']
	};
	const dayNumber = (i) => (i < 3 ? 28 + i : i > 33 ? i - 33 : i - 2);
	const calendar = surface(
		'calendar',
		1600,
		786,
		`
		<div class="calendar-toolbar row"><b>Posts</b><span class="calendar-view">Calendar <span class="muted">List</span></span><span class="month-nav">${icon('chevron-left', 22)} October 2026 ${icon('chevron-right', 22)}</span><span class="button ordinary">Today</span><span class="button focal">${icon('plus', 20)} New post</span></div>
		<div class="calendar-week">${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day) => `<div>${day}</div>`).join('')}</div>
		<div class="calendar-grid">${Array.from({ length: 35 }, (_, i) => {
			const post_ = posts[i];
			const body = post_
				? `<div class="cal-chip ${i < 17 ? 'past' : 'planned'}"><div class="cal-text">${post_[0]}</div><div class="meta"><span class="status"><i></i>${i < 17 ? 'Published' : 'Scheduled'}</span><img src="${marks(post_[1])}" width="16" height="16" alt=""></div></div>`
				: i === 17
					? `<div class="cal-chip planned ours"><div class="cal-text">${script.product} 12 is live</div><div class="meta"><span class="status"><i></i>Scheduled</span><span>5 PM</span></div></div>`
					: '';
			return `<div class="calendar-day${i < 3 || i > 33 ? ' outside' : ''}"><span class="date${i === 17 ? ' today' : ''}">${dayNumber(i)}</span>${body}</div>`;
		}).join('')}</div>`,
		{ radius: 22, live: true, className: 'sheet' }
	);
	calendar.ours = calendar.element.querySelector('.ours');
	surface(
		'flyingPost',
		340,
		112,
		`<div style="position:absolute;inset:0;background:var(--peach);border:2px solid var(--peach-line);padding:14px 18px;font-size:26px;font-weight:600">${script.product} 12 is live<div class="row" style="justify-content:space-between;margin-top:6px;font-size:18px;font-weight:400;color:var(--muted)"><span>Scheduled</span><span>5 PM</span></div></div>`,
		{ radius: 18 }
	);

	// Results: the launch, what the app measured, and the next post.
	surface(
		'columnFace',
		90,
		640,
		`<div style="position:absolute;inset:0;${pixelated(bayer(90, 640, 6, '#a84a10', '#df8440'))}"></div>`
	);
	surface(
		'columnLaunch',
		90,
		640,
		`<div style="position:absolute;inset:0;${pixelated(bayer(90, 640, 6, '#8f3a10', '#ffb877'))}"></div>`
	);
	surface(
		'launchTag',
		270,
		168,
		`<div style="position:absolute;inset:0;background:#fff;padding:20px 24px"><div class="row" style="gap:10px;font-size:23px;color:var(--mark)">${icon('sparkles', 23)}Launch day</div><b class="views" style="display:block;font-size:64px;font-weight:600;letter-spacing:-0.03em;margin-top:2px;font-variant-numeric:tabular-nums">0</b><div class="muted" style="font-size:19px">views · Sample data</div></div>`,
		{ radius: 26, live: true }
	);
	all.launchTag.views = all.launchTag.element.querySelector('.views');
	surface(
		'viralSticker',
		310,
		104,
		`<div class="row" style="position:absolute;inset:0;gap:12px;justify-content:center;color:#fffaf6;font-size:44px;font-weight:700;letter-spacing:-0.03em;${pixelated(bayer(310, 104, 4, '#b4231d', '#ef6a3a'))}">${icon('flame', 40)}Viral hit</div>`,
		{ radius: 52 }
	);
	surface(
		'insightPost',
		640,
		190,
		`<div style="position:absolute;inset:0;padding:24px 30px"><div class="row" style="gap:12px;font-size:23px;color:var(--mark);font-weight:600">${icon('trophy', 26)}Strongest post</div><div style="margin-top:10px;font-size:33px;font-weight:600;letter-spacing:-0.02em;line-height:1.16">“${script.product} 12 is live” led this period with 1,284 engagement actions.</div></div>`,
		{ radius: 26, className: 'sheet' }
	);
	surface(
		'insightDestination',
		640,
		132,
		`<div style="position:absolute;inset:0;padding:20px 30px"><div class="row" style="gap:12px;font-size:23px;color:var(--mark);font-weight:600">${icon('target', 26)}Strongest destination</div><div class="row" style="margin-top:8px;gap:12px;font-size:31px;font-weight:600;letter-spacing:-0.02em"><img src="${marks('Linkedin')}" width="38" height="38" style="border-radius:9px" alt="">LinkedIn: 612 engagement actions</div></div>`,
		{ radius: 26, className: 'sheet' }
	);
	const repurpose = surface(
		'repurpose',
		640,
		118,
		`<div class="row" style="position:absolute;inset:0;gap:18px;padding:0 20px 0 30px;justify-content:space-between"><span class="repurpose-text" style="font-size:29px;font-weight:600;letter-spacing:-0.02em;white-space:nowrap">Do more of what worked</span><span class="button focal repurpose-button" style="height:76px;padding:0 30px;font-size:29px;border-radius:17px">${icon('repeat', 28)} Repurpose</span></div>`,
		{ radius: 26, live: true, className: 'sheet' }
	);
	repurpose.text = repurpose.element.querySelector('.repurpose-text');
	repurpose.button = repurpose.element.querySelector('.repurpose-button');

	script.comments.forEach(([mark, name, text], i) => {
		surface(
			`msg${i}`,
			1040,
			136,
			`<div class="message" style="position:absolute;inset:0"><img class="mark" src="${marks(mark)}" alt=""><div><div class="who"><b>${name}</b>just now</div><div class="text">${text}</div></div></div>`,
			{ radius: 26, className: 'sheet' }
		);
	});
	const reply = surface(
		'reply',
		1040,
		136,
		`<div class="row" style="position:absolute;inset:0;gap:16px;padding:0 20px 0 32px;font-size:32px"><div class="reply-text" style="flex:1"></div><span class="button focal reply-button" style="height:84px;padding:0 34px;font-size:28px">${icon('send', 26)} Reply</span></div>`,
		{ radius: 26, live: true, className: 'sheet' }
	);
	reply.text = reply.element.querySelector('.reply-text');
	reply.button = reply.element.querySelector('.reply-button');

	const featureList = [
		['workflow', 'Workflows'],
		['images', 'Media library'],
		['lightbulb', 'AI ideas'],
		['mic', 'Recorder'],
		['repeat', 'Auto repost'],
		['users-round', 'Teams'],
		['calendar-clock', 'Queues'],
		['code', 'API'],
		['bot', 'MCP'],
		['server', 'Self-hosting']
	];
	surface(
		'drum',
		1800,
		featureList.length * 300,
		featureList
			.map(
				([glyph, label], i) =>
					`<div class="row" style="position:absolute;left:0;right:0;top:${i * 300}px;height:300px;justify-content:center;gap:44px;font-size:170px;font-weight:600;letter-spacing:-0.04em"><span style="color:var(--mark)">${icon(glyph, 150)}</span>${label}</div>`
			)
			.join('')
	);
	all.drum.rows = featureList.length;

	// Every supported network, one mark each: the atlas is drawn once and sliced per mark.
	const tile = 220;
	const logos = surface(
		'logos',
		tile * 8,
		tile * 2,
		networks
			.map(
				(name, i) =>
					`<div style="position:absolute;left:${(i % 8) * tile}px;top:${Math.floor(i / 8) * tile}px;width:${tile}px;height:${tile}px;display:grid;place-items:center"><img src="${bare[name] ?? marks(name)}" width="164" height="164" style="border-radius:36px" alt=""></div>`
			)
			.join('')
	);
	logos.rect = (i) => {
		const x = (i % 8) * tile;
		const y = Math.floor(i / 8) * tile;
		return [x / (tile * 8), y / (tile * 2), (x + tile) / (tile * 8), (y + tile) / (tile * 2)];
	};

	surface(
		'tagline',
		1500,
		170,
		'<div class="type-line" style="height:170px;justify-content:center;font-size:96px;letter-spacing:-0.03em"><span class="words">Your socials, on steroids</span><span class="stop" style="color:var(--mark)">.</span></div>',
		{ live: true }
	);
	all.tagline.stop = all.tagline.element.querySelector('.stop');
	// The domain waits with a gap where its dot belongs: the film's last full stop lands there.
	surface(
		'urlLine',
		700,
		80,
		'<div class="url-line"><span>openpo</span><span class="url-slot"></span><span>st</span></div>'
	);
	surface(
		'logoFlat',
		512,
		512,
		'<img src="/assets/brand/logo.svg" width="512" height="512" alt="">'
	);
	all.urlLine.slot = all.urlLine.element.querySelector('.url-slot');
	surface(
		'urlNote',
		1100,
		60,
		'<div style="height:60px;display:flex;align-items:center;justify-content:center;font-size:40px;letter-spacing:-0.015em;color:var(--muted);white-space:nowrap">Open source. Hosted or self-hosted.</div>'
	);
	return all;
}
