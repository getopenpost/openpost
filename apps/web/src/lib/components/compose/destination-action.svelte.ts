import { type VariantPost, makeVariantRecord, normalizeVariantRecord } from './draft-utils';
import { m } from '$lib/paraglide/messages';
import { SvelteMap } from 'svelte/reactivity';
import type { ComposerHost } from './composer-host';

type DestinationActionHost = Pick<
	ComposerHost,
	| 'error'
	| 'hasPendingPasteMediaUploads'
	| 'pasteMediaUploadBlocker'
	| 'selectedAccountIds'
	| 'selectedAccounts'
	| 'activeVariantAccountId'
	| 'posts'
	| 'variants'
	| 'captionMentionsByAccount'
	| 'scheduleOverridesByAccount'
	| 'joinedDescriptionKey'
	| 'updateAccountSetting'
	| 'scheduleAutoSave'
>;

/**
 * Copies the active account's text or media decisions to other selected destinations, keeping
 * inheritance explicit: fields the source still inherits stay inherited on each target.
 */
export class ComposerDestinationAction {
	private readonly host: DestinationActionHost;

	destinationActionOpen = $state(false);

	destinationCopyError = $state('');

	destinationAction = $state<'copy' | 'media'>('copy');

	destinationActionTargetIds = $state<string[]>([]);

	openDestinationAction = (action: 'copy' | 'media') => {
		if (!this.host.activeVariantAccountId) return;
		if (this.host.hasPendingPasteMediaUploads) {
			this.host.error = this.host.pasteMediaUploadBlocker();
			return;
		}
		this.destinationAction = action;
		this.destinationCopyError = '';
		this.destinationActionTargetIds = this.host.selectedAccountIds.filter(
			(accountId) => accountId !== this.host.activeVariantAccountId
		);
		this.destinationActionOpen = true;
	};

	toggleDestinationActionTarget = (accountId: string) => {
		if (this.host.hasPendingPasteMediaUploads || !this.host.selectedAccountIds.includes(accountId))
			return;
		this.destinationCopyError = '';
		this.destinationActionTargetIds = this.destinationActionTargetIds.includes(accountId)
			? this.destinationActionTargetIds.filter((id) => id !== accountId)
			: [...this.destinationActionTargetIds, accountId];
	};

	private inheritedVariantRecord = (): Record<string, VariantPost> => {
		return makeVariantRecord(this.host.posts);
	};

	applyDestinationAction = () => {
		const sourceAccountId = this.host.activeVariantAccountId;
		if (this.host.hasPendingPasteMediaUploads) {
			this.host.error = this.host.pasteMediaUploadBlocker();
			return;
		}
		if (!sourceAccountId || !this.host.selectedAccountIds.includes(sourceAccountId)) {
			this.destinationActionOpen = false;
			return;
		}
		const currentTargetIds = this.destinationActionTargetIds.filter(
			(accountId) =>
				accountId !== sourceAccountId && this.host.selectedAccountIds.includes(accountId)
		);
		this.destinationActionTargetIds = currentTargetIds;
		if (currentTargetIds.length === 0) return;
		const source = normalizeVariantRecord(
			this.host.variants.get(sourceAccountId) ?? this.inheritedVariantRecord(),
			this.host.posts
		);
		const sourceCaption = $state.snapshot(this.host.captionMentionsByAccount[sourceAccountId]);
		const sourceMentions = sourceCaption
			? [sourceCaption.mentions]
			: this.host.posts.map((post) => {
					const variant = source[post.key];
					return variant?.contentInherited ? post.mentions : variant?.mentions;
				});
		if (
			this.destinationAction === 'copy' &&
			currentTargetIds.some((targetId) => {
				const account = this.host.selectedAccounts.find((account) => account.id === targetId);
				return sourceMentions.some((metadata) => {
					return metadata?.spans.some(
						(span) =>
							(span.target.provider !== 'workspace' &&
								span.target.provider !== account?.platform) ||
							(span.target.provider === 'mastodon' &&
								span.target.authority?.replace(/\/$/, '').toLowerCase() !==
									account?.instance_url?.replace(/\/$/, '').toLowerCase())
					);
				});
			})
		) {
			this.destinationCopyError = m.compose_copy_mentions_incompatible();
			return;
		}
		const nextVariants = new SvelteMap(this.host.variants);
		const nextSchedules = { ...this.host.scheduleOverridesByAccount };

		for (const targetId of currentTargetIds) {
			const targetAccount = this.host.selectedAccounts.find((account) => account.id === targetId);
			const captionKey = targetAccount ? this.host.joinedDescriptionKey(targetAccount) : undefined;
			const target = normalizeVariantRecord(
				nextVariants.get(targetId) ?? this.inheritedVariantRecord(),
				this.host.posts
			);
			for (const post of this.host.posts) {
				const sourceVariant = source[post.key];
				const targetVariant = target[post.key];
				if (!sourceVariant || !targetVariant) continue;
				if (this.destinationAction === 'copy') {
					if (sourceCaption && !captionKey) {
						targetVariant.content = post === this.host.posts[0] ? sourceCaption.body : '';
						targetVariant.contentInherited = false;
						targetVariant.mentions =
							post === this.host.posts[0]
								? structuredClone(sourceCaption.mentions)
								: { version: 1, spans: [] };
					} else {
						targetVariant.content = sourceVariant.contentInherited
							? post.content
							: sourceVariant.content;
						targetVariant.contentInherited = sourceVariant.contentInherited;
						targetVariant.mentions = sourceVariant.contentInherited
							? post.mentions
							: (sourceVariant.mentions ?? { version: 1, spans: [] });
					}
				}
				targetVariant.mediaIds = sourceVariant.mediaInherited
					? [...post.mediaIds]
					: [...sourceVariant.mediaIds];
				targetVariant.mediaInherited = sourceVariant.mediaInherited;
			}
			if (
				Object.values(target).every((variant) => variant.contentInherited && variant.mediaInherited)
			) {
				nextVariants.delete(targetId);
			} else {
				nextVariants.set(targetId, target);
			}
			if (this.destinationAction === 'copy') {
				this.host.captionMentionsByAccount = {
					...this.host.captionMentionsByAccount,
					[targetId]:
						sourceCaption && captionKey
							? { ...structuredClone(sourceCaption), field: captionKey }
							: null
				};
				if (targetAccount && captionKey)
					this.host.updateAccountSetting(targetAccount, captionKey, sourceCaption?.body ?? '');
				if (this.host.scheduleOverridesByAccount[sourceAccountId]) {
					nextSchedules[targetId] = this.host.scheduleOverridesByAccount[sourceAccountId];
				} else {
					delete nextSchedules[targetId];
				}
			}
		}

		this.host.variants = nextVariants;
		this.host.scheduleOverridesByAccount = nextSchedules;
		this.destinationActionOpen = false;
		this.host.scheduleAutoSave();
	};

	constructor(host: DestinationActionHost) {
		this.host = host;
	}
}
