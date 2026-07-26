import type { RequestHandler } from './$types';
import { comparisons, platforms, tools } from '../_marketing';

export const prerender = true;

const siteUrl = 'https://openpost.social';
const routes = [
	{ path: '/', priority: '1.0' },
	{ path: '/pricing', priority: '0.9' },
	{ path: '/platforms', priority: '0.9' },
	{ path: '/compare', priority: '0.8' },
	{ path: '/tools', priority: '0.8' },
	{ path: '/security', priority: '0.7' },
	{ path: '/open-source', priority: '0.7' },
	{ path: '/changelog', priority: '0.6' },
	{ path: '/privacy', priority: '0.4' },
	{ path: '/terms', priority: '0.4' },
	...platforms.map((platform) => ({ path: `/platforms/${platform.slug}`, priority: '0.7' })),
	...comparisons.map((comparison) => ({ path: `/compare/${comparison.slug}`, priority: '0.6' })),
	...tools.map((tool) => ({ path: `/tools/${tool.slug}`, priority: '0.6' }))
];

function escapeXml(value: string) {
	return value
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&apos;');
}

export const GET: RequestHandler = () => {
	const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${routes
	.map(
		(route) => `  <url>
    <loc>${escapeXml(`${siteUrl}${route.path}`)}</loc>
    <priority>${route.priority}</priority>
  </url>`
	)
	.join('\n')}
</urlset>
`;

	return new Response(body, {
		headers: {
			'content-type': 'application/xml; charset=utf-8'
		}
	});
};
