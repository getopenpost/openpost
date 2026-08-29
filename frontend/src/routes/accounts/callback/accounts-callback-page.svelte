<script lang="ts">
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { client } from '$lib/api/client';
	import type { components } from '$lib/api/types';
	import StandaloneShell from '$lib/components/standalone-shell.svelte';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import { Button } from '$lib/components/ui/button';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import * as RadioGroup from '$lib/components/ui/radio-group';
	import { getPlatformName } from '$lib/utils';
	import { getLocaleTag } from '$lib/i18n';
	import { m } from '$lib/paraglide/messages';
	import {
		accountManagementReturnHref,
		accountSetupHref,
		clearAccountManagementContinuation
	} from '$lib/account-management-route';
	import AlertTriangleIcon from '@lucide/svelte/icons/triangle-alert';
	import { resolveAppPath } from '$lib/app-path';

	type Selection = components['schemas']['AccountSelectionResponse'];
	type SelectionOption = components['schemas']['AccountSelectionOption'];
	type ErrorModel = components['schemas']['ErrorModel'];
	type CallbackState = 'loading' | 'selection' | 'error';

	let { navigate = goto }: { navigate?: typeof goto } = $props();

	let platform = $state('');
	let connectionId = $state('');
	let viewState = $state<CallbackState>('loading');
	let selection = $state.raw<Selection | null>(null);
	let selectedId = $state('');
	let selectedIds = $state<string[]>([]);
	let loadingSelection = $state(false);
	let submitting = $state(false);
	let error = $state('');

	let platformName = $derived(
		platform ? getPlatformName(platform) : m.accounts_callback_social_account()
	);
	let options = $derived(selection?.options ?? []);
	let allowsMultiple = $derived(platform === 'linkedin');
	let selectedCount = $derived(allowsMultiple ? selectedIds.length : selectedId ? 1 : 0);
	let shellTitle = $derived(
		viewState === 'selection'
			? m.accounts_callback_choose_heading({ platform: platformName })
			: viewState === 'error'
				? m.accounts_callback_attention_heading()
				: viewState === 'loading'
					? m.accounts_callback_finishing_heading()
					: m.accounts_callback_attention_heading()
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
		} else {
			showError(m.accounts_callback_failed_restart());
		}

		return undefined;
	});

	function showError(message: string) {
		error = message;
		viewState = 'error';
	}

	async function loadSelection(id: string) {
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
			selectedIds = [];
			viewState = 'selection';
		} catch (requestError) {
			const message =
				requestError instanceof Error && requestError.message.trim()
					? `${m.accounts_callback_selection_load_failed()} ${requestError.message}`
					: m.accounts_callback_selection_load_failed();
			showError(message);
		} finally {
			loadingSelection = false;
		}
	}

	async function completeSelection() {
		if (selectedCount === 0) {
			error = m.accounts_callback_choose_required();
			return;
		}

		submitting = true;
		error = '';

		try {
			const { data, error: apiError } = await client.POST(
				'/accounts/selections/{connection_id}/complete',
				{
					params: { path: { connection_id: connectionId } },
					body: allowsMultiple ? { selection_ids: selectedIds } : { selection_id: selectedId }
				}
			);

			if (apiError) {
				returnToAccounts(selection?.workspace_id ?? '');
				return;
			}
			if (!data?.workspace_id || !data.account_ids?.length) {
				error = m.accounts_callback_selection_save_failed();
				return;
			}

			if (data.feature_setup_required && data.new_account_ids?.length) {
				await navigate(
					resolveAppPath(
						accountSetupHref({
							workspaceID: data.workspace_id,
							accountIDs: data.account_ids,
							newAccountIDs: data.new_account_ids,
							openFreshComposer: data.open_fresh_composer
						})
					)
				);
				return;
			}

			viewState = 'loading';
			if (!data.open_fresh_composer) {
				await navigate(resolveAppPath(accountManagementReturnHref()));
				clearAccountManagementContinuation();
				return;
			}
			const query = new URLSearchParams({
				workspace_id: data.workspace_id,
				account_ids: data.account_ids.join(',')
			});
			await navigate(resolveAppPath(`/?${query.toString()}`));
		} catch (requestError) {
			returnToAccounts(selection?.workspace_id ?? '');
		} finally {
			submitting = false;
		}
	}

	function errorMessage(apiError: ErrorModel, fallback: string) {
		return apiError.detail || apiError.title || fallback;
	}

	function goToAccounts() {
		navigate(resolveAppPath(accountManagementReturnHref()));
		clearAccountManagementContinuation();
	}

	function returnToAccounts(workspaceID: string) {
		void navigate(resolveAppPath(accountManagementReturnHref('failed', workspaceID)));
		clearAccountManagementContinuation();
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

	function isSelected(optionId: string) {
		return allowsMultiple ? selectedIds.includes(optionId) : selectedId === optionId;
	}

	function toggleSelection(optionId: string) {
		selectedIds = selectedIds.includes(optionId)
			? selectedIds.filter((id) => id !== optionId)
			: [...selectedIds, optionId];
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
				{#if allowsMultiple}
					{m.accounts_callback_choose_many({ platform: platformName })}
				{:else if expiresAtLabel}
					{m.accounts_callback_expires({ date: expiresAtLabel })}
				{:else}
					{m.accounts_callback_choose_one({ platform: platformName })}
				{/if}
			</p>

			{#snippet optionCard(option: SelectionOption, multiple: boolean)}
				<label
					class={[
						'flex cursor-pointer gap-3 rounded-md border p-4 transition-colors',
						isSelected(option.id)
							? 'border-primary bg-primary/5 ring-2 ring-primary/20'
							: 'border-border hover:bg-muted/40'
					]}
				>
					{#if multiple}
						<Checkbox
							class="mt-1"
							checked={isSelected(option.id)}
							onCheckedChange={() => toggleSelection(option.id)}
						/>
					{:else}
						<RadioGroup.Item class="mt-1" value={option.id} aria-label={optionTitle(option)} />
					{/if}
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
			{/snippet}

			<fieldset class="space-y-3" disabled={submitting}>
				<legend class="sr-only">{m.accounts_callback_available({ platform: platformName })}</legend>
				{#if allowsMultiple}
					{#each options as option (option.id)}
						{@render optionCard(option, true)}
					{/each}
				{:else}
					<RadioGroup.Root
						bind:value={selectedId}
						name="selection_id"
						required
						disabled={submitting}
					>
						{#each options as option (option.id)}
							{@render optionCard(option, false)}
						{/each}
					</RadioGroup.Root>
				{/if}
			</fieldset>

			{#if error}
				<InlineNotice tone="error" message={error} />
			{/if}

			<div class="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
				<Button variant="outline" onclick={goToAccounts} disabled={submitting}
					>{m.common_cancel()}</Button
				>
				<Button onclick={completeSelection} disabled={submitting || selectedCount === 0}>
					{submitting
						? m.accounts_callback_saving()
						: allowsMultiple
							? m.accounts_callback_connect_selected_many({ count: selectedCount })
							: m.accounts_callback_connect_selected()}
				</Button>
			</div>
		</form>
	{:else}
		<div class="flex flex-col items-center gap-4 text-center">
			<AlertTriangleIcon class="size-10 text-destructive" />
			<InlineNotice tone="error" message={error} class="w-full text-left" />
			<Button onclick={goToAccounts}>{m.accounts_callback_back()}</Button>
		</div>
	{/if}
</StandaloneShell>
