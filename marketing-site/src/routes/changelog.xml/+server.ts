import type { RequestHandler } from './$types';
import { readCanonicalChangelog } from '../../lib/changelog';
import { renderChangelogAtomFeed } from '../../lib/changelog-feed';

export const prerender = true;

export const GET: RequestHandler = async () => {
	return new Response(renderChangelogAtomFeed(await readCanonicalChangelog()), {
		headers: {
			'content-type': 'application/atom+xml; charset=utf-8'
		}
	});
};
