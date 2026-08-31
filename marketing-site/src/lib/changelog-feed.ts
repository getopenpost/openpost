import { parseChangelog } from '@openpost/changelog';

function escapeXml(value: string) {
	return value
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&apos;');
}

export function renderChangelogAtomFeed(markdown: string) {
	const releases = parseChangelog(markdown)
		.filter(
			(section) =>
				/^\d+\.\d+\.\d+$/u.test(section.label) && /^\d{4}-\d{2}-\d{2}$/u.test(section.date)
		)
		.slice(0, 10);
	if (releases.length === 0) throw new Error('The changelog has no dated stable releases');

	const updated = `${releases[0].date}T00:00:00Z`;
	const entries = releases
		.map((release) => {
			const url = `https://openpost.social/changelog#v${release.label}`;
			const summary = release.groups
				.filter((group) => group.items.length > 0)
				.map((group) => {
					const selected = group.items.slice(0, 5);
					const remaining = group.items.length - selected.length;
					return `${group.title}: ${selected.join(' ')}${remaining > 0 ? ` ${remaining} more ${group.title.toLowerCase()} entries in the full changelog.` : ''}`;
				})
				.join(' ');
			return `  <entry>
    <title>OpenPost v${escapeXml(release.label)}</title>
    <id>${escapeXml(url)}</id>
    <link href="${escapeXml(url)}" />
    <updated>${release.date}T00:00:00Z</updated>
    <content type="text">${escapeXml(summary)}</content>
  </entry>`;
		})
		.join('\n');

	return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>OpenPost changelog</title>
  <id>https://openpost.social/changelog</id>
  <link href="https://openpost.social/changelog" />
  <link href="https://openpost.social/changelog.xml" rel="self" type="application/atom+xml" />
  <updated>${updated}</updated>
${entries}
</feed>
`;
}
