import { expect, it } from 'vitest';
import { suggestRetakes } from './retake-suggestions';
import type { TranscriptSourceWord } from './speech-cleanup';

function words(text: string, start = 0, sourceItemId = 'clip'): TranscriptSourceWord[] {
	return text.split(' ').map((text, index) => ({
		id: `${sourceItemId}:${start}:${index}`,
		mediaId: 'recording',
		sourceItemId,
		subtitleItemId: 'captions',
		cueId: 'cue',
		wordId: String(index),
		text,
		start: start + index * 0.4,
		end: start + index * 0.4 + 0.3
	}));
}

it('offers the earlier interrupted start with actual review context and preserves the restart', () => {
	const transcript = [
		...words('Today we shipped a faster editor with wrong sorry', 10),
		...words('Today we shipped a faster editor with instant previews.', 14.5)
	];
	const result = suggestRetakes(transcript);
	expect(result).toHaveLength(1);
	expect(result[0]).toMatchObject({
		mediaId: 'recording',
		sourceItemId: 'clip',
		start: 10,
		end: 14.42,
		repeatedText: 'Today we shipped a faster editor with',
		beforeText: 'Today we shipped a faster editor with wrong sorry',
		afterText: 'Today we shipped a faster editor with instant previews.'
	});
	expect(transcript.map((word) => word.text).join(' ')).toContain('wrong sorry Today');
});

it.each([
	['short conversational phrase', 'You know', 'You know this works.', 1.5],
	[
		'emphasis without a pause',
		'This is very important',
		'This is very important for everyone.',
		1.6
	],
	[
		'complete repeated sentence',
		'The new editor saves time.',
		'The new editor saves time. Try it.',
		3
	],
	['low-information repetition', 'very very very very', 'very very very very good.', 2.5],
	[
		'distant repetition',
		'Today we shipped a faster editor',
		'Today we shipped a faster editor for everyone.',
		30
	]
])('does not suggest cutting %s', (_name, before, after, restart) => {
	expect(suggestRetakes([...words(before), ...words(after, restart)])).toEqual([]);
});

it('never combines separate media, separate instances, or unassigned source words', () => {
	const before = words('Today we shipped a faster editor');
	const after = words('Today we shipped a faster editor for everyone.', 3.5);
	for (const change of [
		{ sourceItemId: 'other-clip' },
		{ mediaId: 'other-recording' },
		{ sourceItemId: undefined }
	]) {
		expect(suggestRetakes([...before, ...after.map((word) => ({ ...word, ...change }))])).toEqual(
			[]
		);
	}
});

it('rejects overlapping timings and produces independently selectable ranges for successive starts', () => {
	const first = words('Today we shipped a faster editor');
	const second = words('Today we shipped a faster editor', 3.5);
	const final = words('Today we shipped a faster editor for everyone.', 7);
	const result = suggestRetakes([...first, ...second, ...final]);
	expect(result.map(({ start, end }) => [start, end])).toEqual([
		[0, 3.42],
		[3.5, 6.92]
	]);
	expect(new Set(result.map(({ id }) => id)).size).toBe(2);
	expect(
		suggestRetakes([...first, ...words('Today we shipped a faster editor for everyone.', 1)])
	).toEqual([]);
});
