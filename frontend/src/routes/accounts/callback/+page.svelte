<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { onMount } from 'svelte';
	import { client } from '$lib/api/client';
	import type { components } from '$lib/api/types';
	import StandaloneShell from '$lib/components/standalone-shell.svelte';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import { Button } from '$lib/components/ui/button';
	import { getPlatformName } from '$lib/utils';
	import { getLocaleTag } from '$lib/i18n';
	import { m } from '$lib/paraglide/messages';
	import CheckCircleIcon from 'lucide-svelte/icons/circle-check';
	import AlertTriangleIcon from 'lucide-svelte/icons/triangle-alert';

	type Selection = components['schemas']['AccountSelectionResponse'];
	type SelectionOption = components['schemas']['AccountSelectionOption'];
	type ErrorModel = components['schemas']['ErrorModel'];
	type CallbackState = 'loading' | 'direct_success' | 'selection' | 'selection_success' | 'error';

	let countdown = $state(5);
	let platform = $state('');
	let connectionId = $state('');
	let viewState = $state<CallbackState>('loading');
	let selection = $state.raw<Selection | null>(null);
	let selectedId = $state('');
	let loadingSelection = $state(false);
	let submitting = $state(false);
	let error = $state('');
	let timeoutId: number | undefined;
	let intervalId: number | undefined;

	let platformName = $derived(
		platform ? getPlatformName(platform) : m.accounts_callback_social_account()
	);
	let options = $derived(selection?.options ?? []);
	let shellTitle = $derived(
		viewState === 'selection'
			? m.accounts_callback_choose_heading({ platform: platformName })
			: viewState === 'error'
				? m.accounts_callback_attention_heading()
				: viewState === 'loading'
					? m.accounts_callback_finishing_heading()
					: m.accounts_callback_connected_heading()
	);
	let shellDescription = $derived(
		viewState === 'selection'
			? m.accounts_callback_choose_description()
			: viewState === 'error'
				? m.accounts_callback_attention_description()
				: m.accounts_callback_finalizing_description({ platform: platformName })
	);
	let expiresAtLabel = $derived.by(() => {
		if (!selection?.expires_at) return '';
		const expiresAt = new Date(selection.expires_at);
		if (Number.isNaN(expiresAt.getTime())) return '';
		return new Intl.DateTimeFormat(getLocaleTag(), {
			month: 'short',
			day: 'numeric',
			hour: 'numeric',
			minute: '2-digit'
		}).format(expiresAt);
	});

	onMount(() => {
		const params = new URLSearchParams(window.location.search);
		const status = params.get('status') ?? 'success';
		platform = params.get('platform') ?? '';
		connectionId = params.get('connection_id') ?? '';

		if (status === 'selection_required') {
			if (!connectionId) {
				showError(m.accounts_callback_missing_token());
			} else {
				void loadSelection(connectionId);
			}
		} else if (status === 'success' || !status) {
			showDirectSuccess();
		} else {
			showError(m.accounts_callback_failed_restart());
		}

		return () => {
			clearRedirectTimers();
		};
	});

	function clearRedirectTimers() {
		if (intervalId) window.clearInterval(intervalId);
		if (timeoutId) window.clearTimeout(timeoutId);
		intervalId = undefined;
		timeoutId = undefined;
	}

	function startRedirectCountdown() {
		clearRedirectTimers();
		countdown = 5;
		intervalId = window.setInterval(() => {
			if (countdown > 1) {
				countdown -= 1;
			}
		}, 1000);

		timeoutId = window.setTimeout(() => {
			goto(resolve('/accounts'));
		}, 5000);
	}

	function showDirectSuccess() {
		viewState = 'direct_success';
		startRedirectCountdown();
	}

	function showError(message: string) {
		clearRedirectTimers();
		error = message;
		viewState = 'error';
	}

	async function loadSelection(id: string) {
		clearRedirectTimers();
		loadingSelection = true;
		error = '';
		viewState = 'loading';

		try {
			const { data, error: apiError } = await client.GET('/accounts/selections/{connection_id}', {
				params: { path: { connection_id: id } }
			});

			if (apiError) {
				showError(errorMessage(apiError, m.accounts_callback_selection_expired()));
				return;
			}

			if (!data || !data.options?.length) {
				showError(m.accounts_callback_no_options());
				return;
			}

			platform = data.platform || platform;
			selection = data;
			selectedId = '';
			viewState = 'selection';
		} catch (requestError) {
			showError(transportErrorMessage(requestError, m.accounts_callback_selection_load_failed()));
		} finally {
			loadingSelection = false;
		}
	}

	async function completeSelection() {
		if (!selectedId) {
			error = m.accounts_callback_choose_required();
			return;
		}

		submitting = true;
		error = '';

		try {
			const { error: apiError } = await client.POST(
				'/accounts/selections/{connection_id}/complete',
				{
					params: { path: { connection_id: connectionId } },
					body: { selection_id: selectedId }
				}
			);

			if (apiError) {
				error = errorMessage(apiError, m.accounts_callback_selection_save_failed());
				return;
			}

			viewState = 'selection_success';
			startRedirectCountdown();
		} catch (requestError) {
			error = transportErrorMessage(requestError, m.accounts_callback_selection_save_failed());
		} finally {
			submitting = false;
		}
	}

	function errorMessage(apiError: ErrorModel, fallback: string) {
		return apiError.detail || apiError.title || fallback;
	}

	function transportErrorMessage(requestError: unknown, fallback: string) {
		if (requestError instanceof Error && requestError.message.trim()) {
			return `${fallback} ${requestError.message}`;
		}
		return fallback;
	}

	function goToAccounts() {
		clearRedirectTimers();
		goto(resolve('/accounts'));
	}

	function optionTitle(option: SelectionOption) {
		return option.display_name || option.username || option.id;
	}

	function optionSubtitle(option: SelectionOption) {
		const parts = [
			option.username ? `@${option.username.replace(/^@/, '')}` : '',
			option.kind ?? ''
		]
			.map((part) => part.trim())
			.filter(Boolean);
		return parts.join(' · ');
	}

	function metadataEntries(option: SelectionOption) {
		return Object.entries(option.extra ?? {}).filter(([, value]) => value);
	}
