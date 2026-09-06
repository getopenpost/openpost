import { marketingPrerenderEntries } from '@openpost/social-images';

export const prerender = true;

export function entries() {
	return marketingPrerenderEntries('/platforms');
}
