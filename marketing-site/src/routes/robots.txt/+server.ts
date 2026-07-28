import type { RequestHandler } from './$types';

export const prerender = true;

export const GET: RequestHandler = () => {
	return new Response(
		['User-agent: *', 'Allow: /', '', 'Sitemap: https://openpost.social/sitemap.xml', ''].join(
			'\n'
		),
		{
			headers: {
				'content-type': 'text/plain; charset=utf-8'
			}
		}
	);
};
