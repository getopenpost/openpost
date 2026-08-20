<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import * as Avatar from '$lib/components/ui/avatar';
	import PlatformIcon from '$lib/components/platform-icon.svelte';
	import { m } from '$lib/paraglide/messages';
	import { getLocaleTag } from '$lib/i18n';
	import { getPlatformName, getPlatformKey } from '$lib/utils';
	import type { RecommendationView } from '$lib/growth-helpers';
	import {
		formatCount,
		formatMutualCopy,
		mapReasonChips,
		followButtonState
	} from '$lib/growth-helpers';
	import ExternalLinkIcon from '@lucide/svelte/icons/external-link';
	import XIcon from '@lucide/svelte/icons/x';
	import UserIcon from '@lucide/svelte/icons/user';

	interface Props {
		recommendation: RecommendationView;
		position: number;
		onFollow: (id: string) => void;
		onDismiss: (id: string) => void;
		onOpenProfile: (rec: RecommendationView) => void;
	}

	let { recommendation, position: _position, onFollow, onDismiss, onOpenProfile }: Props = $props();

	const localeTag = $derived(getLocaleTag());
	const platformKey = $derived(getPlatformKey(recommendation.platform));
	const platformName = $derived(getPlatformName(recommendation.platform));
	const followState = $derived(followButtonState(recommendation.follow_state));
	const followLabel = $derived(
		followState.labelKey === 'grow_follow'
			? m.grow_follow()
			: followState.labelKey === 'grow_following_progress'
				? m.grow_following_progress()
				: followState.labelKey === 'grow_requested'
					? m.grow_requested()
					: m.grow_following()
	);

	const mutualCopy = $derived(
		formatMutualCopy(
			recommendation,
			(key, params) => {
				if (key === 'grow_followed_by') {
					// SAFETY: Paraglide generated catalog types this mutual-copy param; the helper forwards the exact shape.
					return m.grow_followed_by(params as never);
				}
				if (key === 'grow_followed_by_with_others') {
					// SAFETY: Paraglide generated catalog types this mutual-copy param; the helper forwards the exact shape.
					return m.grow_followed_by_with_others(params as never);
				}
				if (key === 'grow_also_followed_by') {
					// SAFETY: Paraglide generated catalog types this mutual-copy param; the helper forwards the exact shape.
					return m.grow_also_followed_by(params as never);
				}
				return '';
			},
			localeTag
		)
	);

	const reasonChips = $derived(
		mapReasonChips(recommendation, (key, params) => {
			if (key === 'grow_reason_follows_you') return m.grow_reason_follows_you();
			if (key === 'grow_reason_mutuals')
				// SAFETY: mutual-count chip param is always {count:number} per mapReasonChips contract.
				return m.grow_reason_mutuals(params as { count: number });
			if (key === 'grow_reason_suggested_bluesky') return m.grow_reason_suggested_bluesky();
			if (key === 'grow_reason_suggested_mastodon') return m.grow_reason_suggested_mastodon();
			if (key === 'grow_reason_similar') return m.grow_reason_similar();
			if (key === 'grow_reason_friends') return m.grow_reason_friends();
			if (key === 'grow_reason_popular') return m.grow_reason_popular();
			return '';
		})
	);

	const handle = $derived(
		recommendation.handle?.startsWith('@') ? recommendation.handle : `@${recommendation.handle}`
	);

	const hasBio = $derived(Boolean(recommendation.bio?.trim()));
	const bio = $derived(recommendation.bio?.trim() ?? '');
	const mutuals = $derived((recommendation.mutuals ?? []).slice(0, 3));

	function handleFollow() {
		onFollow(recommendation.id);
	}
	function handleDismiss() {
		onDismiss(recommendation.id);
	}
	function handleOpen() {
		onOpenProfile(recommendation);
	}
</script>

<article
	data-testid="growth-profile-card"
	data-recommendation-id={recommendation.id}
	class="flex min-w-0 flex-col gap-3 rounded-lg border bg-card p-4"
