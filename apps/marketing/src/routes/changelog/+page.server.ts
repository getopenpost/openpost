import { parseChangelog } from '@openpost/changelog';
import { readCanonicalChangelog } from '../../lib/changelog';
import type { PageServerLoad } from './$types';

export const prerender = true;

export const load = (async () => {
	const sections = parseChangelog(await readCanonicalChangelog())
		.filter((section) => section.groups.some((group) => group.items.length > 0))
		.slice(0, 4)
		.map((section) => ({
			label: section.label,
			date: section.date,
			intro: section.intro,
			groups: section.groups
				.filter((group) => group.items.length > 0)
				.map((group) => ({
					title: group.title,
					items: group.items.slice(0, 5),
					remaining: Math.max(0, group.items.length - 5)
				}))
		}));

	return { sections };
}) satisfies PageServerLoad;
