import { describe, expect, it } from 'vitest';
import {
	composerIssues,
	isAccountSpecificIssue,
	issueMatchesProvider,
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
		const providerIssue = issue({
			provider: 'youtube',
			message: 'A title is required.'
		});
		expect(isAccountSpecificIssue(providerIssue)).toBe(true);
		expect(issueMatchesProvider(providerIssue, 'YouTube')).toBe(true);
		expect(
			composerIssues(
				[],
				[providerIssue],
				[
					{
						accountId: 'youtube-1',
						provider: 'YouTube',
						label: 'Channel · YouTube'
					}
				]
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

	it('deduplicates targeted capability blockers against matching server validation issues', () => {
		const capabilityBlocker = {
			id: 'capability-ig-1-0-media_count-too-many',
			message: 'Instagram carousel supports at most 20 media items.',
			severity: 'error' as const,
			code: 'media_count',
			accountId: 'ig-1',
			targetLabel: '@openpost · Instagram',
			provider: 'instagram'
		};
		const serverIssue = issue({
			code: 'media_count',
			provider: 'instagram',
			message: 'Instagram carousel supports at most 20 media items.'
		});

		const merged = composerIssues(
			[],
			[serverIssue],
			[{ accountId: 'ig-1', provider: 'instagram', label: '@openpost · Instagram' }],
			[capabilityBlocker]
		);
		expect(merged).toHaveLength(1);
		expect(merged[0]).toEqual(
			expect.objectContaining({
				code: 'media_count',
				accountId: 'ig-1',
				targetLabel: '@openpost · Instagram',
				message: 'Instagram carousel supports at most 20 media items.'
			})
		);
	});
});
