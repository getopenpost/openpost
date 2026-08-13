<!--
THESIS: Publishing consistency is visible as a personal record; the page refuses a social-feed profile and puts the activity field first.
OWN-WORLD: Warm black or canvas, restrained type, hairline divisions, and orange contribution cells that intensify with posting cadence.
STORY: A visitor identifies the creator, understands their publishing record, sees where they post, and can start their own OpenPost profile.
FIRST VIEWPORT: Avatar, name, handle, five plain statistics, and the first edge of the year-long activity field sit in one quiet column.
FORM: Public activity ledger, adapted from contribution charts without gamified badges or invented scores.
-->
<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import type { Attachment } from 'svelte/attachments';
	import { ArrowRight } from '@lucide/svelte';
	import Logo from '$lib/components/Logo.svelte';
	import PlatformIcon from '$lib/components/platform-icon.svelte';
	import { Button } from '$lib/components/ui/button';
	import { client, type PublicProfile } from '$lib/api/client';
	import { m } from '$lib/paraglide/messages';
	import { getPlatformName } from '$lib/utils';

	type ActivityCell = NonNullable<PublicProfile['activity']>[number] | null;

	let profile = $state.raw<PublicProfile | null>(null);
	let loadState = $state<'loading' | 'ready' | 'disabled' | 'not-found' | 'error'>('loading');
	let activeLoadController: AbortController | null = null;
	let loadGeneration = 0;
	const username = $derived(page.params.username ?? '');
	const profileName = $derived(profile?.display_name || profile?.username || 'OpenPost');
	const title = $derived(profile ? `${profileName} (@${profile.username})` : 'Public profile');
	const activityCells = $derived.by<ActivityCell[]>(() => {
		const days = profile?.activity ?? [];
		if (days.length === 0) return [];
		const padding = new Date(`${days[0].date}T00:00:00Z`).getUTCDay();
		return [...Array<ActivityCell>(padding).fill(null), ...days];
	});
	const monthLabels = $derived.by(() => {
		const days = profile?.activity ?? [];
		if (days.length === 0) return [];
		const padding = new Date(`${days[0].date}T00:00:00Z`).getUTCDay();
		const labels: Array<{ label: string; column: number }> = [];
		let previousMonth = -1;
		for (let index = 0; index < days.length; index += 1) {
			const date = new Date(`${days[index].date}T00:00:00Z`);
			if (date.getUTCMonth() === previousMonth) continue;
			previousMonth = date.getUTCMonth();
			labels.push({
				label: new Intl.DateTimeFormat(undefined, { month: 'short', timeZone: 'UTC' }).format(date),
				column: Math.floor((padding + index) / 7) + 1
			});
		}
		return labels;
	});
	const topPlatforms = $derived(profile?.top_platforms ?? []);
	const topWorkspaces = $derived(profile?.top_workspaces ?? []);
	const visibleFields = $derived(profile?.visible_fields ?? []);
	const showsActivity = $derived(visibleFields.includes('activity'));
	const showsPlatforms = $derived(visibleFields.includes('platforms'));
	const showsWorkspaces = $derived(visibleFields.includes('workspaces'));
	const initials = $derived.by(() => {
		const source = profile?.display_name || profile?.username || 'OP';
		return source
			.split(/[\s._-]+/)
			.filter(Boolean)
			.slice(0, 2)
			.map((part) => part[0]?.toUpperCase())
			.join('');
	});
	const showRecentActivity: Attachment<HTMLElement> = (node) => {
		const frame = requestAnimationFrame(() => {
			node.scrollLeft = Math.max(0, node.scrollWidth - node.clientWidth);
		});
		return () => cancelAnimationFrame(frame);
	};

	$effect(() => {
		const requestedUsername = username;
		const controller = startProfileLoad(requestedUsername);
		return () => {
			controller.abort();
			activeLoadController?.abort();
			activeLoadController = null;
		};
	});

	function startProfileLoad(requestedUsername: string): AbortController {
		activeLoadController?.abort();
		const controller = new AbortController();
		activeLoadController = controller;
		loadGeneration += 1;
		void loadProfile(requestedUsername, controller.signal, loadGeneration);
		return controller;
	}

	async function loadProfile(requestedUsername: string, signal: AbortSignal, generation: number) {
		loadState = 'loading';
		profile = null;
		try {
			const [configuration, result] = await Promise.all([
				client.GET('/auth/config', { signal }),
				client.GET('/public/profiles/{username}', {
					params: { path: { username: requestedUsername } },
					signal
				})
			]);
			if (signal.aborted || generation !== loadGeneration) return;
			if (configuration.data?.public_profiles_enabled !== true) {
				loadState = configuration.data?.public_profiles_enabled === false ? 'disabled' : 'error';
				return;
			}
			if (result.response.status === 403) {
				loadState = 'disabled';
				return;
			}
			if (result.data) {
				profile = result.data;
				loadState = 'ready';
				return;
			}
			loadState = result.response.status === 404 ? 'not-found' : 'error';
		} catch {
			if (signal.aborted || generation !== loadGeneration) return;
			loadState = 'error';
		}
	}

	function formatNumber(value: number): string {
		return new Intl.NumberFormat(undefined, {
			notation: value >= 10_000 ? 'compact' : 'standard'
		}).format(value);
	}

	function plural(value: number, singular: string): string {
		return `${value} ${value === 1 ? singular : `${singular}s`}`;
	}

	function formatPlan(planID: string): string {
		return planID
			.split('-')
			.filter(Boolean)
			.map((part) => part[0]?.toUpperCase() + part.slice(1))
			.join(' ');
	}
