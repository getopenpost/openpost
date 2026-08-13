import { describe, expect, it } from 'vitest';
import {
	composerIssues,
	isAccountSpecificIssue,
	issueMatchesProvider,
	uniqueIssueMessages,
	type ValidationIssue
} from './validation';

function issue(overrides: Partial<ValidationIssue> = {}): ValidationIssue {
	return {
		code: 'test',
		fallback_message: 'Test issue',
		message: 'Test issue',
		severity: 'error',
		...overrides
	};
}

describe('composer validation placement', () => {
	it('keeps generic issues beside the account control', () => {
		expect(composerIssues(['Choose at least one account.'], [issue()])).toEqual([
			expect.objectContaining({ message: 'Choose at least one account.', severity: 'error' }),
			expect.objectContaining({ message: 'Test issue', severity: 'error' })
		]);
	});

	it('keeps provider issues in the summary with the matching destination target', () => {
		const providerIssue = issue({ provider: 'youtube', message: 'A title is required.' });
		expect(isAccountSpecificIssue(providerIssue)).toBe(true);
		expect(issueMatchesProvider(providerIssue, 'YouTube')).toBe(true);
		expect(
			composerIssues(
				[],
				[providerIssue],
				[{ accountId: 'youtube-1', provider: 'YouTube', label: 'Channel · YouTube' }]
			)
		).toEqual([
			expect.objectContaining({
				message: 'A title is required.',
				accountId: 'youtube-1',
				targetLabel: 'Channel · YouTube'
			})
		]);
	});

	it('keeps the same provider failure attached to each affected destination', () => {
		const providerIssue = issue({
			provider: 'x',
			field: 'body',
			segment_id: 'segment-2',
			message: 'Text is too long.'
		});

		expect(
			composerIssues(
				[],
				[providerIssue],
				[
					{ accountId: 'x-1', provider: 'x', label: '@one · X' },
					{ accountId: 'x-2', provider: 'x', label: '@two · X' }
				]
			)
		).toEqual([
			expect.objectContaining({
				accountId: 'x-1',
				targetLabel: '@one · X',
				field: 'body',
				segmentId: 'segment-2'
			}),
			expect.objectContaining({ accountId: 'x-2', targetLabel: '@two · X' })
		]);
	});

	it('includes account runtime blockers without flattening their target', () => {
		expect(
			composerIssues(
				[],
				[],
				[],
				[
					{
						id: 'readiness-youtube-1',
						message: 'Reconnect this channel before publishing.',
						accountId: 'youtube-1',
						targetLabel: 'Channel · YouTube',
						provider: 'youtube'
					}
				]
			)
		).toEqual([
			expect.objectContaining({
				accountId: 'youtube-1',
				targetLabel: 'Channel · YouTube',
				severity: 'error'
			})
		]);
	});

	it('collapses a shared media requirement beside the account control', () => {
		const youtubeIssue = issue({
			code: 'media_required',
			provider: 'youtube',
			message: 'Add a video.'
		});
		const linkedinIssue = issue({
			code: 'media_required',
			provider: 'linkedin',
			message: 'Add a video.'
		});

		expect(isAccountSpecificIssue(youtubeIssue)).toBe(false);
		expect(composerIssues([], [youtubeIssue, linkedinIssue])).toEqual([
			expect.objectContaining({ message: 'Add a video.', severity: 'error' })
		]);
	});

	it('keeps canonical segment issues in the global summary', () => {
		const segmentIssue = issue({ scope: 'segment', scope_id: 'segment-1' });
		expect(isAccountSpecificIssue(segmentIssue)).toBe(false);
		expect(composerIssues([], [segmentIssue])).toHaveLength(1);
	});

	it('deduplicates repeated account messages', () => {
		expect(uniqueIssueMessages(['Fix the title.', ' Fix the title. ', '', undefined])).toEqual([
			'Fix the title.'
		]);
	});

	it('keeps repeated destination issue identities unique in the global keyed list', () => {
		const repeatedIssue = {
			code: 'media_required',
			field: 'media',
			media_id: '',
			message: 'Add a video.',
			severity: 'error' as const
		};
		const youtubeIssue = issue({ ...repeatedIssue, provider: 'youtube' });
		const linkedinIssue = issue({ ...repeatedIssue, provider: 'linkedin' });

		expect(composerIssues([], [youtubeIssue, linkedinIssue])).toEqual([
			expect.objectContaining({ message: 'Add a video.', severity: 'error' })
		]);
		expect(
			uniqueIssueMessages(
				[youtubeIssue, linkedinIssue]
					.filter((candidate) => issueMatchesProvider(candidate, 'youtube'))
					.map((candidate) => candidate.message)
			)
		).toEqual(['Add a video.']);
	});
});
