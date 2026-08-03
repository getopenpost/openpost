<!--
THESIS: Publishing consistency is visible as a personal record; the page refuses a social-feed profile and puts the activity field first.
OWN-WORLD: Warm black or canvas, restrained type, hairline divisions, and orange contribution cells that intensify with posting cadence.
STORY: A visitor identifies the creator, understands their publishing record, sees where they post, and can start their own OpenPost profile.
FIRST VIEWPORT: Avatar, name, handle, five plain statistics, and the first edge of the year-long activity field sit in one quiet column.
FORM: Public activity ledger, adapted from contribution charts without gamified badges or invented scores.
-->
<script lang="ts">
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import { ArrowRight, Building2, CalendarDays } from 'lucide-svelte';
	import Logo from '$lib/components/Logo.svelte';
	import PlatformIcon from '$lib/components/platform-icon.svelte';
	import { Button } from '$lib/components/ui/button';
	import { client, type PublicProfile } from '$lib/api/client';

	type ActivityCell = PublicProfile['activity'][number] | null;

	let profile = $state.raw<PublicProfile | null>(null);
	let loading = $state(true);
	let notFound = $state(false);
	const username = $derived(page.params.username ?? '');
	const title = $derived(profile ? `${profile.display_name} (@${profile.username})` : 'Public profile');
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
	const topPlatformCount = $derived(profile?.top_platforms?.[0]?.count ?? 1);
	const topWorkspaceCount = $derived(profile?.top_workspaces?.[0]?.count ?? 1);
	const initials = $derived.by(() => {
		const source = profile?.display_name || profile?.username || 'OP';
		return source
			.split(/[\s._-]+/)
			.filter(Boolean)
			.slice(0, 2)
			.map((part) => part[0]?.toUpperCase())
			.join('');
	});

	onMount(async () => {
		loading = true;
		const { data, error } = await client.GET('/public/profiles/{username}', {
			params: { path: { username } }
		});
		if (error || !data) {
			notFound = true;
		} else {
			profile = data;
		}
		loading = false;
	});

	function formatNumber(value: number): string {
		return new Intl.NumberFormat(undefined, { notation: value >= 10_000 ? 'compact' : 'standard' }).format(value);
	}

	function plural(value: number, singular: string): string {
		return `${value} ${value === 1 ? singular : `${singular}s`}`;
	}
</script>

<svelte:head>
	<title>{title} - OpenPost</title>
	<meta
		name="description"
		content={profile
			? `See ${profile.display_name}'s public publishing activity on OpenPost.`
			: 'Public OpenPost publishing profile.'}
	/>
	<meta name="robots" content={profile ? 'index, follow' : 'noindex'} />
</svelte:head>