</script>

<svelte:head>
	<title>{m.accounts_callback_title()}</title>
</svelte:head>

<StandaloneShell
	title={shellTitle}
	description={shellDescription}
	maxWidth="lg"
	loading={viewState === 'loading'}
	loadingLabel={loadingSelection
		? m.accounts_callback_loading_choices()
		: m.accounts_callback_finishing()}
>
	{#if viewState === 'selection'}
		<form class="space-y-5" onsubmit={(event) => event.preventDefault()}>
			<p class="text-sm text-muted-foreground">
				{#if expiresAtLabel}
					{m.accounts_callback_expires({ date: expiresAtLabel })}
				{:else}
					{m.accounts_callback_choose_one({ platform: platformName })}
				{/if}
			</p>

			<fieldset class="space-y-3" disabled={submitting}>
				<legend class="sr-only">{m.accounts_callback_available({ platform: platformName })}</legend>
				{#each options as option (option.id)}
					<label
						class={[
							'flex cursor-pointer gap-3 rounded-md border p-4 transition-colors',
							selectedId === option.id
								? 'border-primary bg-primary/5 ring-2 ring-primary/20'
								: 'border-border hover:bg-muted/40'
						]}
					>
						<input
							class="mt-1 size-4 accent-primary"
							type="radio"
							name="selection_id"
							value={option.id}
							bind:group={selectedId}
							required
						/>
						{#if option.avatar_url}
							<img
								class="size-12 rounded-full border object-cover"
								src={option.avatar_url}
								alt=""
								loading="lazy"
							/>
						{:else}
							<div
								class="flex size-12 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-medium text-muted-foreground"
								aria-hidden="true"
							>
								{optionTitle(option).slice(0, 1).toUpperCase()}
							</div>
						{/if}
						<span class="min-w-0 flex-1 space-y-1">
							<span class="block font-medium text-foreground">{optionTitle(option)}</span>
							{#if optionSubtitle(option)}
								<span class="block text-sm text-muted-foreground">{optionSubtitle(option)}</span>
							{/if}
							{#if option.description}
								<span class="block text-sm text-muted-foreground">{option.description}</span>
							{/if}
							{#if metadataEntries(option).length}
								<span class="flex flex-wrap gap-2 pt-1">
									{#each metadataEntries(option) as [key, value] (key)}
										<span class="rounded-sm bg-muted px-2 py-1 text-xs text-muted-foreground">
											{key.replaceAll('_', ' ')}: {value}
										</span>
									{/each}
								</span>
							{/if}
						</span>
					</label>
				{/each}
			</fieldset>

			{#if error}
				<InlineNotice tone="error" message={error} />
			{/if}

			<div class="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
				<Button variant="outline" onclick={goToAccounts} disabled={submitting}
					>{m.common_cancel()}</Button
				>
				<Button onclick={completeSelection} disabled={submitting || !selectedId}>
					{submitting ? m.accounts_callback_saving() : m.accounts_callback_connect_selected()}
				</Button>
			</div>
		</form>
	{:else if viewState === 'direct_success' || viewState === 'selection_success'}
		<div class="flex flex-col items-center gap-3 text-center" role="status" aria-live="polite">
			<CheckCircleIcon class="size-10 text-emerald-600" />
			<p class="text-sm text-muted-foreground">
				{countdown === 1
					? m.accounts_callback_redirect_one()
					: m.accounts_callback_redirect_many({ count: countdown })}
			</p>
			<p class="max-w-md text-sm text-muted-foreground">
				{m.accounts_callback_completed()}
			</p>
			<Button onclick={goToAccounts}>{m.accounts_callback_go_now()}</Button>
		</div>
	{:else}
		<div class="flex flex-col items-center gap-4 text-center">
			<AlertTriangleIcon class="size-10 text-destructive" />
			<InlineNotice tone="error" message={error} class="w-full text-left" />
			<Button onclick={goToAccounts}>{m.accounts_callback_back()}</Button>
		</div>
	{/if}
</StandaloneShell>