>
	<div class="flex min-w-0 items-start gap-3">
		<Avatar.Root class="size-10 shrink-0 rounded-full">
			{#if recommendation.avatar_url}
				<Avatar.Image src={recommendation.avatar_url} alt="" />
			{/if}
			<Avatar.Fallback
				class="rounded-full bg-muted text-xs font-medium text-muted-foreground"
				aria-hidden="true"
			>
				<UserIcon class="size-5" />
			</Avatar.Fallback>
		</Avatar.Root>
		<div class="min-w-0 flex-1">
			<div class="flex min-w-0 items-center gap-1.5">
				<h3 class="truncate text-sm leading-5 font-semibold">
					{recommendation.display_name || handle}
				</h3>
				<span class="inline-flex shrink-0 items-center" aria-hidden="true">
					<PlatformIcon platform={platformKey} class="size-3.5" />
				</span>
				<span class="sr-only">{platformName}</span>
			</div>
			<p class="truncate text-xs leading-4 text-muted-foreground" title={handle}>{handle}</p>
		</div>
	</div>

	{#if hasBio}
		<p class="line-clamp-3 min-w-0 text-sm leading-5 text-muted-foreground" title={bio}>
			{bio}
		</p>
	{/if}

	{#if mutuals.length > 0 && mutualCopy}
		<div class="flex min-w-0 items-center gap-2">
			<div class="flex shrink-0 -space-x-2" aria-hidden="true">
				{#each mutuals as mu (mu.RemoteID)}
					<Avatar.Root class="size-6 rounded-full border-2 border-card">
						{#if mu.AvatarURL}
							<Avatar.Image src={mu.AvatarURL} alt="" />
						{/if}
						<Avatar.Fallback
							class="rounded-full bg-muted text-[10px] font-medium text-muted-foreground"
						>
							{(mu.DisplayName || mu.Handle || '?').slice(0, 1).toUpperCase()}
						</Avatar.Fallback>
					</Avatar.Root>
				{/each}
			</div>
			<p class="min-w-0 truncate text-xs leading-4 text-muted-foreground">{mutualCopy}</p>
		</div>
	{/if}

	<div
		class="flex items-center gap-2 text-xs leading-4 text-muted-foreground"
		aria-label={`${formatCount(recommendation.followers_count, localeTag)} followers, ${formatCount(recommendation.following_count, localeTag)} following`}
	>
		<span class="tabular-nums"
			>{m.grow_followers_count({
				count: formatCount(recommendation.followers_count, localeTag)
			})}</span
		>
		<span aria-hidden="true">·</span>
		<span class="tabular-nums"
			>{m.grow_following_count({
				count: formatCount(recommendation.following_count, localeTag)
			})}</span
		>
	</div>

	{#if reasonChips.length > 0}
		<div class="flex flex-wrap gap-1.5" aria-label="Reasons">
			{#each reasonChips as chip (chip.key)}
				<span
					class="inline-flex items-center rounded-md border bg-muted px-2 py-1 text-xs leading-none font-medium text-muted-foreground"
				>
					{chip.label}
				</span>
			{/each}
		</div>
	{/if}

	<div class="mt-auto flex items-center gap-2">
		<Button
			variant={followState.variant}
			size="sm"
			class="min-h-11 flex-1 md:min-h-9"
			disabled={followState.disabled}
			onclick={handleFollow}
			aria-label={followState.disabled ? `${followLabel} ${handle}` : `Follow ${handle}`}
		>
			{followLabel}
		</Button>
		<Button
			variant="outline"
			size="icon"
			class="size-11 shrink-0 md:size-9"
			onclick={handleOpen}
			aria-label={m.grow_open_profile_label({ handle })}
			title={m.grow_open_profile()}
		>
			<ExternalLinkIcon class="size-4" />
		</Button>
		<Button
			variant="ghost"
			size="icon"
			class="size-11 shrink-0 md:size-9"
			onclick={handleDismiss}
			aria-label={m.grow_dismiss_label({ handle })}
			title={m.grow_dismiss()}
		>
			<XIcon class="size-4" />
		</Button>
	</div>
</article>

<style>
	@media (pointer: coarse) {
		:global(button) {
			min-height: 44px;
		}
	}
</style>
