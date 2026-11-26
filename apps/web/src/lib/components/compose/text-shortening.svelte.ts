import { type PostItem, type VariantPost, normalizeVariantRecord } from './draft-utils';
import { dismissToast, showToast } from '$lib/toast';
import { SvelteMap } from 'svelte/reactivity';
import { type PlatformLimit, uniquePlatformLimits, platformTextLength } from './platform-limits';
import { shortenPostText } from '$lib/post-builder/client';
import { m } from '$lib/paraglide/messages';
import { type ComposerIssue } from './validation';
import { getPlatformKey } from '$lib/utils';
import type { ComposerHost } from './composer-host';

interface ShortenUndo {
	postKey: string;
	accountId: string | null;
	after: string;
	post: PostItem;
	variant: VariantPost | null;
	toastId: string | number;
}

type TextShorteningHost = Pick<
	ComposerHost,
	| 'posts'
	| 'variants'
	| 'selectedWorkspaceId'
	| 'activeVariantAccountId'
	| 'selectedAccounts'
	| 'resolvedCapabilities'
	| 'getVariantContent'
	| 'getVariantPost'
	| 'handleVariantChange'
	| 'setPostContent'
	| 'composerIssuePostIndex'
	| 'scheduleAutoSave'
>;

/** AI shortening to a destination's text limit, with one toast-driven undo step. */
export class ComposerTextShortening {
	private readonly host: TextShorteningHost;

	shorteningKey = $state<string | null>(null);

	private shortenUndo = $state.raw<ShortenUndo | null>(null);

	private shortenTargetText = (postKey: string, accountId: string | null): string | null => {
		const post = this.host.posts.find((candidate) => candidate.key === postKey);
		if (!post) return null;
		return accountId ? (this.host.getVariantContent(accountId, postKey) ?? null) : post.content;
	};

	private clearShortenUndo = () => {
		if (!this.shortenUndo) return;
		dismissToast(this.shortenUndo.toastId);
		this.shortenUndo = null;
	};

	private undoShorten = () => {
		const undo = this.shortenUndo;
		if (!undo) return;
		this.shortenUndo = null;
		dismissToast(undo.toastId);
		if (this.shortenTargetText(undo.postKey, undo.accountId) !== undo.after) return;
		if (undo.accountId && undo.variant) {
			const next = new SvelteMap(this.host.variants);
			const record = normalizeVariantRecord(next.get(undo.accountId), this.host.posts);
			next.set(undo.accountId, {
				...record,
				[undo.postKey]: structuredClone($state.snapshot(undo.variant))
			});
			this.host.variants = next;
		} else if (!undo.accountId) {
			this.host.posts = this.host.posts.map((post) =>
				post.key === undo.postKey ? structuredClone($state.snapshot(undo.post)) : post
			);
		}
		this.host.scheduleAutoSave();
	};

	handleShortenUndoShortcut = (event: KeyboardEvent) => {
		if (!this.shortenUndo || event.shiftKey || event.altKey) return;
		if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'z') return;
		event.preventDefault();
		event.stopPropagation();
		this.undoShorten();
	};

	private shortenToLimit = async (options: {
		busyKey: string;
		postIndex: number;
		accountId: string | null;
		limit: PlatformLimit;
	}) => {
		if (this.shorteningKey) return;
		const post = this.host.posts[options.postIndex];
		if (!post) return;
		const accountId =
			options.accountId && this.host.getVariantContent(options.accountId, post.key) !== null
				? options.accountId
				: null;
		const text = accountId ? this.host.getVariantContent(accountId, post.key) : post.content;
		if (!text?.trim()) return;
		this.clearShortenUndo();
		this.shorteningKey = options.busyKey;
		const workspaceID = this.host.selectedWorkspaceId;
		try {
			const result = await shortenPostText({
				workspaceId: workspaceID,
				text,
				platform: options.limit.key,
				maxCharacters: options.limit.limit
			});
			if (workspaceID !== this.host.selectedWorkspaceId) return;
			if (this.shortenTargetText(post.key, accountId) !== text) return;
			if (!result.text || result.text === text) return;
			const previousPost = structuredClone($state.snapshot(post));
			const previousVariant = accountId
				? structuredClone($state.snapshot(this.host.getVariantPost(accountId, post.key) ?? null))
				: null;
			const index = this.host.posts.findIndex((candidate) => candidate.key === post.key);
			if (accountId) this.host.handleVariantChange(accountId, index, result.text);
			else this.host.setPostContent(index, result.text);
			const toastId = showToast(
				result.truncated
					? m.compose_shortened_truncated_toast()
					: m.compose_shortened_toast({ limit: options.limit.limit }),
				result.truncated ? 'warning' : 'success',
				{ actionLabel: m.compose_shorten_undo(), onAction: this.undoShorten, duration: 10000 }
			);
			this.shortenUndo = {
				postKey: post.key,
				accountId,
				after: result.text,
				post: previousPost,
				variant: previousVariant,
				toastId
			};
		} catch (cause) {
			showToast(
				cause instanceof Error && cause.message ? cause.message : m.compose_shorten_failed(),
				'error'
			);
		} finally {
			this.shorteningKey = null;
		}
	};

	shortenFromCounter = (index: number, limit: PlatformLimit) => {
		void this.shortenToLimit({
			busyKey: 'counter',
			postIndex: index,
			accountId: this.host.activeVariantAccountId,
			limit
		});
	};

	shortenFromIssue = (issue: ComposerIssue) => {
		const account =
			this.host.selectedAccounts.find((candidate) => candidate.id === issue.accountId) ??
			this.host.selectedAccounts.find(
				(candidate) => getPlatformKey(candidate.platform) === getPlatformKey(issue.provider ?? '')
			);
		const limit = account
			? uniquePlatformLimits([account], this.host.resolvedCapabilities)[0]
			: undefined;
		if (!account || !limit) {
			showToast(m.compose_shorten_failed(), 'error');
			return;
		}
		const resolvedIndex = this.host.composerIssuePostIndex(issue);
		const overflowIndex = this.host.posts.findIndex(
			(candidate) =>
				platformTextLength(
					limit.key,
					(this.host.variants.has(account.id)
						? this.host.getVariantContent(account.id, candidate.key)
						: null) ?? candidate.content
				) > limit.limit
		);
		const postIndex = resolvedIndex >= 0 ? resolvedIndex : Math.max(overflowIndex, 0);
		void this.shortenToLimit({ busyKey: issue.id, postIndex, accountId: account.id, limit });
	};

	constructor(host: TextShorteningHost) {
		this.host = host;
		// An edit after shortening makes Undo ambiguous; the editor's own history takes over.
		$effect(() => {
			const undo = this.shortenUndo;
			if (undo && this.shortenTargetText(undo.postKey, undo.accountId) !== undo.after)
				this.clearShortenUndo();
		});
	}
}
