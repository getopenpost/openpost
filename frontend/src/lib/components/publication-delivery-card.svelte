<script lang="ts">
	import ExternalLinkIcon from '@lucide/svelte/icons/external-link';
	import PlatformIcon from '$lib/components/platform-icon.svelte';
	import type { components } from '$lib/api/types';
	import { Button } from '$lib/components/ui/button';
	import { getLocaleTag } from '$lib/i18n';
	import { m } from '$lib/paraglide/messages';
	import { getPlatformName } from '$lib/utils';
	import {
		deliveryRecoveryAction,
		deliveryStateLabel,
		deliveryStatusClass
	} from '$lib/delivery-presentation';

	type ApiRendition = components['schemas']['RenditionResponse'];
	type Rendition = Pick<
		ApiRendition,
		'id' | 'platform' | 'target_key' | 'status' | 'external_url' | 'delivery'
	>;

	let {
		rendition,
		destinationLabel,
		variant = 'card',
		retrying = false,
		onRetry,
		onManualResolution
	}: {
		rendition: Rendition;
		destinationLabel?: string;
		variant?: 'card' | 'compact';
		retrying?: boolean;
		onRetry?: (renditionID: string) => void | Promise<void>;
		onManualResolution?: (renditionID: string) => void | Promise<void>;
	} = $props();

	const delivery = $derived(rendition.delivery);
	const externalURL = $derived(delivery?.external_url || rendition.external_url);
	const presentedState = $derived(delivery?.state || rendition.status);
	const recoveryAction = $derived(deliveryRecoveryAction(delivery, rendition.status));

	function formatAttempt(value: string) {
		return new Intl.DateTimeFormat(getLocaleTag(), {
			dateStyle: 'medium',
			timeStyle: 'short'
		}).format(new Date(value));
	}
</script>

<article
	class={[
		'flex min-w-0 items-start gap-3',
		variant === 'card' ? 'rounded-xl border bg-card p-4' : 'py-2.5'
	]}
>
	<PlatformIcon platform={rendition.platform} class="mt-0.5 size-5 shrink-0" />
	<div class="min-w-0 flex-1">
		<p class="font-medium">{destinationLabel || getPlatformName(rendition.platform)}</p>
		{#if destinationLabel}
			<p class="mt-0.5 text-xs text-muted-foreground">{getPlatformName(rendition.platform)}</p>
		{/if}
		<p class={['mt-0.5 text-sm', deliveryStatusClass(presentedState)]}>
			{deliveryStateLabel(presentedState)}
		</p>
		{#if rendition.target_key}
			<p class="mt-1 font-mono text-xs break-all text-muted-foreground">
				{m.publication_delivery_target({ target: rendition.target_key })}
			</p>
		{/if}
		{#if delivery?.current_attempt_created_at}
			<p class="mt-2 text-xs text-muted-foreground">
				{m.publication_delivery_attempt_number({
					number: delivery.current_attempt_number,
					date: formatAttempt(delivery.current_attempt_created_at)
				})}
			</p>
		{/if}
		{#if delivery?.last_reconciled_at}
			<p class="mt-1 text-xs text-muted-foreground">
				{m.publication_delivery_reconciled({ date: formatAttempt(delivery.last_reconciled_at) })}
			</p>
		{:else if delivery?.next_reconciliation_at}
			<p class="mt-1 text-xs text-muted-foreground">
				{m.publication_delivery_reconciliation_due({
					date: formatAttempt(delivery.next_reconciliation_at)
				})}
			</p>
		{/if}
		{#if delivery?.error_kind && delivery?.error_code}
			<p class="mt-1 text-sm text-destructive">
				{m.publication_delivery_failure_detail({
					kind: delivery.error_kind,
					code: delivery.error_code
				})}
				{#if delivery.error_http_status}
					<span class="font-mono"> ({delivery.error_http_status})</span>
				{/if}
			</p>
		{:else if delivery?.error_kind || delivery?.error_code}
			<p class="mt-1 text-sm text-destructive">
				{delivery.error_kind || delivery.error_code}
			</p>
		{:else if delivery?.terminal_reason}
			<p class="mt-1 text-sm text-destructive">{delivery.terminal_reason}</p>
		{/if}
		{#if recoveryAction === 'retry' && onRetry}
			<Button class="mt-3" size="sm" disabled={retrying} onclick={() => onRetry?.(rendition.id)}>
				{retrying ? m.common_loading() : m.publication_delivery_retry()}
			</Button>
		{:else if recoveryAction === 'reconcile'}
			<p class="mt-2 text-sm text-muted-foreground">{m.publication_delivery_reconcile()}</p>
		{:else if recoveryAction === 'manual_resolution'}
			<p class="mt-2 text-sm text-muted-foreground">
				{m.publication_delivery_manual_resolution_help()}
			</p>
			{#if onManualResolution}
				<Button
					class="mt-3"
					variant="outline"
					size="sm"
					onclick={() => onManualResolution(rendition.id)}
				>
					{m.publication_delivery_review_destination()}
				</Button>
			{/if}
		{/if}
	</div>
	{#if externalURL}
		<Button
			href={externalURL}
			target="_blank"
			rel="noreferrer"
			variant="ghost"
			size="icon"
			aria-label={m.publication_view_on_platform({ platform: getPlatformName(rendition.platform) })}
		>
			<ExternalLinkIcon class="size-4" />
		</Button>
	{/if}
</article>
