import { tools } from '../../_marketing';

export const prerender = true;

export function entries() {
	return tools.map((tool) => ({ slug: tool.slug }));
}
