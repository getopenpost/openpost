import { describe, expect, it } from 'vitest';
import { mediaInitialLoading, type MediaInitialLoadingState } from './media-initial-loading';

const pending: MediaInitialLoadingState = {
	workspaceLoading: false,
	hasWorkspace: true,
	mediaReady: false,
	mediaSettled: false,
	hubReady: false,
	hubSettled: false
};

describe('Media initial loading boundary', () => {
	it('stays active until asymmetric cold reads both settle', () => {
		expect(mediaInitialLoading({ ...pending, workspaceLoading: true })).toBe(true);
		expect(mediaInitialLoading({ ...pending, mediaReady: true })).toBe(true);
		expect(mediaInitialLoading({ ...pending, hubReady: true })).toBe(true);
		expect(mediaInitialLoading({ ...pending, mediaReady: true, hubReady: true })).toBe(false);
	});

	it('renders failures and keeps cached background refreshes immediate', () => {
		expect(mediaInitialLoading({ ...pending, mediaSettled: true, hubSettled: true })).toBe(false);
		expect(
			mediaInitialLoading({
				...pending,
				mediaReady: true,
				hubReady: true,
				mediaSettled: false,
				hubSettled: false
			})
		).toBe(false);
		expect(mediaInitialLoading({ ...pending, hasWorkspace: false })).toBe(false);
	});
});
