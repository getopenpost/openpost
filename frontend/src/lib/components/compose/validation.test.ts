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

	it('keeps provider issues inside the matching account menu', () => {
		const providerIssue = issue({ provider: 'youtube', message: 'A title is required.' });
		expect(isAccountSpecificIssue(providerIssue)).toBe(true);
		expect(issueMatchesProvider(providerIssue, 'YouTube')).toBe(true);
		expect(composerIssues([], [providerIssue])).toEqual([]);
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
