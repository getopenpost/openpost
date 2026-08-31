import { describe, expect, test } from 'bun:test';

import { renderChangelogAtomFeed } from './changelog-feed';

describe('changelog Atom identity', () => {
	test('moves current links without replaying historical entry IDs', () => {
		const feed = renderChangelogAtomFeed(`## [1.2.3] - 2026-08-31

### Changed

- Moved the public domain.
`);

		expect(feed).toContain('<id>https://openpost.social/changelog#v1.2.3</id>');
		expect(feed).toContain('<link href="https://openpo.st/changelog#v1.2.3" />');
		expect(feed).toContain('<id>https://openpost.social/changelog</id>');
		expect(feed).toContain(
			'<link href="https://openpo.st/changelog.xml" rel="self" type="application/atom+xml" />'
		);
	});
});
