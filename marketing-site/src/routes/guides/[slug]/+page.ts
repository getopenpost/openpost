import { error } from '@sveltejs/kit';
import { marketingGuides, marketingPrerenderEntries } from '@openpost/social-images';
import type { PageLoad } from './$types';

export const prerender = true;
export const entries = () => marketingPrerenderEntries('/guides');
export const load: PageLoad = ({ params }) => {
	const guide = marketingGuides.find((candidate) => candidate.slug === params.slug);
	if (!guide) error(404, 'Guide not found');
	return { guide };
};