</script>

<svelte:head>
	<title>{title} - OpenPost</title>
	<meta
		name="description"
		content={profile
			? `See ${profileName}'s public publishing profile on OpenPost.`
			: 'Public OpenPost publishing profile.'}
	/>
	<meta name="robots" content={profile ? 'index, follow' : 'noindex'} />
</svelte:head>

<div class="profile-canvas min-h-screen bg-background text-foreground">
	<header class="border-b border-border/70">
		<div class="profile-shell flex min-h-14 items-center justify-between gap-4">
			<a
				href={resolve('/' as const)}
				class="focus-ring inline-flex min-h-11 items-center gap-2 rounded-md"
			>
				<Logo width={34} height={27} decorative />
				<span class="font-brand text-sm leading-none font-semibold tracking-[-0.02em]"
					>OpenPost</span
				>
			</a>
			<Button href={resolve('/register' as const)} variant="outline" size="sm">
				Create your profile
				<ArrowRight data-icon="inline-end" />
			</Button>
		</div>
	</header>

	<main class="profile-shell py-6 sm:py-8">
		{#if loadState === 'loading'}
			<div class="grid min-h-[55vh] place-items-center" aria-live="polite">
				<div class="activity-loader" aria-label="Loading public profile">
					{#each Array(16) as _, index (index)}
						<i style:--delay={`${index * 45}ms`}></i>
					{/each}
				</div>
			</div>
		{:else if loadState === 'disabled'}
			<div class="mx-auto grid min-h-[55vh] max-w-xl place-items-center text-center">
				<div>
					<p class="text-sm font-medium text-primary">{m.public_profile_disabled_title()}</p>
					<h1 class="mt-4 text-4xl font-semibold tracking-[-0.035em] text-balance sm:text-5xl">
						{m.public_profile_disabled_body()}
					</h1>
				</div>
			</div>
		{:else if loadState === 'not-found'}
			<div class="mx-auto grid min-h-[55vh] max-w-xl place-items-center text-center">
				<div>
					<p class="text-sm font-medium text-primary">{m.public_profile_unavailable_title()}</p>
					<h1 class="mt-4 text-4xl font-semibold tracking-[-0.035em] text-balance sm:text-5xl">
						{m.public_profile_unavailable_body()}
					</h1>
					<Button href={resolve('/' as const)} class="mt-8">Visit OpenPost</Button>
				</div>
			</div>
		{:else if loadState === 'error'}
			<div class="mx-auto grid min-h-[55vh] max-w-xl place-items-center text-center">
				<div>
					<p class="text-sm font-medium text-primary">{m.public_profile_error_title()}</p>
					<h1 class="mt-4 text-4xl font-semibold tracking-[-0.035em] text-balance sm:text-5xl">
						{m.public_profile_error_body()}
					</h1>
					<Button class="mt-8" onclick={() => startProfileLoad(username)}>{m.common_retry()}</Button
					>
				</div>
			</div>
		{:else if profile}
			<section class="profile-intro text-center" aria-labelledby="profile-name">
				<div class="mx-auto size-20 overflow-hidden rounded-2xl border bg-muted">
					{#if profile.avatar_url}
						<img src={profile.avatar_url} alt="" class="size-full object-cover" />
					{:else}
						<div
							class="grid size-full place-items-center text-2xl font-semibold text-muted-foreground"
						>
							{initials}
						</div>
					{/if}
				</div>
				<h1 id="profile-name" class="mt-4 text-3xl font-medium tracking-[-0.03em]">
					{profileName}
				</h1>
				<div class="mt-2 flex items-center justify-center gap-2 text-sm text-muted-foreground">
					<span>@{profile.username}</span>
					{#if profile.plan_id}
						<span aria-hidden="true">·</span>
						<span class="profile-plan">{formatPlan(profile.plan_id)}</span>
					{/if}
				</div>
			</section>

			{#if showsActivity}
				<section class="mt-6 overflow-hidden rounded-xl border" aria-label="Publishing statistics">
					<dl class="profile-stats grid grid-cols-2 sm:grid-cols-5">
						<div>
							<dt>Lifetime posts</dt>
							<dd>{formatNumber(profile.lifetime_posts ?? 0)}</dd>
						</div>
						<div>
							<dt>Peak posts</dt>
							<dd>{plural(profile.peak_posts ?? 0, 'post')}</dd>
						</div>
						<div>
							<dt>Active days</dt>
							<dd>{formatNumber(profile.active_days ?? 0)}</dd>
						</div>
						<div>
							<dt>Current streak</dt>
							<dd>{plural(profile.current_streak ?? 0, 'day')}</dd>
						</div>
						<div>
							<dt>Longest streak</dt>
							<dd>{plural(profile.longest_streak ?? 0, 'day')}</dd>
						</div>
					</dl>
				</section>

				<section class="mt-8" aria-labelledby="activity-title">
					<div class="flex items-center justify-between gap-4">
						<h2 id="activity-title" class="text-lg font-semibold tracking-[-0.02em]">
							Publishing activity
						</h2>
						{#if profile.joined_at}
							<p class="text-xs text-muted-foreground">
								Joined {new Intl.DateTimeFormat(undefined, {
									month: 'long',
									year: 'numeric'
								}).format(new Date(profile.joined_at))}
							</p>
						{/if}
					</div>
					<p class="sr-only">One square per day. Darker orange means more publications.</p>
					<div class="activity-scroll mt-4 overflow-x-auto pb-2" {@attach showRecentActivity}>
						<div class="activity-field">
							<div class="activity-months" aria-hidden="true">
								{#each monthLabels as month (`${month.label}-${month.column}`)}
									<span style:grid-column={month.column}>{month.label}</span>
								{/each}
							</div>
							<div
								class="activity-grid"
								role="img"
								aria-label={`${profile.active_days ?? 0} active publishing days in the last year`}
							>
								{#each activityCells as day, index (`${day?.date ?? 'pad'}-${index}`)}
									<i
										aria-hidden="true"
										class:pad={!day}
										class:level-1={day?.level === 1}
										class:level-2={day?.level === 2}
										class:level-3={day?.level === 3}
										class:level-4={day?.level === 4}
										style:--cell-delay={`${Math.min(index, 90) * 7}ms`}
										title={day ? `${day.date}: ${plural(day.count, 'publication')}` : undefined}
									></i>
								{/each}
							</div>
						</div>
					</div>
				</section>
			{:else if profile.joined_at}
				<p class="mt-6 text-center text-sm text-muted-foreground">
					Joined {new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(
						new Date(profile.joined_at)
					)}
				</p>
			{/if}

			{#if showsPlatforms || showsWorkspaces}
				<section
					class="mt-8 grid gap-8 border-t pt-6 md:grid-cols-2"
					aria-label="Publishing insights"
				>
					{#if showsPlatforms}
						<div>
							<h2 class="text-base font-semibold">Most used platforms</h2>
							{#if topPlatforms.length}
								<ul class="mt-2">
									{#each topPlatforms as platform (platform.key)}
										<li class="rank-row">
											<span class="flex min-w-0 items-center gap-3 font-medium">
												<PlatformIcon platform={platform.key} class="size-5" />
												<span class="truncate">{getPlatformName(platform.key)}</span>
											</span>
											<span class="text-sm text-muted-foreground"
												>{plural(platform.count, 'post')}</span
											>
										</li>
									{/each}
								</ul>
							{:else}
								<p class="mt-5 text-sm text-muted-foreground">
									No published platform activity yet.
								</p>
							{/if}
						</div>
					{/if}
					{#if showsWorkspaces}
						<div>
							<h2 class="text-base font-semibold">Most active workspaces</h2>
							{#if topWorkspaces.length}
								<ul class="mt-2">
									{#each topWorkspaces as workspace (workspace.key)}
										<li class="rank-row">
											<span class="min-w-0 truncate font-medium">{workspace.name}</span>
											<span class="text-sm text-muted-foreground"
												>{plural(workspace.count, 'post')}</span
											>
										</li>
									{/each}
								</ul>
							{:else}
								<p class="mt-5 text-sm text-muted-foreground">No public workspace activity yet.</p>
							{/if}
						</div>
					{/if}
				</section>
			{/if}
		{/if}
	</main>
</div>

<style>
	.profile-shell {
		width: min(100% - 2rem, 60rem);
		margin-inline: auto;
	}

	.profile-canvas {
		--activity-0: color-mix(in oklch, var(--muted) 62%, var(--background));
		--activity-1: oklch(0.78 0.075 57);
		--activity-2: oklch(0.7 0.11 50);
		--activity-3: oklch(0.62 0.145 46);
		--activity-4: oklch(0.55 0.17 42);
	}

	.profile-stats > div {
		display: flex;
		min-height: 4.5rem;
		flex-direction: column-reverse;
		justify-content: center;
		gap: 0.35rem;
		padding: 1rem;
		text-align: center;
	}

	.profile-stats > div + div {
		border-left: 1px solid var(--border);
	}

	.profile-stats dt {
		font-size: 0.82rem;
		color: var(--muted-foreground);
	}

	.profile-stats dd {
		font-size: clamp(1rem, 2vw, 1.2rem);
		font-variant-numeric: tabular-nums;
		font-weight: 550;
		letter-spacing: -0.02em;
	}

	.activity-field {
		width: 100%;
		min-width: 48rem;
	}

	.activity-months,
	.activity-grid {
		display: grid;
		grid-auto-columns: minmax(0.72rem, 1fr);
		column-gap: 0.25rem;
	}

	.activity-months {
		height: 1.5rem;
		font-size: 0.72rem;
		color: var(--muted-foreground);
	}

	.activity-months span {
		white-space: nowrap;
	}

	.activity-grid {
		grid-auto-flow: column;
		grid-template-rows: repeat(7, auto);
		row-gap: 0.25rem;
	}

	.activity-grid i {
		width: 100%;
		aspect-ratio: 1;
		border-radius: 0.2rem;
		background: var(--activity-0);
		animation: cell-resolve 520ms cubic-bezier(0.16, 1, 0.3, 1) both;
		animation-delay: var(--cell-delay);
	}

	.activity-grid i.pad {
		visibility: hidden;
	}

	.activity-grid i.level-1 {
		background: var(--activity-1);
	}
	.activity-grid i.level-2 {
		background: var(--activity-2);
	}
	.activity-grid i.level-3 {
		background: var(--activity-3);
	}
	.activity-grid i.level-4 {
		background: var(--activity-4);
	}

	.rank-row {
		display: flex;
		min-height: 2.25rem;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		border-bottom: 1px solid color-mix(in oklch, var(--border) 70%, transparent);
	}

	.rank-row:last-child {
		border-bottom: 0;
	}

	.profile-plan {
		border: 1px solid var(--border);
		border-radius: 999px;
		padding: 0.05rem 0.45rem;
		font-size: 0.75rem;
		line-height: 1.35rem;
		color: var(--foreground);
	}

	.activity-loader {
		display: grid;
		grid-template-columns: repeat(4, 0.8rem);
		gap: 0.3rem;
	}

	.activity-loader i {
		width: 0.8rem;
		height: 0.8rem;
		border-radius: 0.2rem;
		background: var(--primary);
		animation: loader-cell 1.3s cubic-bezier(0.16, 1, 0.3, 1) infinite;
		animation-delay: var(--delay);
	}

	@keyframes cell-resolve {
		from {
			opacity: 0.45;
			transform: scale(0.72);
			filter: blur(2px);
		}
		to {
			opacity: 1;
			transform: scale(1);
			filter: blur(0);
		}
	}

	@keyframes loader-cell {
		0%,
		100% {
			opacity: 0.2;
			transform: translateY(0);
		}
		45% {
			opacity: 1;
			transform: translateY(-0.35rem);
		}
	}

	@media (max-width: 639px) {
		.profile-stats > div:nth-child(odd) {
			border-left: 0;
		}
		.profile-stats > div {
			border-bottom: 1px solid var(--border);
		}
		.profile-stats > div:last-child {
			grid-column: 1 / -1;
			border-bottom: 0;
			border-left: 0;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.activity-grid i,
		.activity-loader i {
			animation: none;
		}
	}
</style>
