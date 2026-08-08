<script lang="ts">
	import './layout.css';
	import { ModeWatcher } from 'mode-watcher';
	import { onMount } from 'svelte';
	import { auth } from '$lib/stores/auth';
	import { beforeNavigate, goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/stores';
	import * as Sidebar from '$lib/components/ui/sidebar';
	import SidebarLeft from '$lib/components/sidebar-left.svelte';
	import MobileBottomNav from '$lib/components/mobile-bottom-nav.svelte';
	import DayPostsModal from '$lib/components/day-posts-modal.svelte';
	import Logo from '$lib/components/Logo.svelte';
	import LanguageSwitcher from '$lib/components/language-switcher.svelte';
	import { IS_CAPACITOR } from '$lib/env';
	import { instanceStore, isInstanceConfigured } from '$lib/stores/instance.svelte';
	import { workspaceCtx } from '$lib/stores/workspace.svelte';
	import AppLoading from '$lib/components/app-loading.svelte';
	import { m } from '$lib/paraglide/messages';
	import { onboardingPathForPlan } from '$lib/billing';
	import { safeSameOriginRedirect } from '$lib/redirects';
	import { soundPreferences } from '$lib/stores/sound-preferences.svelte';
	import { feedbackDiagnostics } from '$lib/feedback-diagnostics';
	import FeedbackDialog from '$lib/components/feedback-dialog.svelte';
	import { captureWebReauthGrant, storeReauthGrant } from '$lib/auth/reauth';
	import { client } from '$lib/api/client';
	import { Toaster } from '$lib/components/ui/sonner';
	import { setUnsavedChanges, UnsavedChangesContext } from '$lib/unsaved-changes.svelte';
	import PublicHome from './_components/PublicHome.svelte';

	let { children } = $props();
	const unsavedChanges = setUnsavedChanges(new UnsavedChangesContext());

	beforeNavigate((navigation) => {
		if (!unsavedChanges.hasChanges) return;
		if (navigation.type === 'leave') return;
		if (currentPath === '/settings' && navigation.to?.url.pathname === '/settings') return;
		if (!unsavedChanges.confirmDiscard()) navigation.cancel();
	});

	function warnBeforeUnload(event: BeforeUnloadEvent) {
		if (!unsavedChanges.hasChanges) return;
		event.preventDefault();
		event.returnValue = '';
	}

	const instance = instanceStore();

	let authState = $derived($auth);
	let currentPath = $derived($page.url.pathname);
	let isPreviewRoute = $derived(currentPath === '/preview');
	let isPublicProfileRoute = $derived(currentPath.startsWith('/u/'));
	let isManagedEdition = $state(false);
	const publicRoutes = [
		'/login',
		'/register',
		'/verify-email',
		'/forgot-password',
		'/reset-password',
		'/account-deleted',
		'/connect',
		'/demo',
		'/demo/paraglide',
		'/preview',
		'/invite',
		'/impersonate',
		'/cli/authorize',
		'/oauth/authorize',
		'/studio',
		'/accounts/mastodon/callback',
		'/accounts/callback'
	];

	const standaloneRoutes = [
		'/onboarding',
		'/checkout',
		'/verify-email',
		'/legal-acceptance',
		'/preview',
		'/account-deleted',
		'/connect',
		'/invite',
		'/impersonate',
		'/cli/authorize',
		'/oauth/authorize',
		'/studio',
		'/accounts/mastodon/callback',
		'/accounts/callback'
	];
	let isStandaloneRoute = $derived(
		standaloneRoutes.includes(currentPath) ||
			isPublicProfileRoute ||
			currentPath === '/image-editor' ||
			currentPath.startsWith('/image-editor/') ||
			currentPath === '/video-editor' ||
			currentPath.startsWith('/video-editor/')
	);
	let isPublicImageEditorRoute = $derived(
		currentPath === '/image-editor' || currentPath.startsWith('/image-editor/local_design_')
	);
	let isPublicVideoEditorRoute = $derived(
		currentPath === '/video-editor' || currentPath.startsWith('/video-editor/')
	);
	let isPublicRoute = $derived(
		currentPath === '/' ||
			isPublicProfileRoute ||
			isPublicImageEditorRoute ||
			isPublicVideoEditorRoute ||
			publicRoutes.some((route) => currentPath.startsWith(route))
	);

	let needsOnboarding = $state(false);
	let onboardingChecked = $state(false);
	let onboardingCheckedPath = $state('');
	let onboardingCheckInFlightForPath = $state('');
	let ssoChallengeInFlight = $state(false);
	let routeOwnsWorkspaceBootstrap = $derived(
		currentPath === '/onboarding' || currentPath === '/checkout'
	);

	function authenticatedPublicTarget() {
		const target = safeSameOriginRedirect($page.url);
		if (target === '/login' || target.startsWith('/login?') || target.startsWith('/register')) {
			return '/';
		}
		return target;
	}

	function onboardingTarget() {
		const target = new URL(onboardingPathForPlan($page.url.searchParams.get('plan')), $page.url);
		const billingPeriod = $page.url.searchParams.get('billing_period');
		if (billingPeriod) target.searchParams.set('billing_period', billingPeriod);

		const redirect = safeSameOriginRedirect($page.url, '');
		if (redirect) target.searchParams.set('redirect', redirect);
		if (
			!redirect &&
			currentPath.startsWith('/image-editor/local_design_') &&
			$page.url.searchParams.get('import') === '1'
		) {
			target.searchParams.set('redirect', `${currentPath}${$page.url.search}`);
		}
		return `${target.pathname}${target.search}`;
	}

	function legalAcceptanceTarget() {
		const redirect = `${currentPath}${$page.url.search}`;
		return `/legal-acceptance?redirect=${encodeURIComponent(redirect)}`;
	}

	let pendingRedirect = $derived.by(() => {
		if (instance.isLoading || authState.isLoading) return null;

		if (IS_CAPACITOR && !isInstanceConfigured() && currentPath !== '/connect') {
			return '/connect';
		}

		const isOnboardingPage = currentPath === '/onboarding';
		if (!authState.isAuthenticated && !isPublicRoute && !isOnboardingPage) {
			return '/login';
		}

		if (!authState.isAuthenticated) return null;
		if (isPublicProfileRoute) return null;

		if (authState.user?.legal_acceptance_required) {
			return currentPath === '/legal-acceptance' ? null : legalAcceptanceTarget();
		}
		if (currentPath === '/legal-acceptance') {
			const target = safeSameOriginRedirect($page.url);
			return target === '/legal-acceptance' || target.startsWith('/legal-acceptance?')
				? '/'
				: target;
		}
		if (!onboardingChecked && !routeOwnsWorkspaceBootstrap) return null;

		if (needsOnboarding) {
			if (
				(isPublicImageEditorRoute || isPublicVideoEditorRoute) &&
				!(
					currentPath.startsWith('/image-editor/local_design_') &&
					$page.url.searchParams.get('import') === '1'
				)
			) {
				return null;
			}
			if (!isOnboardingPage && currentPath !== '/invite' && onboardingCheckedPath === currentPath) {
				return onboardingTarget();
			}
			return null;
		}

		if (currentPath === '/login' || currentPath === '/register') {
			return authenticatedPublicTarget();
		}

		return null;
	});

	onMount(() => {
		if (isPreviewRoute) return;
		isManagedEdition =
			document.querySelector<HTMLMetaElement>('meta[name="openpost-edition"]')?.content === 'cloud';
		captureWebReauthGrant();
		feedbackDiagnostics.initialize();
		soundPreferences.initialize();
		instance.initialize();
		auth.initialize({ optional: isPublicRoute });
		if (!IS_CAPACITOR) return;
		let removeURLListener: (() => Promise<void>) | undefined;
		void import('@capacitor/app').then(async ({ App }) => {
			const listener = await App.addListener('appUrlOpen', ({ url }) => {
				void completeNativeOIDC(url);
			});
			removeURLListener = () => listener.remove();
		});
		return () => {
			void removeURLListener?.();
		};
	});

	$effect(() => {
		feedbackDiagnostics.recordNavigation(currentPath);
	});

	$effect(() => {
		if (currentPath !== '/' || instance.isLoading || authState.isLoading) return;
		document.getElementById('openpost-managed-public-home')?.remove();
		document
			.querySelectorAll<HTMLElement>('[data-openpost-managed-home]')
			.forEach((element) => element.remove());
	});

	$effect(() => {
		if (pendingRedirect) void goto(resolve(pendingRedirect as '/'));
	});

	async function checkOnboarding(path: string) {
		if (!authState.isAuthenticated || authState.isLoading) return;
		onboardingCheckInFlightForPath = path;
		let nextNeedsOnboarding = false;
		try {
			await workspaceCtx.initialize();
			nextNeedsOnboarding = workspaceCtx.workspaces.length === 0;
			const workspace = workspaceCtx.currentWorkspace;
			if (workspace?.sso_required && !workspace.sso_authenticated) {
				if (!workspace.sso_identity_linked) {
					const securitySettings =
						currentPath === '/settings' && $page.url.searchParams.get('tab') === 'security';
					if (!securitySettings) {
						await goto(resolve('/settings?tab=security' as '/'));
						return;
					}
					nextNeedsOnboarding = false;
				} else {
					await startWorkspaceSSO(workspace.sso_provider_id);
					return;
				}
			}
		} catch {
			// Fail safe: if we cannot verify workspace state, keep user in onboarding flow.
			nextNeedsOnboarding = true;
		} finally {
			if (onboardingCheckInFlightForPath === path) {
				onboardingCheckInFlightForPath = '';
			}
		}
		if (path !== currentPath) return;
		needsOnboarding = nextNeedsOnboarding;
		onboardingChecked = true;
		onboardingCheckedPath = path;
	}

	async function startWorkspaceSSO(providerID: string | undefined) {
		if (!providerID || ssoChallengeInFlight) return;
		ssoChallengeInFlight = true;
		const returnPath = `${currentPath}${$page.url.search}`;
		const workspaceID = workspaceCtx.currentWorkspace?.id ?? '';
		const { data, error } = await client.POST('/auth/oidc/{provider_id}/reauth', {
			params: { path: { provider_id: providerID } },
			body: {
				action: `organization.access:${workspaceID}`,
				return_path: returnPath,
				native: IS_CAPACITOR
			}
		});
		if (error || !data?.authorization_url) {
			ssoChallengeInFlight = false;
			return;
		}
		if (IS_CAPACITOR) {
			const { Browser } = await import('@capacitor/browser');
			await Browser.open({ url: data.authorization_url });
			return;
		}
		window.location.assign(data.authorization_url);
	}

	async function completeNativeOIDC(url: string) {
		let callback: URL;
		try {
			callback = new URL(url);
		} catch {
			return;
		}
		const code = callback.searchParams.get('code');
		if (!code) return;
		const { Browser } = await import('@capacitor/browser');
		await Browser.close();
		const result = await auth.consumeOIDCHandoff(code);
		if (!result.success) {
			ssoChallengeInFlight = false;
			return;
		}
		if (result.purpose === 'reauth' && result.action && result.reauthGrant) {
			storeReauthGrant(result.action, result.reauthGrant);
			if (result.action.startsWith('organization.access:')) {
				workspaceCtx.reset();
				onboardingChecked = false;
			}
			ssoChallengeInFlight = false;
			return;
		}
		if (result.purpose === 'link') {
			ssoChallengeInFlight = false;
			window.location.reload();
			return;
		}
		workspaceCtx.reset();
		onboardingChecked = false;
		if (currentPath === '/login') {
			await goto(resolve(authenticatedPublicTarget() as '/'));
		}
	}

	$effect(() => {
		if (isPublicProfileRoute || routeOwnsWorkspaceBootstrap) return;
		if (
			authState.isLoading ||
			!authState.isAuthenticated ||
			authState.user?.legal_acceptance_required
		) {
			onboardingChecked = false;
			onboardingCheckedPath = '';
			onboardingCheckInFlightForPath = '';
			return;
		}

		const shouldRecheckAfterOnboarding =
			needsOnboarding && currentPath !== '/onboarding' && onboardingCheckedPath !== currentPath;
		if (
			(!onboardingChecked || shouldRecheckAfterOnboarding) &&
			onboardingCheckInFlightForPath !== currentPath
		) {
			onboardingChecked = false;
			checkOnboarding(currentPath);
		}
	});
</script>

<svelte:window onbeforeunload={warnBeforeUnload} />

<svelte:head>
	<title>OpenPost</title>
</svelte:head>

{#if !isPreviewRoute}<ModeWatcher />{/if}
<Toaster position="bottom-center" richColors closeButton />
{#if isPreviewRoute}
	{@render children()}
{:else if instance.isLoading || authState.isLoading || pendingRedirect || ssoChallengeInFlight || (!isPublicProfileRoute && !routeOwnsWorkspaceBootstrap && authState.isAuthenticated && !authState.user?.legal_acceptance_required && !onboardingChecked)}
	<AppLoading label={m.common_loading()} />
{:else if !authState.isAuthenticated}
	{#if !isPublicProfileRoute && !(currentPath === '/' && isManagedEdition) && currentPath !== '/image-editor' && !currentPath.startsWith('/image-editor/') && !currentPath.startsWith('/video-editor')}
		<div class="fixed top-4 right-4 z-20">
			<LanguageSwitcher compact />
		</div>
	{/if}
	{#if currentPath === '/'}
		{#if isManagedEdition}
			<PublicHome />
		{:else}
			<div class="flex min-h-[80vh] items-center justify-center">
				<div class="mx-auto max-w-md px-4 py-12 text-center">
					<div class="mb-6 flex justify-center">
						<Logo width={100} height={29} />
					</div>
					<p class="mb-6 text-muted-foreground">{m.landing_tagline()}</p>
					<div class="flex justify-center gap-4">
						<a
							href={resolve('/login')}
							class="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
							>{m.landing_sign_in()}</a
						>
						<a
							href={resolve('/register')}
							class="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground"
							>{m.landing_create_account()}</a
						>
					</div>
				</div>
			</div>
		{/if}
	{:else}
		{@render children()}
	{/if}
{:else if isStandaloneRoute}
	{#if !isPublicProfileRoute && !currentPath.startsWith('/image-editor/') && !currentPath.startsWith('/video-editor')}
		<div class="fixed top-4 right-4 z-20">
			<LanguageSwitcher compact />
		</div>
	{/if}
	{@render children()}
{:else}
	<a
		href="#main-content"
		class="fixed top-2 left-2 z-[100] -translate-y-16 rounded-md bg-background px-3 py-2 text-sm font-medium shadow-lg transition-transform focus:translate-y-0 focus:ring-2 focus:ring-ring focus:outline-none"
	>
		{m.common_skip_to_content()}
	</a>
	<Sidebar.Provider style="padding-top: env(safe-area-inset-top);">
		<SidebarLeft />
		<Sidebar.Inset
			id="main-content"
			tabindex={-1}
			class="pb-[var(--mobile-bottom-nav-clearance)] md:pb-0"
		>
			<div class="flex min-h-0 flex-1 flex-col overflow-auto">
				{@render children()}
			</div>
			<MobileBottomNav />
			<DayPostsModal />
			<FeedbackDialog />
		</Sidebar.Inset>
	</Sidebar.Provider>
{/if}
