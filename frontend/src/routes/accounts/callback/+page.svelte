<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { onMount } from 'svelte';
	import { client } from '$lib/api/client';
	import type { components } from '$lib/api/types';
	import PageContainer from '$lib/components/page-container.svelte';
	import { Button } from '$lib/components/ui/button';
	import {
		Card,
		CardContent,
		CardDescription,
		CardHeader,
		CardTitle
	} from '$lib/components/ui/card';
	import { getPlatformName } from '$lib/utils';

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

	let platformName = $derived(platform ? getPlatformName(platform) : 'social account');
	let options = $derived(selection?.options ?? []);
	let expiresAtLabel = $derived.by(() => {
		if (!selection?.expires_at) return '';
		const expiresAt = new Date(selection.expires_at);
		if (Number.isNaN(expiresAt.getTime())) return '';
		return new Intl.DateTimeFormat(undefined, {
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
				showError(
					'This account connection is missing its selection token. Start again from Accounts.'
				);
			} else {
				void loadSelection(connectionId);
			}
		} else if (status === 'success' || !status) {
			showDirectSuccess();
		} else {
			showError('OpenPost could not finish this account connection. Start again from Accounts.');
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
				showError(errorMessage(apiError, 'This account selection expired or could not be loaded.'));
				return;
			}

			if (!data || !data.options?.length) {
				showError(
					'This account connection did not return any selectable accounts. Start again from Accounts.'
				);
				return;
			}

			platform = data.platform || platform;
			selection = data;
			selectedId = '';
			viewState = 'selection';
		} catch (requestError) {
			showError(transportErrorMessage(requestError, 'This account selection could not be loaded.'));
		} finally {
			loadingSelection = false;
		}
	}

	async function completeSelection() {
		if (!selectedId) {
			error = 'Choose an account or page to continue.';
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
				error = errorMessage(apiError, 'OpenPost could not save that account selection.');
				return;
			}

			viewState = 'selection_success';
			startRedirectCountdown();
		} catch (requestError) {
			error = transportErrorMessage(
				requestError,
				'OpenPost could not save that account selection.'
			);
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
	<title>Account Connected - OpenPost</title>
</svelte:head>

<div class="flex min-h-screen items-center justify-center px-4 py-10">
	<PageContainer
		title={viewState === 'selection' ? `Choose ${platformName} account` : 'Account connected'}
		description={viewState === 'selection'
			? 'Select the account or page OpenPost should add to this workspace.'
			: `Your ${platformName} account connection is being finalized.`}
	>
		<div class="mx-auto max-w-2xl">
			<Card class="border-border/60 shadow-sm">
				{#if viewState === 'loading'}
					<CardHeader class="text-center" aria-live="polite">
						<div
							class="mx-auto h-12 w-12 animate-spin rounded-full border-2 border-muted border-t-primary"
						></div>
						<CardTitle
							>{loadingSelection ? 'Loading account choices' : 'Finishing connection'}</CardTitle
						>
						<CardDescription>Please wait while OpenPost checks this connection.</CardDescription>
					</CardHeader>
				{:else if viewState === 'selection'}
					<CardHeader>
						<CardTitle>Choose what to connect</CardTitle>
						<CardDescription>
							{#if expiresAtLabel}
								This pending connection expires {expiresAtLabel}.
							{:else}
								Choose one option to finish connecting {platformName}.
							{/if}
						</CardDescription>
					</CardHeader>
					<CardContent>
						<form class="space-y-5" onsubmit={(event) => event.preventDefault()}>
							<fieldset class="space-y-3" disabled={submitting}>
								<legend class="sr-only">Available {platformName} accounts</legend>
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
												<span class="block text-sm text-muted-foreground"
													>{optionSubtitle(option)}</span
												>
											{/if}
											{#if option.description}
												<span class="block text-sm text-muted-foreground">{option.description}</span
												>
											{/if}
											{#if metadataEntries(option).length}
												<span class="flex flex-wrap gap-2 pt-1">
													{#each metadataEntries(option) as [key, value] (key)}
														<span
															class="rounded-sm bg-muted px-2 py-1 text-xs text-muted-foreground"
														>
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
								<p
									class="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
								>
									{error}
								</p>
							{/if}

							<div class="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
								<Button variant="outline" onclick={goToAccounts} disabled={submitting}>
									Cancel
								</Button>
								<Button onclick={completeSelection} disabled={submitting || !selectedId}>
									{submitting ? 'Saving selection...' : 'Connect selected account'}
								</Button>
							</div>
						</form>
					</CardContent>
				{:else if viewState === 'direct_success' || viewState === 'selection_success'}
					<CardHeader class="text-center">
						<div
							class="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/12 text-3xl text-emerald-600"
						>
							✓
						</div>
						<CardTitle>Success</CardTitle>
						<CardDescription>
							Redirecting you back to accounts in {countdown} second{countdown === 1 ? '' : 's'}.
						</CardDescription>
					</CardHeader>
					<CardContent class="flex flex-col items-center gap-3 text-center">
						<p class="max-w-md text-sm text-muted-foreground">
							OpenPost finished the OAuth flow and saved the connected account. You will be taken
							back automatically.
						</p>
						<Button onclick={goToAccounts}>Go to accounts now</Button>
					</CardContent>
				{:else}
					<CardHeader class="text-center">
						<div
							class="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10 text-3xl text-destructive"
						>
							!
						</div>
						<CardTitle>Connection needs attention</CardTitle>
						<CardDescription>{error}</CardDescription>
					</CardHeader>
					<CardContent class="flex justify-center">
						<Button onclick={goToAccounts}>Back to accounts</Button>
					</CardContent>
				{/if}
			</Card>
		</div>
	</PageContainer>
</div>
