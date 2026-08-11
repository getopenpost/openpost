<script lang="ts">
	import { onMount } from 'svelte';
	import { captureTelemetryEvent } from '@openpost/telemetry';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { auth } from '$lib/stores/auth';
	import { client } from '$lib/api/client';
	import { workspaceCtx } from '$lib/stores/workspace.svelte';
	import { Button } from '$lib/components/ui/button';
	import StandaloneShell from '$lib/components/standalone-shell.svelte';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import RocketIcon from '@lucide/svelte/icons/rocket';
	import LoaderIcon from '@lucide/svelte/icons/loader-2';
	import { m } from '$lib/paraglide/messages';
	import { safeSameOriginRedirect } from '$lib/redirects';
	import {
		billingPeriodFromSearchParams,
		checkoutPathForPlan,
		hostedPlanFromSearchParams
	} from '$lib/billing';

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
		const target = checkoutPathForPlan(
			selectedPlanID(),
			billingPeriodFromSearchParams(page.url.searchParams)
		);
		const params = new URLSearchParams(target.split('?')[1] ?? '');
		const redirect = safeSameOriginRedirect(page.url, '');
		if (redirect) params.set('redirect', redirect);
		return `/checkout?${params}`;
	}

	function loginTarget() {
		return `/login?redirect=${encodeURIComponent(`${page.url.pathname}${page.url.search}`)}`;
	}

	function existingSignupTarget() {
		return safeSameOriginRedirect(page.url);
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
			if (
				workspaceCtx.workspaces.length > 0 &&
				page.url.searchParams.get('source') === 'signup' &&
				!preferredWorkspaceID
			) {
				await goto(resolve(existingSignupTarget() as '/'));
				return;
			}
			if (workspaceCtx.workspaces.length > 0) {
				await goto(resolve(afterOnboardingTarget() as '/'));
				return;
			}
			createdWorkspaceID = '';
			if (!managedAccount) await createWorkspace();
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

	async function createWorkspace() {
		if (isLoading) return;
		isLoading = true;
		createError = '';

		try {
			const { data, error: err } = await client.POST('/workspaces', {
				body: { name: 'My workspace' }
			});
			if (err || !data?.id) {
				throw new Error(
					(err as { detail?: string } | undefined)?.detail || m.onboarding_create_failed()
				);
			}
			createdWorkspaceID = data.id;
			captureTelemetryEvent('workspace created');
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
		{:else if createError}
			<InlineNotice tone="error" message={createError}>
				{#snippet actions()}
					<Button variant="outline" size="sm" onclick={() => void createWorkspace()}>
						{m.common_retry()}
					</Button>
				{/snippet}
			</InlineNotice>
		{:else}
			<div
				class="flex items-center justify-center gap-3 py-6 text-sm text-muted-foreground"
				role="status"
			>
				<LoaderIcon class="size-5 animate-spin text-primary" />
				{m.onboarding_loading()}
			</div>
		{/if}
	</div>
</StandaloneShell>
