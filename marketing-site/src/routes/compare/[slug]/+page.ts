import { comparisons } from '../../_marketing';

export const prerender = true;

export function entries() {
	return comparisons.map((comparison) => ({ slug: comparison.slug }));
}
