import type { RequestHandler } from './$types';
import { renderPublicRobots } from '../../lib/robots';

export const prerender = true;

export const GET: RequestHandler = () => {
	return new Response(renderPublicRobots(), {
		headers: {
			'content-type': 'text/plain; charset=utf-8',
			'content-signal': 'search=yes, ai-input=yes, ai-train=yes, use=reference'
		}
	});
};
