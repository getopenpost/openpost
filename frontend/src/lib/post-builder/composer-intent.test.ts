import { describe, expect, it } from 'vitest';
import { hasComposerIntent } from './composer-intent';

describe('hasComposerIntent', () => {
	it.each(['date', 'time', 'workspace_id', 'account_ids', 'builder_media', 'image_editor_return'])(
		'keeps %s deep links in the manual composer',
		(parameter) => {
			const url = new URL('https://openpost.test/');
			url.searchParams.set(parameter, 'value');

			expect(hasComposerIntent(url)).toBe(true);
		}
	);

	it('keeps prompt handoffs and active draft recovery in the manual composer', () => {
		const url = new URL('https://openpost.test/');

		expect(hasComposerIntent(url, { hasPendingPrompt: true })).toBe(true);
		expect(hasComposerIntent(url, { activeDraftId: 'draft-1' })).toBe(true);
	});

	it('allows the builder to become the default for a clean root route', () => {
		expect(hasComposerIntent(new URL('https://openpost.test/'))).toBe(false);
	});
});
