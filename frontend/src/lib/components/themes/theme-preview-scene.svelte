<script lang="ts">
	import Logo from '$lib/components/Logo.svelte';
	import AppSelect from '$lib/components/app-select.svelte';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { getLocale, type Locale } from '$lib/paraglide/runtime';
	import { ThemeIcon } from '$lib/themes/icons';
	import type { WebResolvedTheme } from '$lib/themes';
	import { themePreviewCopy } from './theme-preview-copy.js';
	import type { ThemePreviewScene } from './theme-preview-types.js';

	interface Props {
		theme: WebResolvedTheme;
		scene?: ThemePreviewScene;
		interactive?: boolean;
		locale?: Locale;
	}

	let { theme, scene = 'dashboard', interactive = false, locale = getLocale() }: Props = $props();
	const createActionScenes = new Set<ThemePreviewScene>([
		'dashboard',
		'cards',
		'calendar',
		'tables'
	]);
	const copy = $derived(themePreviewCopy(locale));
	const activeCopy = $derived(copy.scenes[scene]);
	const emptyStateAsset = $derived(
		theme.assets.find((asset) => asset.slot === 'empty-state-illustration')
	);
	const loadingAsset = $derived(
		theme.assets.find((asset) => asset.slot === 'loading-illustration')
	);
	const showCreateAction = $derived(createActionScenes.has(scene));
</script>

<div
	class="theme-preview-scene relative h-screen max-w-full overflow-hidden bg-background text-foreground"
	data-preview-scene={scene}
	data-slot="app-shell"
	data-theme-type="body"
