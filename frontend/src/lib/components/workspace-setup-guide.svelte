<script lang="ts">
	import {
		OpenPostQueryError,
		workspaceSettingsQueryKeys,
		workspaceSetupQueryOptions
	} from '@openpost/query-catalog';
	import { queryClient } from '$lib/query/client';
	import { workspaceSettingsQueryAPI } from '$lib/query/workspace-settings';
	import type { components } from '$lib/api/types';
	import { Button } from '$lib/components/ui/button';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import CheckIcon from '@lucide/svelte/icons/check';
	import { m } from '$lib/paraglide/messages';
	import { ui } from '$lib/stores/ui.svelte';

	type Setup = components['schemas']['WorkspaceSetupResponse'];

	interface Props {
		workspaceID: string;
		context?: 'home' | 'accounts' | 'composer';
		wrapperClass?: string;
	}

	let { workspaceID, context = 'home', wrapperClass }: Props = $props();
	let setup = $state.raw<Setup | null>(null);
	let loadedWorkspaceID = '';
	let loadedRevision = ui.workspaceSetupRevision;
	let requestSequence = 0;
	let loadError = $state('');

	async function loadSetup(options: { refresh?: boolean } = {}) {
		if (!workspaceID) return;
		const targetWorkspaceID = workspaceID;
		const queryOptions = workspaceSetupQueryOptions(workspaceSettingsQueryAPI, targetWorkspaceID);
		const cachedSetup = queryClient.getQueryData<Setup>(queryOptions.queryKey);
		if (targetWorkspaceID !== loadedWorkspaceID) {
			setup = cachedSetup ?? null;
			loadedWorkspaceID = cachedSetup === undefined ? '' : targetWorkspaceID;
		}
		const sequence = ++requestSequence;
		loadError = '';
		try {
			if (options.refresh) {
				await queryClient.invalidateQueries({
					queryKey: workspaceSettingsQueryKeys.setup(targetWorkspaceID),
					exact: true
				});
			}
			const data = await queryClient.fetchQuery(queryOptions);
			if (sequence !== requestSequence || workspaceID !== targetWorkspaceID) return;
			setup = data;
			loadedWorkspaceID = targetWorkspaceID;
		} catch (cause) {
			if (sequence !== requestSequence || workspaceID !== targetWorkspaceID) return;
			if (cause instanceof OpenPostQueryError && (cause.status === 401 || cause.status === 403)) {
				queryClient.removeQueries({
					queryKey: queryOptions.queryKey,
					exact: true
				});
				setup = null;
				loadedWorkspaceID = '';
			}
			loadError = cause instanceof Error ? cause.message : m.settings_action_failed();
		}
	}

	$effect(() => {
		const revision = ui.workspaceSetupRevision;
		if (revision !== loadedRevision) {
			loadedRevision = revision;
			void loadSetup({ refresh: true });
			return;
		}
		void loadSetup();
	});

	const actionLabel = $derived(
		setup?.next_action === 'name_workspace'
			? m.workspace_setup_name_workspace()
			: setup?.next_action === 'resume_checkout'
				? m.workspace_setup_resume_checkout()
				: setup?.next_action === 'connect_destination'
					? m.workspace_setup_connect_destination()
					: m.workspace_setup_create_publication()
	);
	const description = $derived(
		setup?.next_action === 'name_workspace'
			? m.workspace_setup_name_description()
			: setup?.next_action === 'resume_checkout'
				? m.workspace_setup_checkout_description()
				: setup?.next_action === 'connect_destination'
					? m.workspace_setup_destination_description()
					: m.workspace_setup_publication_description()
	);
</script>

<svelte:window onfocus={() => void loadSetup()} />

{#if loadError && (setup === null || setup.visible)}
	<InlineNotice tone={setup === null ? 'error' : 'warning'} message={loadError} class="mb-3">
		{#snippet actions()}
			<Button variant="outline" size="sm" onclick={() => void loadSetup({ refresh: true })}>
				{m.common_retry()}
			</Button>
		{/snippet}
	</InlineNotice>
{/if}

{#if setup?.visible && setup.action_href}
	<div class={wrapperClass}>
		{#if context === 'composer'}
			<section
				data-testid="workspace-setup-guide-composer"
				class="flex items-center gap-3 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2.5"
				aria-labelledby="workspace-setup-heading-composer"
			>
				<div class="min-w-0 flex-1">
					<h2 id="workspace-setup-heading-composer" class="truncate text-sm font-medium">
						{description}
					</h2>
					<p class="mt-0.5 text-xs text-muted-foreground">
						{m.workspace_setup_progress({
							completed: setup.completed_steps,
							total: setup.total_steps
						})}
					</p>
				</div>
				<Button
					href={setup.action_href}
					variant="focal"
					size="sm"
					class="min-h-11 shrink-0 sm:min-h-9"
				>
					{actionLabel}
				</Button>
			</section>
		{:else}
			<section
				data-testid={`workspace-setup-guide-${context}`}
				class="rounded-lg border border-primary/20 bg-primary/5 p-4 sm:p-5"
				aria-labelledby={`workspace-setup-heading-${context}`}
			>
				<div class="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
					<div class="min-w-0 space-y-1">
						<p class="text-sm font-medium text-primary">
							{m.workspace_setup_progress({
								completed: setup.completed_steps,
								total: setup.total_steps
							})}
						</p>
						<h2 id={`workspace-setup-heading-${context}`} class="text-base font-semibold">
							{m.workspace_setup_heading()}
						</h2>
						<p class="text-sm/6 text-muted-foreground">{description}</p>
					</div>
					<Button href={setup.action_href} variant="focal" class="min-h-11 shrink-0 sm:min-h-9"
						>{actionLabel}</Button
					>
				</div>
				<ol class="mt-4 grid gap-2 text-sm sm:grid-cols-3">
					{#each setup.steps ?? [] as step, index (step.id)}
						<li
							class={step.completed
								? 'flex items-center gap-2 text-muted-foreground'
								: 'flex items-center gap-2 font-medium'}
						>
							<span
								class={step.completed
									? 'flex size-6 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
									: 'flex size-6 items-center justify-center rounded-full bg-primary text-primary-foreground'}
							>
								{#if step.completed}<CheckIcon class="size-3.5" />{:else}{index + 1}{/if}
							</span>
							{step.id === 'subscription'
								? m.workspace_setup_subscription()
								: step.id === 'destination'
									? m.workspace_setup_destination()
									: step.id === 'composition'
										? m.workspace_setup_composition()
										: step.id === 'publication'
											? m.workspace_setup_publication()
											: m.workspace_setup_workspace()}
						</li>
					{/each}
				</ol>
			</section>
		{/if}
	</div>
{/if}
