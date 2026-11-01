<script lang="ts">
	import {
		OpenPostQueryError,
		workspaceSettingsQueryKeys,
		workspaceSetupQueryOptions
	} from '@openpost/query-catalog';
	import { goto } from '$app/navigation';
	import { queryClient } from '$lib/query/client';
	import { workspaceSettingsQueryAPI } from '$lib/query/workspace-settings';
	import { resolveAppPath } from '$lib/app-path';
	import type { components } from '$lib/api/types';
	import { Button } from '$lib/components/ui/button';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import { ThemeIcon } from '$lib/themes/icons';
	import { m } from '$lib/paraglide/messages';
	import { ui } from '$lib/stores/ui.svelte';
	import { workspaceCtx } from '$lib/stores/workspace.svelte';

	type Setup = components['schemas']['WorkspaceSetupResponse'];
	type SetupStepID = NonNullable<Setup['steps']>[number]['id'];

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

	const canEdit = $derived(
		workspaceCtx.currentWorkspace?.id === workspaceID &&
			(workspaceCtx.currentWorkspace.can_edit ?? false)
	);

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

	function stepLabel(stepID: SetupStepID) {
		return stepID === 'subscription'
			? m.workspace_setup_subscription()
			: stepID === 'destination'
				? m.workspace_setup_destination()
				: stepID === 'composition'
					? m.workspace_setup_composition()
					: stepID === 'publication'
						? m.workspace_setup_publication()
						: m.workspace_setup_workspace();
	}

	/** The composer owns creating a post, so those steps open it through the shared entry. */
	function stepOpensComposer(stepID: SetupStepID) {
		return stepID === 'composition' || stepID === 'publication';
	}

	function stepHref(stepID: SetupStepID): string | null {
		if (stepID === 'workspace') return '/settings?tab=general#workspace-name';
		if (stepID === 'subscription') {
			if (setup?.next_action === 'resume_checkout' && setup.action_href) return setup.action_href;
			return '/settings?tab=plan';
		}
		if (stepID === 'destination') return '/accounts';
		return null;
	}

	/** The accounts surface is the connect destination; the settings tab redirect is stale. */
	const lineHref = $derived.by(() => {
		if (!setup?.action_href) return '';
		if (setup.next_action === 'connect_destination') return '/accounts';
		if (setup.next_action === 'create_publication') return '';
		return setup.action_href;
	});

	function startComposer() {
		if (!ui.startNewPost()) return;
		void goto(resolveAppPath('/'));
	}
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
	{#if context === 'composer'}
		{#if lineHref}
			<div class={wrapperClass} data-testid="workspace-setup-guide-composer">
				<p
					class="flex min-h-6 flex-wrap items-center gap-x-2 text-xs leading-5 text-muted-foreground"
				>
					<span class="min-w-0 flex-1">{description}</span>
					<a
						href={resolveAppPath(lineHref)}
						class="shrink-0 font-medium text-foreground underline underline-offset-4 hover:text-foreground/80 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
					>
						{actionLabel}
					</a>
				</p>
			</div>
		{/if}
	{:else if context === 'home'}
		<section
			data-testid="workspace-setup-guide-home"
			class="rounded-lg border p-4 sm:p-5"
			aria-labelledby="workspace-setup-heading-home"
		>
			<div class="min-w-0 space-y-1">
				<p class="text-xs text-muted-foreground">
					{m.workspace_setup_progress({
						completed: setup.completed_steps,
						total: setup.total_steps
					})}
				</p>
				<h2 id="workspace-setup-heading-home" class="text-base font-semibold">
					{m.workspace_setup_heading()}
				</h2>
			</div>
			<ol class="mt-4 space-y-1.5 text-sm">
				{#each setup.steps ?? [] as step, index (step.id)}
					{#if step.completed}
						<li class="flex min-h-11 items-center gap-2.5 text-muted-foreground">
							<span
								class="flex size-6 shrink-0 items-center justify-center rounded-full bg-success text-success-foreground"
							>
								<ThemeIcon role="check" class="size-3.5" />
							</span>
							{stepLabel(step.id)}
						</li>
					{:else if stepOpensComposer(step.id) && canEdit}
						<li>
							<button
								type="button"
								onclick={startComposer}
								class="flex min-h-11 w-full items-center gap-2.5 rounded-md font-medium hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
							>
								<span
									class="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground"
								>
									{index + 1}
								</span>
								{stepLabel(step.id)}
							</button>
						</li>
					{:else if stepHref(step.id)}
						<li>
							<a
								href={resolveAppPath(stepHref(step.id) ?? '')}
								class="flex min-h-11 items-center gap-2.5 rounded-md font-medium hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
							>
								<span
									class="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground"
								>
									{index + 1}
								</span>
								{stepLabel(step.id)}
							</a>
						</li>
					{:else}
						<li class="flex min-h-11 items-center gap-2.5 font-medium">
							<span
								class="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground"
							>
								{index + 1}
							</span>
							{stepLabel(step.id)}
						</li>
					{/if}
				{/each}
			</ol>
		</section>
	{:else}
		<div class={wrapperClass}>
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
									? 'flex size-6 items-center justify-center rounded-full bg-success text-success-foreground'
									: 'flex size-6 items-center justify-center rounded-full bg-primary text-primary-foreground'}
							>
								{#if step.completed}<ThemeIcon role="check" class="size-3.5" />{:else}{index +
										1}{/if}
							</span>
							{stepLabel(step.id)}
						</li>
					{/each}
				</ol>
			</section>
		</div>
	{/if}
{/if}