>
	<div
		class="pointer-events-none absolute inset-0 bg-[image:var(--theme-asset-background-texture)] bg-repeat opacity-20"
	></div>
	<div class="relative flex h-full">
		<aside
			data-slot="sidebar"
			class="preview-sidebar flex shrink-0 flex-col border-r border-sidebar-border bg-sidebar bg-[image:var(--theme-asset-sidebar-decoration)] bg-bottom bg-no-repeat p-3 text-sidebar-foreground"
			style="width: min(var(--theme-sidebar-width, 16rem), 34%);"
		>
			<Logo showText width={92} height={20} class="mb-5" />
			<nav class="space-y-1" aria-label={copy.previewNavigation}>
				{#each copy.desktopNavigation as item, index (item.role)}
					<div
						data-theme-type="label"
						class={[
							'flex min-h-8 items-center gap-2 rounded-[var(--theme-radius-sm,var(--radius))] px-2',
							index === 0
								? 'bg-sidebar-primary text-sidebar-primary-foreground'
								: 'text-sidebar-foreground/65'
						]}
					>
						<ThemeIcon role={item.role} class="size-3.5" />
						{item.label}
					</div>
				{/each}
			</nav>
			<div
				class="mt-auto rounded-[var(--theme-radius-md,var(--radius))] border border-sidebar-border p-2"
			>
				<p data-theme-type="label">{copy.workspaceName}</p>
				<p data-theme-type="metadata" class="mt-0.5 text-sidebar-foreground/60">
					{copy.scheduledToday}
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
					{copy.allSystemsReady}
				</div>
				<div class="ml-auto flex items-center gap-2">
					<span data-theme-type="metadata" class="hidden text-muted-foreground sm:inline"
						>{copy.date}</span
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
								><ThemeIcon role="compose" class="size-3.5" /> {copy.createPost}</Button
							>
						{/if}
					</div>

					{#if scene === 'composer'}
						<section
							data-slot="card"
							class="rounded-[var(--theme-radius-lg,var(--radius))] border border-border bg-card p-3 shadow-[var(--theme-shadow-card,none)]"
						>
							<p id="preview-composer-label" data-theme-type="label">{copy.draft}</p>
							<div
								id="preview-composer"
								role="textbox"
								aria-readonly="true"
								aria-labelledby="preview-composer-label"
								data-preview-copy="composer-body"
								data-theme-type="body"
								class="mt-2 min-h-28 rounded-[var(--theme-radius-md,var(--radius))] border border-input bg-background p-3"
							>
								{copy.composerBody}
							</div>
							<div class="mt-3 flex items-center justify-between gap-2">
								<span data-theme-type="metadata" class="text-muted-foreground"
									>{copy.composerDestinations}</span
								>
								<Button size="sm" intent="primary" disabled={!interactive}>{copy.review}</Button>
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
									<p data-theme-type="label">{copy.shellStatement}</p>
									<p data-theme-type="body" class="mt-1 max-w-md text-muted-foreground">
										{copy.shellDescription}
									</p>
								</div>
								<div
									class="size-12 rounded-[var(--theme-radius-media,var(--radius))] bg-[var(--chart-1)]/18"
								></div>
							</div>
							<div class="grid grid-cols-3 gap-2">
								{#each copy.shellLayers as layer (layer)}
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
							{#each copy.cards as card (card.title)}
								<article
									data-slot="card"
									class="overflow-hidden rounded-[var(--theme-radius-lg,var(--radius))] border border-border bg-card shadow-[var(--theme-shadow-card,none)]"
								>
									<div
										class="h-20"
										style:background={`color-mix(in srgb, ${card.color} 22%, var(--card))`}
									></div>
									<div class="p-3">
										<p data-theme-type="label">{card.title}</p>
										<p data-theme-type="metadata" class="mt-1 text-muted-foreground">
											{card.status} · {copy.channels}
										</p>
									</div>
								</article>
							{/each}
						</div>
					{:else if scene === 'tables'}
						<div
							class="overflow-hidden rounded-[var(--theme-radius-lg,var(--radius))] border border-border bg-card"
						>
							<table
								data-theme-type="metadata"
								class="w-full table-fixed border-collapse text-left"
							>
								<thead class="bg-muted text-muted-foreground">
									<tr>
										<th class="w-[46%] px-3 py-2 font-medium">{copy.tableHeaders.publication}</th>
										<th class="w-[34%] px-3 py-2 font-medium">{copy.tableHeaders.status}</th>
										<th class="w-[20%] px-3 py-2 text-right font-medium"
											>{copy.tableHeaders.reach}</th
										>
									</tr>
								</thead>
								<tbody data-slot="table-body" class="divide-y divide-border">
									{#each copy.tableRows as row (row.publication)}
										<tr data-slot="table-row">
											<td class="px-3 py-2.5 font-medium break-words">{row.publication}</td>
											<td class="px-3 py-2.5 break-words text-muted-foreground">{row.status}</td>
											<td data-theme-type="code" class="px-3 py-2.5 text-right tabular-nums"
												>{row.reach}</td
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
							{#each copy.settings as setting, index (setting)}
								<div class="flex min-h-12 items-center justify-between gap-3 py-2">
									<div>
										<p data-theme-type="label">{setting}</p>
										<p data-theme-type="metadata" class="text-muted-foreground">
											{index % 2 === 0 ? copy.workspaceDefault : copy.enabled}
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
								{copy.workspaceNameLabel}
								<Input data-theme-type="body" value="Northstar" readonly={!interactive} />
							</label>
							<label data-theme-type="label" class="grid gap-1.5">
								{copy.defaultTimezone}
								<AppSelect
									value="Europe/Lisbon"
									options={[{ value: 'Europe/Lisbon', label: 'Europe/Lisbon' }]}
									disabled={!interactive}
								/>
							</label>
							<div class="flex flex-wrap justify-end gap-2 pt-1">
								<Button size="sm" intent="quiet" disabled={!interactive}>{copy.cancel}</Button>
								<Button size="sm" intent="primary" disabled={!interactive}
									>{copy.saveChanges}</Button
								>
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
									aria-label={copy.deleteDraftLabel}
									class="w-full max-w-72 rounded-[var(--theme-radius-lg,var(--radius))] border border-border bg-popover p-4 text-popover-foreground shadow-[var(--theme-shadow-dialog,none)]"
								>
									<p data-theme-type="title">{copy.deleteDraftTitle}</p>
									<p data-theme-type="body" class="mt-1 text-muted-foreground">
										{copy.deleteDraftDescription}
									</p>
									<div class="mt-4 flex justify-end gap-2">
										<Button size="sm" intent="quiet" disabled={!interactive}
											>{copy.keepDraft}</Button
										>
										<Button size="sm" intent="destructive" disabled={!interactive}
											>{copy.delete}</Button
										>
									</div>
								</div>
							</div>
						</div>
					{:else if scene === 'notices'}
						<div class="space-y-2.5">
							{#each copy.notices as notice (notice.title)}
								<div
									data-slot="toast"
									class="grid grid-cols-[0.4rem_1fr] overflow-hidden rounded-[var(--theme-radius-md,var(--radius))] border border-border bg-card"
								>
									<div style:background={`var(--${notice.tone})`}></div>
									<div class="p-3">
										<p data-theme-type="label">{notice.title}</p>
										<p data-theme-type="metadata" class="mt-0.5 text-muted-foreground">
											{notice.description}
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
								<p data-theme-type="title">{copy.emptyTitle}</p>
								<p data-theme-type="body" class="mt-1 text-muted-foreground">
									{copy.emptyDescription}
								</p>
								<Button class="mt-4" size="sm" intent="focal" disabled={!interactive}
									>{copy.createPost}</Button
								>
							</div>
						</div>
					{:else if scene === 'loading'}
						<div class="space-y-3" aria-busy="true" aria-label={copy.loadingWorkspace}>
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
								{copy.loadingPublications}
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
										<p data-theme-type="metadata" class="text-muted-foreground">{copy.thisWeek}</p>
										<p data-theme-type="display" class="mt-1 tabular-nums">{copy.postCount}</p>
									</div>
									<span
										data-theme-type="label"
										class="rounded-[var(--theme-radius-pill,999px)] bg-success/12 px-2 py-1 text-success"
										>{copy.onTrack}</span
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
								<p data-theme-type="label">{copy.readyToPublish}</p>
								<div class="mt-3 space-y-2">
									{#each copy.readyItems as item, index (item)}
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
			aria-label={copy.previewMobileNavigation}
		>
			<ul class="grid min-h-full grid-cols-5">
				{#each copy.mobileNavigation as item, index (item.role)}
					<li class="min-w-0">
						<div
							data-theme-navigation-item
							data-active={index === 0}
							class="flex min-h-[var(--theme-touch-target)] flex-col items-center justify-center gap-1 rounded-[var(--theme-radius-sm)] px-1"
						>
							<ThemeIcon role={item.role} class="size-4" />
							<span data-theme-type="label" class="max-w-full truncate">{item.label}</span>
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
