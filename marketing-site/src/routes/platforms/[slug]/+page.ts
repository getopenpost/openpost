import { platforms } from '../../_marketing';

export const prerender = true;

export function entries() {
	return platforms.map((platform) => ({ slug: platform.slug }));
}
