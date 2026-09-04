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

	it('deduplicates repeated account messages', () => {
		expect(uniqueIssueMessages(['Fix the title.', ' Fix the title. ', '', undefined])).toEqual([
			'Fix the title.'
		]);
	});
});
