import { describe, expect, it } from 'vitest';
import { safeFeedbackPath, sanitizeFeedbackErrorMessage } from './feedback-diagnostics';

describe('feedback diagnostics privacy', () => {
	it('keeps only a path and drops origins, query values, and fragments', () => {
		expect(
			safeFeedbackPath(
				'https://self-hosted.internal:8443/activity?oauth_code=secret#destination',
				'https://openpost.test'
			)
		).toBe('/publications');
		expect(safeFeedbackPath('/posts/draft?token=secret', 'https://openpost.test')).toBe(
			'/posts/draft'
		);
	});

	it('maps client errors to bounded categories without retaining source text or secrets', () => {
		expect(
			sanitizeFeedbackErrorMessage(
				'Failed to fetch https://10.0.0.4/post?token=secret with Authorization: Bearer abc'
			)
		).toBe('Network request failed');
		expect(
			sanitizeFeedbackErrorMessage('My unpublished post text accidentally reached an exception')
		).toBe('Client operation failed');
	});
});
