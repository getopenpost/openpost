import { describe, expect, it } from 'vitest';
import { parseComposerHandoffPayload } from './handoff-payload';

const payload = {
	posts: [{ key: 'post-1', content: 'Hello', mediaIds: ['media-1'] }],
	variants: [],
	active_post_index: 0,
	selected_account_ids: ['account-1'],
	selected_social_set_id: '',
	requested_output_profiles: { 'account-1': 'post' },
	format_locked_by_account: { 'account-1': true },
	schedule_overrides_by_account: {},
	active_variant_account_id: null,
	publication_id: 'publication-1',
	link_url: '',
	settings_by_account: { 'account-1': { enabled: true, labels: ['one', 'two'] } },
	segment_settings_by_post: {},
	media_settings_by_account: {},
	media_alt_texts: [['media-1', 'Alternative text']],
	media_mime_types: [['media-1', 'image/png']],
	media_sizes: [['media-1', 128]],
	selected_time: null,
	random_delay_override: 'default',
	repost_override: { mode: 'inherit' },
	revision: 3
};

describe('composer handoff payloads', () => {
	it('parses a complete stored composer payload', () => {
		expect(parseComposerHandoffPayload(payload)).toEqual(payload);
	});

	it('rejects malformed core content', () => {
		expect(
			parseComposerHandoffPayload({ ...payload, posts: [{ content: 'Missing key' }] })
		).toBeNull();
	});

	it('normalizes unsupported setting values', () => {
		const parsed = parseComposerHandoffPayload({
			...payload,
			settings_by_account: { 'account-1': { nested: { secret: true } } }
		});
		expect(parsed?.settings_by_account).toEqual({ 'account-1': { nested: '' } });
	});
});
