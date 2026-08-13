<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { getApiBase } from '$lib/stores/instance.svelte';
	import { IS_CAPACITOR } from '$lib/env';
	import type { OIDCProvider } from '$lib/api/client';
	import type { PurchaseSelection } from '$lib/purchase-choice';
	import { m } from '$lib/paraglide/messages';
	import BuildingIcon from '@lucide/svelte/icons/building-2';
	import LoaderIcon from '@lucide/svelte/icons/loader-2';

	let {
		providers,
		returnPath,
		disabled = false,
		signup = false,
		purchaseChoice,
		onerror
	}: {
		providers: OIDCProvider[];
		returnPath: string;
		disabled?: boolean;
		signup?: boolean;
		purchaseChoice?: PurchaseSelection | null;
		onerror?: (message: string) => void;
	} = $props();

	let loadingProviderID = $state('');

	function startURL(provider: OIDCProvider) {
		const base = getApiBase().replace(/\/$/, '');
		const query = new URLSearchParams({
			return_path: returnPath,
			...(signup
				? {
						signup: 'true',
						plan_id: purchaseChoice?.plan_id ?? '',
						billing_period: purchaseChoice?.billing_period ?? '',
						purchase_choice_token: purchaseChoice?.token ?? ''
					}
				: {}),
			...(IS_CAPACITOR ? { native: 'true' } : {})
		});
		return `${base}/auth/oidc/${encodeURIComponent(provider.id)}/start?${query}`;
	}

	async function start(provider: OIDCProvider) {
		loadingProviderID = provider.id;
		try {
			const url = startURL(provider);
			if (IS_CAPACITOR) {
				const { Browser } = await import('@capacitor/browser');
				await Browser.open({ url });
				return;
			}
			window.location.assign(url);
		} catch (cause) {
			loadingProviderID = '';
			onerror?.(cause instanceof Error ? cause.message : m.auth_sso_start_failed());
		}
	}
</script>

<div class="space-y-3">
	{#each providers as provider (provider.id)}
		<Button
			type="button"
			variant="outline"
			class="w-full gap-2"
			disabled={disabled || Boolean(loadingProviderID)}
			onclick={() => void start(provider)}
		>
			{#if loadingProviderID === provider.id}
				<LoaderIcon class="size-4 animate-spin" aria-hidden="true" />
			{:else if provider.id === 'google'}
				<svg class="size-4" viewBox="0 0 18 18" aria-hidden="true">
					<path
						fill="#4285F4"
						d="M17.64 9.205c0-.638-.057-1.252-.164-1.841H9v3.482h4.844a4.14 4.14 0 0 1-1.797 2.715v2.258h2.909c1.702-1.567 2.684-3.874 2.684-6.614Z"
					/>
					<path
						fill="#34A853"
						d="M9 18c2.43 0 4.468-.806 5.956-2.181l-2.91-2.258c-.805.54-1.835.859-3.046.859-2.344 0-4.328-1.585-5.037-3.714H.956v2.332A9 9 0 0 0 9 18Z"
					/>
					<path
						fill="#FBBC05"
						d="M3.963 10.706A5.42 5.42 0 0 1 3.681 9c0-.592.102-1.168.282-1.706V4.962H.956A9 9 0 0 0 0 9c0 1.452.347 2.827.956 4.038l3.007-2.332Z"
					/>
					<path
						fill="#EA4335"
						d="M9 3.58c1.321 0 2.507.454 3.44 1.346l2.581-2.582C13.464.892 11.426 0 9 0A9 9 0 0 0 .956 4.962l3.007 2.332C4.672 5.165 6.656 3.58 9 3.58Z"
					/>
				</svg>
			{:else}
				<BuildingIcon class="size-4" aria-hidden="true" />
			{/if}
			{m.auth_sso_continue_with({ provider: provider.name })}
		</Button>
	{/each}
</div>
