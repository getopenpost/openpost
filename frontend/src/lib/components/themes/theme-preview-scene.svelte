<script lang="ts">
	import Logo from '$lib/components/Logo.svelte';
	import { Button } from '$lib/components/ui/button';
	import { ThemeIcon } from '$lib/themes/icons';
	import type { WebResolvedTheme } from '$lib/themes';
	import type { ThemePreviewScene } from './theme-preview-types.js';

	interface Props {
		theme: WebResolvedTheme;
		scene?: ThemePreviewScene;
		interactive?: boolean;
	}

	let { theme, scene = 'dashboard', interactive = false }: Props = $props();
	const sceneCopy = {
		shell: { eyebrow: 'Workspace shell', title: 'Northstar' },
		dashboard: { eyebrow: 'Good afternoon', title: 'Keep the week moving' },
		cards: { eyebrow: 'Content library', title: 'Ideas in motion' },
		composer: { eyebrow: 'New publication', title: 'Share the launch' },
		calendar: { eyebrow: 'Publishing plan', title: 'September' },
		tables: { eyebrow: 'Performance', title: 'Published content' },
		settings: { eyebrow: 'Workspace settings', title: 'Northstar' },
		forms: { eyebrow: 'Workspace details', title: 'Profile and defaults' },
		dialog: { eyebrow: 'Confirmation', title: 'Dialog and overlay' },
		notices: { eyebrow: 'System feedback', title: 'Notices and status' },
		empty: { eyebrow: 'First-run state', title: 'Nothing scheduled yet' },
		loading: { eyebrow: 'Loading state', title: 'Preparing your workspace' },
		'image-editor': { eyebrow: 'Image editor', title: 'Protected editor chrome' },
		'video-editor': { eyebrow: 'Video editor', title: 'Protected editor chrome' }
	} satisfies Record<ThemePreviewScene, { eyebrow: string; title: string }>;
	const createActionScenes = new Set<ThemePreviewScene>([
		'dashboard',
		'cards',
		'calendar',
		'tables'
	]);
	const activeCopy = $derived(sceneCopy[scene]);
	const emptyStateAsset = $derived(
		theme.assets.find((asset) => asset.slot === 'empty-state-illustration')
	);
	const loadingAsset = $derived(
		theme.assets.find((asset) => asset.slot === 'loading-illustration')
	);
	const showCreateAction = $derived(createActionScenes.has(scene));
</script>

<div
	class="theme-preview-scene relative min-h-[30rem] max-w-full overflow-hidden bg-background text-foreground"
	data-preview-scene={scene}
	data-slot="app-shell"
	data-theme-type="body"
