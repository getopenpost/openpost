<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { auth } from '$lib/stores/auth';
	import { client } from '$lib/api/client';
	import { workspaceCtx } from '$lib/stores/workspace.svelte';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import StandaloneShell from '$lib/components/standalone-shell.svelte';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import RocketIcon from 'lucide-svelte/icons/rocket';
	import LoaderIcon from 'lucide-svelte/icons/loader-2';
	import { m } from '$lib/paraglide/messages';
	import { safeSameOriginRedirect } from '$lib/redirects';
	import {
		hostedPlanFromSearchParams,
		onboardingPathForPlan,
		settingsPathForPlan
	} from '$lib/billing';

	let workspaceName = $state('Personal');
	let isLoading = $state(false);
	let loadError = $state('');
	let createError = $state('');
	let authReady = $state(false);
	let pageLoading = $state(true);
	let managedAccount = $state(false);
	let managedOrganizationName = $state('');
	let createdWorkspaceID = '';
	let onboardingLoadSequence = 0;

	function selectedPlanID() {
		return hostedPlanFromSearchParams(page.url.searchParams);
	}

	function afterOnboardingTarget() {
		const redirect = safeSameOriginRedirect(page.url, '');
		if (redirect) return redirect;
		const planID = selectedPlanID();
		return settingsPathForPlan(planID);
	}

	function loginTarget() {
		return `/login?redirect=${encodeURIComponent(`${page.url.pathname}${page.url.search}`)}`;
	}

	onMount(() => {
		const unsubscribe = auth.subscribe((state) => {
			if (!state.isLoading && !authReady) {
				authReady = true;
				managedAccount = state.user?.is_managed ?? false;
				managedOrganizationName = state.user?.managed_organization_name ?? '';
				if (!state.isAuthenticated) {
					goto(resolve(loginTarget() as '/'));
					return;
				}
				void loadOnboardingState();
			}
		});
		return unsubscribe;
	});

	async function loadOnboardingState(preferredWorkspaceID = createdWorkspaceID) {
		const requestSequence = ++onboardingLoadSequence;
		pageLoading = true;
		loadError = '';
		try {
			await workspaceCtx.initialize(preferredWorkspaceID || undefined);
			if (requestSequence !== onboardingLoadSequence) return;
			if (workspaceCtx.workspaces.length > 0) {
				await goto(resolve(afterOnboardingTarget() as '/'));
				return;
			}
			createdWorkspaceID = '';
		} catch (e) {
			if (requestSequence !== onboardingLoadSequence) return;
			console.error('Failed to load onboarding workspace state:', e);
			loadError = preferredWorkspaceID
				? m.onboarding_workspace_refresh_failed()
				: m.onboarding_load_failed();
		} finally {
			if (requestSequence === onboardingLoadSequence) pageLoading = false;
		}
	}

	async function handleCreate(e: Event) {
		e.preventDefault();
		if (!workspaceName.trim()) return;

		isLoading = true;
		createError = '';

		try {
			const { data, error: err } = await client.POST('/workspaces', {
				body: { name: workspaceName.trim() }
			});
			if (err || !data?.id) {
				throw new Error(
					(err as { detail?: string } | undefined)?.detail || m.onboarding_create_failed()
				);
			}
			createdWorkspaceID = data.id;
			await loadOnboardingState(data.id);
		} catch (e) {
			createError = (e as Error).message;
		} finally {
			isLoading = false;
		}
	}
</script>

<svelte:head>
	<title>{m.onboarding_title()}</title>
</svelte:head>

<StandaloneShell
	title={m.onboarding_heading()}
	description={m.onboarding_description()}
	loading={pageLoading}
	loadingLabel={m.common_loading()}
>
	{#snippet icon()}
		<RocketIcon class="size-6" />
	{/snippet}

	<div class="space-y-4">
		{#if loadError}
			<div data-testid="onboarding-load-error">
				<InlineNotice tone="error" message={loadError}>
					{#snippet actions()}
						<Button variant="outline" size="sm" onclick={() => void loadOnboardingState()}>
							{m.common_retry()}
						</Button>
					{/snippet}
				</InlineNotice>
			</div>
		{:else if managedAccount}
			<InlineNotice
				tone="info"
				message={m.onboarding_managed_waiting({
					organization: managedOrganizationName || m.onboarding_managed_organization()
				})}
			/>
			<p class="text-sm leading-6 text-muted-foreground">
				{m.onboarding_managed_help()}
			</p>
		{:else}
			{#if createError}
				<InlineNotice tone="error" message={createError} />
			{/if}

			<form onsubmit={handleCreate} class="space-y-4">
				<div class="space-y-2">
					<Label for="workspace-name">{m.onboarding_workspace_name()}</Label>
					<Input
						type="text"
						id="workspace-name"
						bind:value={workspaceName}
						placeholder={m.onboarding_workspace_placeholder()}
						required
						autofocus
					/>
					<p class="text-sm text-muted-foreground">
						{m.onboarding_workspace_hint()}
					</p>
				</div>

				<Button type="submit" disabled={isLoading || !workspaceName.trim()} class="w-full">
					{#if isLoading}
						<LoaderIcon class="mr-2 size-4 animate-spin" />
						{m.onboarding_loading()}
					{:else}
						{m.onboarding_submit()}
					{/if}
				</Button>
			</form>
		{/if}
	</div>
</StandaloneShell>
