import { z } from 'zod';
import { firstComposerURL } from './composer-links';
import type { ComposerSettings } from './modes';

export const linkDraftSchema = z.object({
	destinations: z.record(
		z.string(),
		z.object({
			mode: z.enum(['post', 'custom', 'legacy']),
			url: z.string().optional()
		})
	)
});
export type LinkDraft = z.infer<typeof linkDraftSchema>;
export type LinkChoice = LinkDraft['destinations'][string];

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Reads the canonical API/draft JSON boundary.
export function readLinkDraft(settings: unknown): LinkDraft | undefined {
	const parsed = z.object({ link: linkDraftSchema }).safeParse(settings);
	return parsed.success ? parsed.data.link : undefined;
}

export function linkChoice(value: LinkDraft | undefined, accountID: string): LinkChoice {
	return value ? (value.destinations[accountID] ?? { mode: 'post' }) : { mode: 'legacy' };
}

export function linkURL(
	value: LinkDraft | undefined,
	accountID: string,
	body: string,
	settings: ComposerSettings
): string {
	const choice = linkChoice(value, accountID);
	if (choice.mode === 'post') return firstComposerURL(body);
	if (choice.mode === 'custom') return choice.url?.trim() ?? '';
	return String(settings.url || settings.link_url || firstComposerURL(body));
}

export function resolveLinkPreview(
	value: LinkDraft | undefined,
	accountID: string,
	provider: string,
	body: string,
	settings: ComposerSettings,
	mediaCount: number
): ComposerSettings {
	if (linkChoice(value, accountID).mode === 'legacy') return settings;
	const next: ComposerSettings = { ...settings, url: '', link_url: '' };
	const target = linkURL(value, accountID, body, settings);
	if (!target || mediaCount) return next;
	if (provider === 'bluesky') {
		if (!next.quote_url) next.link_url = target;
	} else if (
		['linkedin', 'facebook', 'threads', 'x', 'mastodon', 'pixelfed', 'lemmy', 'piefed'].includes(
			provider
		)
	) {
		if (!(linkChoice(value, accountID).mode === 'post' && next.poll_options)) next.url = target;
	}
	return next;
}