>
	<div
		class="pointer-events-none absolute inset-0 bg-[image:var(--theme-asset-background-texture)] bg-repeat opacity-20"
	></div>
	<div class="relative flex min-h-[30rem]">
		<aside
			data-slot="sidebar"
			class="preview-sidebar flex shrink-0 flex-col border-r border-sidebar-border bg-sidebar bg-[image:var(--theme-asset-sidebar-decoration)] bg-bottom bg-no-repeat p-3 text-sidebar-foreground"
			style="width: min(var(--theme-sidebar-width, 16rem), 34%);"
		>
			<Logo showText width={92} height={20} class="mb-5" />
			<nav class="space-y-1" aria-label="Preview navigation">
				{#each [['Home', 'home'], ['Compose', 'compose'], ['Calendar', 'calendar'], ['Media', 'media']] as item, index (item[0])}
					<div
						data-theme-type="label"
						class={[
							'flex min-h-8 items-center gap-2 rounded-[var(--theme-radius-sm,var(--radius))] px-2',
							index === 0
								? 'bg-sidebar-primary text-sidebar-primary-foreground'
								: 'text-sidebar-foreground/65'
						]}
					>
						<ThemeIcon
							role={item[1] as 'home' | 'compose' | 'calendar' | 'media'}
							class="size-3.5"
						/>
						{item[0]}
					</div>
				{/each}
			</nav>
			<div
				class="mt-auto rounded-[var(--theme-radius-md,var(--radius))] border border-sidebar-border p-2"
			>
				<p data-theme-type="label">Northstar</p>
				<p data-theme-type="metadata" class="mt-0.5 text-sidebar-foreground/60">
					3 scheduled today
				</p>
			</div>
		</aside>

		<div class="preview-shell-content min-w-0 flex-1">
			<header
				data-slot="app-header"
				class="flex items-center justify-between border-b border-border bg-background/92 bg-[image:var(--theme-asset-header-decoration)] bg-[position:top_right] bg-no-repeat px-[var(--theme-page-gutter)]"
			>
				<div class="preview-mobile-brand hidden items-center gap-2">
					<Logo width={20} height={20} decorative />
					<span data-theme-type="label">OpenPost</span>
				</div>
				<div
					data-theme-type="metadata"
					class="preview-desktop-meta flex items-center gap-2 text-muted-foreground"
				>
					<span class="size-1.5 rounded-full bg-success"></span>
					All systems ready
				</div>
				<div class="ml-auto flex items-center gap-2">
					<span data-theme-type="metadata" class="hidden text-muted-foreground sm:inline"
						>Sep 12</span
					>
					<div
						data-theme-type="label"
						class="grid size-7 place-items-center rounded-full bg-accent text-accent-foreground"
					>
						RS
					</div>
				</div>
			</header>

			{#if scene === 'image-editor' || scene === 'video-editor'}
				<div
					class="grid min-h-[27rem] grid-cols-[3rem_1fr] bg-[var(--editor-canvas)] text-[var(--editor-text)]"
					data-protected-editor-chrome={scene}
				>
					<div
						class="flex flex-col items-center gap-2 border-r border-[var(--editor-border)] bg-[var(--editor-panel)] py-3"
					>
						{#each [0, 1, 2, 3, 4] as tool (tool)}
							<div
								class="size-7 rounded-[var(--theme-radius-sm,var(--radius))] bg-[var(--editor-control)]"
							></div>
						{/each}
					</div>
					<div
						class={scene === 'video-editor'
							? 'grid min-w-0 grid-rows-[1fr_6rem]'
							: 'grid min-w-0 grid-rows-[1fr]'}
					>
						<div class="grid place-items-center bg-[var(--canvas-pasteboard)] p-5">
							<div class="relative aspect-[4/5] h-56 max-h-[80%] bg-white shadow-xl">
								<div
									class="absolute inset-x-5 top-7 h-3 rounded-full bg-[var(--canvas-selection)]"
								></div>
								<div class="absolute inset-x-5 top-14 space-y-2">
									<div class="h-2 w-4/5 rounded-full bg-slate-800"></div>
									<div class="h-2 w-3/5 rounded-full bg-slate-400"></div>
								</div>
								<div class="absolute inset-x-5 bottom-6 h-16 rounded-lg bg-orange-100"></div>
								<div class="absolute -inset-1 border border-[var(--canvas-selection)]"></div>
							</div>
						</div>
						{#if scene === 'video-editor'}
							<div
								class="relative border-t border-[var(--editor-border)] bg-[var(--timeline-track)] p-2"
							>
								<div class="h-5 rounded bg-[var(--timeline-clip)]"></div>
								<div class="mt-1 h-4 rounded bg-[var(--timeline-waveform)]/30"></div>
								<div
									class="absolute top-0 bottom-0 left-1/3 w-px bg-[var(--timeline-playhead)]"
								></div>
							</div>
						{/if}
					</div>
				</div>
			{:else}
				<main data-slot="page-container" data-theme-content>
					<div
						data-slot="page-header"
						data-theme-header
						class="flex flex-wrap items-start justify-between"
					>
						<div>
							<p data-theme-type="metadata" class="text-muted-foreground">
								{activeCopy.eyebrow}
							</p>
							<h3 data-theme-type="title" class="mt-[var(--theme-space)]">
								{activeCopy.title}
							</h3>
						</div>
						{#if showCreateAction}
							<Button size="sm" intent="focal" disabled={!interactive}
								><ThemeIcon role="compose" class="size-3.5" /> Create post</Button
							>
						{/if}
					</div>

					{#if scene === 'composer'}
						<section
							data-slot="card"
							class="rounded-[var(--theme-radius-lg,var(--radius))] border border-border bg-card p-3 shadow-[var(--theme-shadow-card,none)]"
						>
							<p id="preview-composer-label" data-theme-type="label">Draft</p>
							<div
								id="preview-composer"
								role="textbox"
								aria-readonly="true"
								aria-labelledby="preview-composer-label"
								data-theme-type="body"
								class="mt-2 min-h-28 rounded-[var(--theme-radius-md,var(--radius))] border border-input bg-background p-3"
							>
								We rebuilt the onboarding path around one clear first win. Here is what changed and
								what we learned.
							</div>
							<div class="mt-3 flex items-center justify-between gap-2">
								<span data-theme-type="metadata" class="text-muted-foreground"
									>LinkedIn · Bluesky · Threads</span
								>
								<Button size="sm" intent="primary" disabled={!interactive}>Review</Button>
							</div>
						</section>
					{:else if scene === 'calendar'}
						<div class="preview-calendar-grid grid grid-cols-7 gap-1.5">
							{#each Array.from({ length: 21 }) as _, day (day)}
								<div
									data-theme-type="metadata"
									class="min-h-12 rounded-[var(--theme-radius-sm,var(--radius))] border border-border bg-card p-1 text-muted-foreground"
								>
									{day + 1}
									{#if day === 3 || day === 8 || day === 15}
										<div class="mt-1 h-2 rounded-full bg-[var(--action-primary)]"></div>
									{/if}
								</div>
							{/each}
						</div>
					{:else if scene === 'shell'}
						<div class="space-y-3">
							<div
								class="grid min-h-24 grid-cols-[minmax(0,1fr)_auto] items-center gap-4 rounded-[var(--theme-radius-lg,var(--radius))] border border-border bg-card p-4"
							>
								<div>
									<p data-theme-type="label">One workspace, one complete visual system</p>
									<p data-theme-type="body" class="mt-1 max-w-md text-muted-foreground">
										The canvas, navigation, actions, type, and density change together.
									</p>
								</div>
								<div
									class="size-12 rounded-[var(--theme-radius-media,var(--radius))] bg-[var(--chart-1)]/18"
								></div>
							</div>
							<div class="grid grid-cols-3 gap-2">
								{#each ['Navigation', 'Content', 'Actions'] as layer (layer)}
									<div
										class="rounded-[var(--theme-radius-md,var(--radius))] border border-border bg-card p-2.5"
									>
										<div class="mb-3 h-1.5 w-2/3 rounded-full bg-muted-foreground/30"></div>
										<p data-theme-type="label">{layer}</p>
									</div>
								{/each}
							</div>
						</div>
					{:else if scene === 'cards'}
						<div class="preview-card-grid grid grid-cols-3 gap-2.5">
							{#each [['Launch notes', 'Ready', 'var(--chart-1)'], ['Behind the build', 'Draft', 'var(--chart-2)'], ['Customer lesson', 'Scheduled', 'var(--chart-3)']] as card (card[0])}
								<article
									data-slot="card"
									class="overflow-hidden rounded-[var(--theme-radius-lg,var(--radius))] border border-border bg-card shadow-[var(--theme-shadow-card,none)]"
								>
									<div
										class="h-20"
										style:background={`color-mix(in srgb, ${card[2]} 22%, var(--card))`}
									></div>
									<div class="p-3">
										<p data-theme-type="label">{card[0]}</p>
										<p data-theme-type="metadata" class="mt-1 text-muted-foreground">
											{card[1]} · 2 channels
										</p>
									</div>
								</article>
							{/each}
						</div>
					{:else if scene === 'tables'}
						<div
							class="overflow-hidden rounded-[var(--theme-radius-lg,var(--radius))] border border-border bg-card"
						>
							<table data-theme-type="metadata" class="w-full border-collapse text-left">
								<thead class="bg-muted text-muted-foreground">
									<tr>
										<th class="px-3 py-2 font-medium">Publication</th>
										<th class="px-3 py-2 font-medium">Status</th>
										<th class="px-3 py-2 text-right font-medium">Reach</th>
									</tr>
								</thead>
								<tbody data-slot="table-body" class="divide-y divide-border">
									{#each [['Launch notes', 'Published', '12.4k'], ['Build log', 'Scheduled', '—'], ['Customer lesson', 'Draft', '—']] as row (row[0])}
										<tr data-slot="table-row">
											<td class="px-3 py-2.5 font-medium">{row[0]}</td>
											<td class="px-3 py-2.5 text-muted-foreground">{row[1]}</td>
											<td data-theme-type="code" class="px-3 py-2.5 text-right tabular-nums"
												>{row[2]}</td
											>
										</tr>
									{/each}
								</tbody>
							</table>
						</div>
					{:else if scene === 'settings'}
						<div
							data-slot="card"
							class="divide-y divide-border rounded-[var(--theme-radius-lg,var(--radius))] border border-border bg-card px-3"
						>
							{#each ['Default timezone', 'Publishing safeguards', 'Team approvals', 'Notifications'] as setting, index (setting)}
								<div class="flex min-h-12 items-center justify-between gap-3 py-2">
									<div>
										<p data-theme-type="label">{setting}</p>
										<p data-theme-type="metadata" class="text-muted-foreground">
											{index % 2 === 0 ? 'Workspace default' : 'Enabled'}
										</p>
									</div>
									<div class="h-5 w-9 rounded-full bg-[var(--action-primary)] p-0.5">
										<div class="ml-auto size-4 rounded-full bg-white"></div>
									</div>
								</div>
							{/each}
						</div>
					{:else if scene === 'forms'}
						<form
							class="grid gap-3 rounded-[var(--theme-radius-lg,var(--radius))] border border-border bg-card p-4"
							onsubmit={(event) => event.preventDefault()}
						>
							<label data-theme-type="label" class="grid gap-1.5">
								Workspace name
								<input
									data-slot="input"
									data-theme-type="body"
									class="min-h-9 rounded-[var(--theme-radius-md,var(--radius))] border border-input bg-background px-3 outline-none focus-visible:ring-2 focus-visible:ring-ring"
									value="Northstar"
									readonly={!interactive}
								/>
							</label>
							<label data-theme-type="label" class="grid gap-1.5">
								Default timezone
								<select
									data-slot="select-trigger"
									data-theme-type="body"
									class="min-h-9 rounded-[var(--theme-radius-md,var(--radius))] border border-input bg-background px-3 outline-none focus-visible:ring-2 focus-visible:ring-ring"
									disabled={!interactive}
								>
									<option>Europe/Lisbon</option>
								</select>
							</label>
							<div class="flex flex-wrap justify-end gap-2 pt-1">
								<Button size="sm" intent="quiet" disabled={!interactive}>Cancel</Button>
								<Button size="sm" intent="primary" disabled={!interactive}>Save changes</Button>
							</div>
						</form>
					{:else if scene === 'dialog'}
						<div
							class="relative min-h-56 overflow-hidden rounded-[var(--theme-radius-lg,var(--radius))] border border-border bg-card p-4"
						>
							<div class="space-y-2 opacity-45" aria-hidden="true">
								<div class="h-3 w-1/3 rounded-full bg-muted"></div>
								<div class="h-20 rounded-[var(--theme-radius-md,var(--radius))] bg-muted"></div>
							</div>
							<div
								class="absolute inset-0 grid place-items-center bg-[var(--theme-scrim,rgba(0,0,0,0.42))] p-4"
							>
								<div
									data-slot="dialog-content"
									role="dialog"
									aria-label="Delete draft"
									class="w-full max-w-72 rounded-[var(--theme-radius-lg,var(--radius))] border border-border bg-popover p-4 text-popover-foreground shadow-[var(--theme-shadow-dialog,none)]"
								>
									<p data-theme-type="title">Delete this draft?</p>
									<p data-theme-type="body" class="mt-1 text-muted-foreground">
										This removes the draft from every destination. Published posts stay live.
									</p>
									<div class="mt-4 flex justify-end gap-2">
										<Button size="sm" intent="quiet" disabled={!interactive}>Keep draft</Button>
										<Button size="sm" intent="destructive" disabled={!interactive}>Delete</Button>
									</div>
								</div>
							</div>
						</div>
					{:else if scene === 'notices'}
						<div class="space-y-2.5">
							{#each [['success', 'Published on LinkedIn', 'The post is live and ready to inspect.'], ['warning', 'One destination needs review', 'Threads shortened the caption to fit its limit.'], ['danger', 'Bluesky could not publish', 'Reconnect the account, then retry this rendition.'], ['info', 'Draft saved', 'Your latest edits are available to the team.']] as notice (notice[1])}
								<div
									data-slot="toast"
									class="grid grid-cols-[0.4rem_1fr] overflow-hidden rounded-[var(--theme-radius-md,var(--radius))] border border-border bg-card"
								>
									<div style:background={`var(--${notice[0]})`}></div>
									<div class="p-3">
										<p data-theme-type="label">{notice[1]}</p>
										<p data-theme-type="metadata" class="mt-0.5 text-muted-foreground">
											{notice[2]}
										</p>
									</div>
								</div>
							{/each}
						</div>
					{:else if scene === 'empty'}
						<div
							data-slot="empty-state"
							class="grid min-h-56 place-items-center rounded-[var(--theme-radius-lg,var(--radius))] border border-dashed border-border bg-card p-6 text-center"
						>
							<div class="max-w-64">
								{#if emptyStateAsset}
									<img
										class="mx-auto mb-4 max-h-24 max-w-32 rounded-[var(--theme-radius-media,var(--radius))] object-contain"
										src={emptyStateAsset.sourceUrl}
										alt={emptyStateAsset.alt ?? ''}
									/>
								{:else}
									<div
										class="mx-auto mb-4 grid size-16 place-items-center rounded-[var(--theme-radius-media,var(--radius))] bg-muted text-2xl text-muted-foreground"
									>
										<ThemeIcon role="compose" class="size-6" />
									</div>
								{/if}
								<p data-theme-type="title">Plan your first post</p>
								<p data-theme-type="body" class="mt-1 text-muted-foreground">
									Start from an idea, then tailor one rendition for each destination.
								</p>
								<Button class="mt-4" size="sm" intent="focal" disabled={!interactive}
									>Create post</Button
								>
							</div>
						</div>
					{:else if scene === 'loading'}
						<div class="space-y-3" aria-busy="true" aria-label="Loading workspace preview">
							{#if loadingAsset}
								<img
									data-theme-loading-art
									class="mx-auto max-h-20 max-w-28 rounded-[var(--theme-radius-media,var(--radius))] object-contain"
									src={loadingAsset.sourceUrl}
									alt={loadingAsset.alt ?? ''}
								/>
							{/if}
							<div
								data-slot="skeleton"
								class="h-20 animate-pulse rounded-[var(--theme-radius-lg,var(--radius))] bg-muted motion-reduce:animate-none"
							></div>
							<div class="grid grid-cols-2 gap-3">
								<div
									data-slot="skeleton"
									class="h-28 animate-pulse rounded-[var(--theme-radius-lg,var(--radius))] bg-muted motion-reduce:animate-none"
								></div>
								<div
									data-slot="skeleton"
									class="h-28 animate-pulse rounded-[var(--theme-radius-lg,var(--radius))] bg-muted motion-reduce:animate-none"
								></div>
							</div>
							<p data-theme-type="metadata" class="text-center text-muted-foreground">
								Loading publications…
							</p>
						</div>
					{:else}
						<div class="preview-dashboard-grid grid grid-cols-[1.35fr_1fr] gap-3">
							<section
								data-slot="card"
								class="rounded-[var(--theme-radius-lg,var(--radius))] border border-border bg-card p-3 shadow-[var(--theme-shadow-card,none)]"
							>
								<div class="flex items-center justify-between gap-3">
									<div>
										<p data-theme-type="metadata" class="text-muted-foreground">This week</p>
										<p data-theme-type="display" class="mt-1 tabular-nums">12 posts</p>
									</div>
									<span
										data-theme-type="label"
										class="rounded-[var(--theme-radius-pill,999px)] bg-success/12 px-2 py-1 text-success"
										>On track</span
									>
								</div>
								<div class="mt-5 flex h-20 items-end gap-1.5">
									{#each [35, 58, 44, 76, 62, 88, 51] as height, index (index)}
										<div
											class="min-w-0 flex-1 rounded-t-[var(--theme-radius-sm,var(--radius))] bg-[var(--chart-1)]/75"
											style:height={`${height}%`}
										></div>
									{/each}
								</div>
							</section>
							<section
								data-slot="card"
								class="rounded-[var(--theme-radius-lg,var(--radius))] border border-border bg-card p-3 shadow-[var(--theme-shadow-card,none)]"
							>
								<p data-theme-type="label">Ready to publish</p>
								<div class="mt-3 space-y-2">
									{#each ['Launch notes', 'Behind the build', 'Customer lesson'] as item, index (item)}
										<div
											class="flex items-center gap-2 rounded-[var(--theme-radius-sm,var(--radius))] bg-muted p-2"
										>
											<span class="size-2 rounded-full bg-[var(--chart-2)]"></span>
											<span data-theme-type="body" class="min-w-0 flex-1 truncate">{item}</span>
											<span data-theme-type="metadata" class="text-muted-foreground"
												>{index + 1}:30</span
											>
										</div>
									{/each}
								</div>
							</section>
						</div>
					{/if}
				</main>
			{/if}
		</div>
	</div>
	{#if scene !== 'image-editor' && scene !== 'video-editor'}
		<nav
			data-slot="mobile-bottom-nav"
			class="preview-mobile-navigation absolute inset-x-0 bottom-0 hidden border-t border-border bg-background px-1"
			aria-label="Preview mobile navigation"
		>
			<ul class="grid min-h-full grid-cols-5">
				{#each [['Home', 'home'], ['New', 'compose'], ['Plan', 'calendar'], ['Media', 'media'], ['More', 'menu']] as item, index (item[0])}
					<li class="min-w-0">
						<div
							data-theme-navigation-item
							data-active={index === 0}
							class="flex min-h-[var(--theme-touch-target)] flex-col items-center justify-center gap-1 rounded-[var(--theme-radius-sm)] px-1"
						>
							<ThemeIcon
								role={item[1] as 'home' | 'compose' | 'calendar' | 'media' | 'menu'}
								class="size-4"
							/>
							<span data-theme-type="label" class="max-w-full truncate">{item[0]}</span>
						</div>
					</li>
				{/each}
			</ul>
		</nav>
	{/if}
</div>

<style>
	.theme-preview-scene {
		container-type: inline-size;
	}

	@container (max-width: 34rem) {
		.preview-sidebar,
		.preview-desktop-meta {
			display: none;
		}

		.preview-mobile-brand {
			display: flex;
		}

		.preview-shell-content {
			padding-bottom: var(--theme-mobile-navigation-height);
		}

		.preview-mobile-navigation {
			display: block;
		}

		.preview-card-grid,
		.preview-dashboard-grid {
			grid-template-columns: minmax(0, 1fr);
		}

		.preview-calendar-grid {
			grid-template-columns: repeat(4, minmax(0, 1fr));
		}
	}
</style>
