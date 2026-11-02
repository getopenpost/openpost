// The film's clock. Picture timing and sound cues share this grid, so sync never drifts.
export const FPS = 60;
export const BPM = 120;
export const BEAT = 60 / BPM;
export const BAR = BEAT * 4;
// Bars inserted into the picture and the score together: [before this bar, how many].
// The release needs time to be read, and the workflow needs room to breathe.
const HOLDS = [
	[2, 1],
	[18, 1]
];
const held = (k) => k + HOLDS.reduce((sum, [at, extra]) => (k >= at ? sum + extra : sum), 0);
export const bar = (k) => held(k) * BAR;
export const DURATION = bar(41.5);

export const T = {
	// I. You shipped.
	typing: bar(0.25),
	stop: bar(0.875),
	fall: bar(1),
	splash: bar(1.25),
	tell: bar(2),
	// II. The flood.
	flood: bar(3),
	barrage: bar(6),
	wave: bar(7.75),
	// III. Under.
	under: bar(8),
	team: bar(8.5),
	gather: bar(9.75),
	rise: bar(10),
	gasp: bar(10.875),
	// IV. Up.
	breach: bar(11),
	word: bar(11.5),
	promise: bar(12),
	open: bar(13.5),
	// V. The product.
	workflow: bar(14),
	composer: bar(18),
	networks: bar(20),
	design: bar(23.5),
	cut: bar(25.5),
	schedule: bar(28),
	results: bar(30),
	inbox: bar(33.5),
	features: bar(35.5),
	logos: bar(37),
	converge: bar(38.5),
	// VI. The end.
	end: bar(39),
	period: bar(40.25)
};

export const cues = [];
export function cue(t, role, extra) {
	const entry = { t: Math.round(t * 1000) / 1000, role };
	if (extra) Object.assign(entry, extra);
	cues.push(entry);
}

// The score is arranged like the picture: every span plays stems of the source track from its own bar
// and shapes them. `at` is the source bar that lines up with `from`; levels are dB per stem, absent
// stems stay out. lp and hp are start and end cutoffs in Hz, wet is reverb, chop stutters per bar.
const spans = [
	{ from: 0, to: 1.25, at: 24, stems: { other: -6 }, lp: [520, 900], wet: 0.95 },
	{
		from: 1.25,
		to: 3,
		at: 25.25,
		stems: { other: -2, bass: -5 },
		lp: [900, 3000],
		wet: 0.4
	},
	{
		from: 3,
		to: 5,
		at: 29,
		stems: { drums: -5, bass: -3, other: -4 },
		lp: [3000, 5200],
		wet: 0.12
	},
	{
		from: 5,
		to: 6,
		at: 33,
		stems: { drums: -3, bass: -3, other: -4, vocals: -11 },
		hp: [60, 160],
		chop: 8
	},
	{
		from: 6,
		to: 7,
		at: 34,
		stems: { drums: -2, bass: -2, other: -4, vocals: -9 },
		hp: [160, 420],
		chop: 8
	},
	{
		from: 7,
		to: 7.75,
		at: 35,
		stems: { drums: -2, other: -3, vocals: -8 },
		hp: [420, 1400],
		chop: 16
	},
	{
		from: 8,
		to: 10,
		at: 100,
		stems: { drums: -4, bass: -5, other: 4, vocals: -2 },
		lp: [360, 460],
		wet: 0.8
	},
	{
		from: 10,
		to: 10.875,
		at: 102,
		stems: { drums: -3, bass: -3, other: 3, vocals: -3 },
		lp: [460, 3200],
		wet: 0.6
	},
	{ from: 11, to: 14, at: 101, stems: { drums: 0, bass: 0, other: 1, vocals: -1 }, sub: true },
	{ from: 14, to: 18, at: 105, stems: { drums: -1, bass: 0, other: 0 }, sub: true },
	{ from: 18, to: 20, at: 110, stems: { drums: -3, bass: -1, other: -1 }, sub: true },
	{ from: 20, to: 21, at: 112, stems: { drums: 0, bass: 0, other: 1, vocals: -2 }, sub: true },
	{
		from: 21,
		to: 21.5,
		at: 113,
		stems: { drums: -1, bass: 0, other: 1, vocals: -3 },
		lp: [18000, 900],
		wet: 0.2
	},
	{
		from: 21.5,
		to: 22.5,
		at: 113.5,
		stems: { drums: -1, bass: 0, other: 1, vocals: -3 },
		lp: [800, 1000],
		wet: 0.34
	},
	{
		from: 22.5,
		to: 23,
		at: 114.5,
		stems: { drums: 0, bass: 0, other: 1, vocals: -2 },
		lp: [1000, 18000],
		wet: 0.2
	},
	{ from: 23, to: 23.5, at: 115, stems: { drums: 0, bass: 0, other: 1, vocals: -2 }, sub: true },
	{
		from: 23.5,
		to: 25.5,
		at: 123.5,
		stems: { drums: -1, bass: 0, other: 0, vocals: -2 },
		sub: true
	},
	{ from: 25.5, to: 28, at: 125.5, stems: { drums: -1, bass: 0, other: 0 }, sub: true },
	{ from: 28, to: 30, at: 128, stems: { drums: -1, bass: 0, other: 0 }, sub: true },
	{ from: 30, to: 33.5, at: 84, stems: { drums: 0, bass: 0, other: 1, vocals: -1 }, sub: true },
	{
		from: 33.5,
		to: 35.5,
		at: 87.5,
		stems: { drums: -1, bass: 0, other: 0, vocals: -3 },
		sub: true
	},
	{
		from: 35.5,
		to: 37,
		at: 89.5,
		stems: { drums: 0, bass: 0, other: 1, vocals: -2 },
		sub: true,
		chop: 8
	},
	{ from: 37, to: 38.5, at: 91, stems: { drums: 0, bass: 0, other: 1, vocals: -2 }, sub: true },
	{ from: 38.5, to: 39, at: 92.5, stems: { drums: -2, other: 0 }, hp: [200, 1800] },
	{ from: 39, to: 40.5, at: 76.5, stems: { bass: 0, other: 1, vocals: -2 }, sub: true, wet: 0.3 },
	{ from: 40.5, to: 41.5, at: 78, stems: { other: -4, vocals: -8 }, lp: [6000, 320], wet: 0.7 }
];
export const score = spans.map((span) => ({ ...span, from: held(span.from), to: held(span.to) }));