<div class="profile-canvas min-h-screen bg-background text-foreground">
	<header class="border-b border-border/70">
		<div class="profile-shell flex min-h-16 items-center justify-between gap-4">
			<a href="https://openpost.social" class="focus-ring inline-flex min-h-11 items-center gap-2 rounded-md">
				<Logo width={34} height={27} />
				<span class="text-sm font-semibold">OpenPost</span>
			</a>
			<Button href="/register" variant="outline" size="sm">
				Create your profile
				<ArrowRight data-icon="inline-end" />
			</Button>
		</div>
	</header>

	<main class="profile-shell py-12 sm:py-16 lg:py-20">
		{#if loading}
			<div class="grid min-h-[55vh] place-items-center" aria-live="polite">
				<div class="activity-loader" aria-label="Loading public profile">
					{#each Array(16) as _, index (index)}
						<i style:--delay={`${index * 45}ms`}></i>
					{/each}
				</div>
			</div>
		{:else if notFound || !profile}
			<div class="mx-auto grid min-h-[55vh] max-w-xl place-items-center text-center">
				<div>
					<p class="text-sm font-medium text-primary">Profile unavailable</p>
					<h1 class="mt-4 text-4xl font-semibold tracking-[-0.035em] text-balance sm:text-5xl">
						This profile is private or does not exist.
					</h1>
					<p class="mt-5 text-muted-foreground">Check the username or ask the owner to enable their public profile.</p>
					<Button href="https://openpost.social" class="mt-8">Visit OpenPost</Button>
				</div>
			</div>
		{:else}
			<section class="profile-intro text-center" aria-labelledby="profile-name">
				<div class="mx-auto size-24 overflow-hidden rounded-2xl border bg-muted sm:size-28">
					{#if profile.avatar_url}
						<img src={profile.avatar_url} alt="" class="size-full object-cover" />
					{:else}
						<div class="grid size-full place-items-center text-2xl font-semibold text-muted-foreground">{initials}</div>
					{/if}
				</div>
				<h1 id="profile-name" class="mt-7 text-4xl font-medium tracking-[-0.035em] sm:text-5xl">
					{profile.display_name}
				</h1>
				<p class="mt-3 text-lg text-muted-foreground">@{profile.username}</p>
			</section>

			<section class="mt-12 overflow-hidden rounded-2xl border" aria-label="Publishing statistics">
				<dl class="profile-stats grid grid-cols-2 sm:grid-cols-5">
					<div><dt>Lifetime posts</dt><dd>{formatNumber(profile.lifetime_posts)}</dd></div>
					<div><dt>Peak posts</dt><dd>{plural(profile.peak_posts, 'post')}</dd></div>
					<div><dt>Active days</dt><dd>{formatNumber(profile.active_days)}</dd></div>
					<div><dt>Current streak</dt><dd>{plural(profile.current_streak, 'day')}</dd></div>
					<div><dt>Longest streak</dt><dd>{plural(profile.longest_streak, 'day')}</dd></div>
				</dl>
			</section>

			<section class="mt-14" aria-labelledby="activity-title">
				<div class="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
					<div>
						<h2 id="activity-title" class="text-xl font-semibold tracking-[-0.02em]">Publishing activity</h2>
						<p class="mt-1 text-sm text-muted-foreground">One square per day. Darker orange means more publications.</p>
					</div>
					<p class="text-sm text-muted-foreground">
						Joined {new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(new Date(profile.joined_at))}
					</p>
				</div>
				<div class="activity-scroll mt-7 overflow-x-auto pb-3">
					<div class="activity-field min-w-[48rem]">
						<div class="activity-months" aria-hidden="true">
							{#each monthLabels as month (`${month.label}-${month.column}`)}
								<span style:grid-column={month.column}>{month.label}</span>
							{/each}
						</div>
						<div class="activity-grid" role="img" aria-label={`${profile.active_days} active publishing days in the last year`}>
							{#each activityCells as day, index (`${day?.date ?? 'pad'}-${index}`)}
								<i
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

			<section class="mt-14 grid gap-10 border-t pt-10 lg:grid-cols-2" aria-label="Publishing insights">
				<div>
					<h2 class="flex items-center gap-2 text-lg font-semibold"><CalendarDays class="size-5 text-primary" /> Most used platforms</h2>
					{#if profile.top_platforms.length}
						<ul class="mt-5 grid gap-4">
							{#each profile.top_platforms as platform (platform.key)}
								<li class="rank-row">
									<span class="flex min-w-0 items-center gap-3 font-medium capitalize">
										<PlatformIcon platform={platform.key} class="size-5" />
										<span class="truncate">{platform.name}</span>
									</span>
									<span class="text-sm text-muted-foreground">{plural(platform.count, 'post')}</span>
									<i style:--rank={`${(platform.count / topPlatformCount) * 100}%`}></i>
								</li>
							{/each}
						</ul>
					{:else}
						<p class="mt-5 text-sm text-muted-foreground">No published platform activity yet.</p>
					{/if}
				</div>
				<div>
					<h2 class="flex items-center gap-2 text-lg font-semibold"><Building2 class="size-5 text-primary" /> Most active workspaces</h2>
					{#if profile.top_workspaces.length}
						<ul class="mt-5 grid gap-4">
							{#each profile.top_workspaces as workspace (workspace.key)}
								<li class="rank-row">
									<span class="min-w-0 truncate font-medium">{workspace.name}</span>
									<span class="text-sm text-muted-foreground">{plural(workspace.count, 'post')}</span>
									<i style:--rank={`${(workspace.count / topWorkspaceCount) * 100}%`}></i>
								</li>
							{/each}
						</ul>
					{:else}
						<p class="mt-5 text-sm text-muted-foreground">No public workspace activity yet.</p>
					{/if}
				</div>
			</section>
		{/if}
	</main>
</div>

<style>
	.profile-shell {
		width: min(100% - 2rem, 80rem);
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
		min-height: 7rem;
		flex-direction: column-reverse;
		justify-content: center;
		gap: 0.35rem;
		padding: 1.25rem 1rem;
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
		font-size: clamp(1.1rem, 2vw, 1.35rem);
		font-variant-numeric: tabular-nums;
		font-weight: 550;
		letter-spacing: -0.02em;
	}

	.activity-field {
		width: max-content;
	}

	.activity-months,
	.activity-grid {
		display: grid;
		grid-auto-columns: 0.72rem;
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
		grid-template-rows: repeat(7, 0.72rem);
		row-gap: 0.25rem;
	}

	.activity-grid i {
		width: 0.72rem;
		height: 0.72rem;
		border-radius: 0.2rem;
		background: var(--activity-0);
		animation: cell-resolve 520ms cubic-bezier(0.16, 1, 0.3, 1) both;
		animation-delay: var(--cell-delay);
	}

	.activity-grid i.pad {
		visibility: hidden;
	}

	.activity-grid i.level-1 { background: var(--activity-1); }
	.activity-grid i.level-2 { background: var(--activity-2); }
	.activity-grid i.level-3 { background: var(--activity-3); }
	.activity-grid i.level-4 { background: var(--activity-4); }

	.rank-row {
		position: relative;
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		gap: 0.55rem 1rem;
		padding-bottom: 0.6rem;
	}

	.rank-row > i {
		grid-column: 1 / -1;
		height: 0.18rem;
		border-radius: 999px;
		background: linear-gradient(to right, var(--primary) var(--rank), var(--muted) var(--rank));
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
		from { opacity: 0.45; transform: scale(0.72); filter: blur(2px); }
		to { opacity: 1; transform: scale(1); filter: blur(0); }
	}

	@keyframes loader-cell {
		0%, 100% { opacity: 0.2; transform: translateY(0); }
		45% { opacity: 1; transform: translateY(-0.35rem); }
	}

	@media (max-width: 639px) {
		.profile-stats > div:nth-child(odd) { border-left: 0; }
		.profile-stats > div { border-bottom: 1px solid var(--border); }
		.profile-stats > div:last-child { grid-column: 1 / -1; border-bottom: 0; border-left: 0; }
	}

	@media (prefers-reduced-motion: reduce) {
		.activity-grid i,
		.activity-loader i { animation: none; }
	}
</style>
