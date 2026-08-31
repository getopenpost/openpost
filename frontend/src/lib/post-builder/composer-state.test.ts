import { describe, expect, test } from 'vitest';
import type { PostItem, VariantPost } from '$lib/components/compose/draft-utils';
import { composerBuildFingerprint } from './composer-state';

function fingerprint(
	posts: PostItem[],
	variants: ReadonlyMap<string, Record<string, VariantPost>> = new Map()
) {
	return composerBuildFingerprint({
		posts,
		variants,
		linkUrl: 'https://openpost.app',
		accountIds: ['account-b', 'account-a'],
		requestedOutputProfiles: { 'account-b': 'x.thread', 'account-a': 'linkedin.post' },
		formatLockedByAccount: { 'account-b': true, 'account-a': true }
	});
}

describe('composer build fingerprint', () => {
	test('stays stable when persisted segments receive different keys', () => {
		const before = fingerprint(
			[{ key: 'temporary-key', content: 'A durable idea', mediaIds: ['media-1'] }],
			new Map([
				[
					'account-a',
					{
						'temporary-key': {
							content: 'A native version',
							mediaIds: ['media-1'],
							contentInherited: false,
							mediaInherited: true
						}
					}
				]
			])
		);
		const after = fingerprint(
			[{ key: 'server-segment-id', content: 'A durable idea', mediaIds: ['media-1'] }],
			new Map([
				[
					'account-a',
					{
						'server-segment-id': {
							content: 'A native version',
							mediaIds: ['media-1'],
							contentInherited: false,
							mediaInherited: true
						}
					}
				]
			])
		);

		expect(after).toBe(before);
	});

	test('changes when a destination edit or output format changes', () => {
		const posts = [{ key: 'source', content: 'A durable idea', mediaIds: [] }];
		const before = fingerprint(posts);
		const afterEdit = fingerprint(
			posts,
			new Map([
				[
					'account-a',
					{
						source: {
							content: 'A user edit',
							mediaIds: [],
							contentInherited: false,
							mediaInherited: true
						}
					}
				]
			])
		);
		const afterFormat = composerBuildFingerprint({
			posts,
			variants: new Map(),
			linkUrl: 'https://openpost.app',
			accountIds: ['account-a', 'account-b'],
			requestedOutputProfiles: { 'account-a': 'linkedin.post', 'account-b': 'x.post' },
			formatLockedByAccount: { 'account-a': true, 'account-b': true }
		});

		expect(afterEdit).not.toBe(before);
		expect(afterFormat).not.toBe(before);
	});
});
