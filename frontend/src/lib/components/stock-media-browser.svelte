<script lang="ts">
	import { onMount } from 'svelte';
	import { slide } from 'svelte/transition';
	import { Button } from '$lib/components/ui/button';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import { Input } from '$lib/components/ui/input';
	import AppSelect from '$lib/components/app-select.svelte';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import { m } from '$lib/paraglide/messages';
	import { stockMediaKindsForProviders } from '$lib/stock-media-kinds';
	import {
		listStockProviders,
		resolveStockAsset,
		searchStockMedia,
		type StockAsset,
		type StockProvider
	} from '$lib/video-editor/api';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import ImageIcon from '@lucide/svelte/icons/image';
	import LoaderIcon from '@lucide/svelte/icons/loader-2';
	import SearchIcon from '@lucide/svelte/icons/search';
	import SlidersIcon from '@lucide/svelte/icons/sliders-horizontal';
	import VideoIcon from '@lucide/svelte/icons/video';

	interface Props {
		accept?: 'photo' | 'video' | 'both';
		compact?: boolean;
		onSelect: (file: File, asset: StockAsset) => void | Promise<void>;
	}

	let { accept = 'both', compact = false, onSelect }: Props = $props();
	let providers = $state.raw<StockProvider[]>([]);
	let provider = $state('');
	let kind = $state<'photo' | 'video'>('photo');
	let query = $state('');
	let results = $state.raw<StockAsset[]>([]);
	let loading = $state(true);
	let searching = $state(false);
	let selecting = $state('');
	let error = $state('');
	let searched = $state(false);
	let filtersOpen = $state(false);
	let orientation = $state('');
	let size = $state('');
	let color = $state('');
	let locale = $state('');
	let order = $state('');
	let contentFilter = $state('');
	let collections = $state('');
	let category = $state('');
	let mediaSubtype = $state('');
	let editorsChoice = $state(false);
	let minWidth = $state('');
	let minHeight = $state('');
	let page = $state(1);
	let hasMore = $state(false);
	let total = $state(0);

	onMount(() => {
		void initialize();
	});

	const currentProvider = $derived(providers.find((item) => item.key === provider));
	const availableFilters = $derived(
		new Set(
			kind === 'photo'
				? (currentProvider?.photo_filters ?? [])
				: (currentProvider?.video_filters ?? [])
		)
	);
	const providerOptions = $derived(
		providers
			.filter((item) => (kind === 'photo' ? item.photos : item.videos))
			.map((item) => ({ value: item.key, label: providerLabel(item) }))
	);
	const kindOptions = $derived(
		stockMediaKindsForProviders(providers, accept).map((value) => ({
			value,
			label: value === 'photo' ? m.video_editor_stock_photos() : m.video_editor_stock_videos()
		}))
	);
	const orientationOptions = $derived([
		{ value: '', label: m.stock_filter_any_orientation() },
		{ value: 'landscape', label: m.stock_filter_landscape() },
		{ value: 'portrait', label: m.stock_filter_portrait() },
		...(provider !== 'pixabay' ? [{ value: 'square', label: m.stock_filter_square() }] : [])
	]);
	const selectingAsset = $derived(results.find((asset) => asset.external_id === selecting) ?? null);
	const emptyMessage = $derived(
		accept === 'photo' ? m.image_editor_stock_empty() : m.video_editor_stock_empty()
	);
	const activeFilterCount = $derived.by(() => {
		const values = [
			orientation,
			size,
			color,
			locale,
			order,
			contentFilter,
			collections.trim(),
			category,
			mediaSubtype,
			minWidth,
			minHeight
		];
		return values.filter(Boolean).length + (editorsChoice ? 1 : 0);
	});

	async function initialize(): Promise<void> {
		loading = true;
		error = '';
		try {
			if (accept === 'video') kind = 'video';
			providers = await listStockProviders();
			provider = providers.find((item) => supportsKind(item, kind))?.key ?? '';
		} catch (cause) {
			error = cause instanceof Error ? cause.message : m.video_editor_stock_unavailable();
		} finally {
			loading = false;
		}
	}

	function retry(): void {
		if (providers.length === 0) {
			void initialize();
			return;
		}
		void search(results.length === 0);
	}

	function supportsKind(item: StockProvider, requestedKind: 'photo' | 'video'): boolean {
		return requestedKind === 'photo' ? item.photos : item.videos;
	}

	function providerLabel(item: StockProvider): string {
		if (item.photos && item.videos) return m.stock_provider_photos_videos({ provider: item.name });
		if (item.videos) return m.stock_provider_videos_only({ provider: item.name });
		return m.stock_provider_photos_only({ provider: item.name });
	}

	function changeProvider(value: string): void {
		provider = value;
		resetFilters();
		results = [];
		searched = false;
	}

	function changeKind(value: string): void {
		kind = value as 'photo' | 'video';
		if (!currentProvider || !supportsKind(currentProvider, kind)) {
			provider = providers.find((item) => supportsKind(item, kind))?.key ?? '';
		}
		resetFilters();
		results = [];
		searched = false;
	}

	async function search(reset = true): Promise<void> {
		if (!query.trim() || !provider || searching) return;
		searching = true;
		error = '';
		searched = true;
		const requestedPage = reset ? 1 : page + 1;
		try {
			const response = await searchStockMedia({
				provider,
				query: query.trim(),
				kind,
				orientation: filterValue('orientation', orientation) as
					'landscape' | 'portrait' | 'square' | undefined,
				size: filterValue('size', size) as 'small' | 'medium' | 'large' | undefined,
				color: filterValue('color', color),
				locale: filterValue('locale', locale),
				order: filterValue('order', order) as 'relevant' | 'latest' | 'popular' | undefined,
				contentFilter: filterValue('content_filter', contentFilter) as 'low' | 'high' | undefined,
				collections: filterValue('collections', collections.trim()),
				category: filterValue('category', category),
				mediaSubtype: filterValue('media_subtype', mediaSubtype) as
					'all' | 'photo' | 'illustration' | 'vector' | undefined,
				editorsChoice: availableFilters.has('editors_choice') ? editorsChoice : undefined,
				minWidth: availableFilters.has('min_dimensions') ? positiveNumber(minWidth) : undefined,
				minHeight: availableFilters.has('min_dimensions') ? positiveNumber(minHeight) : undefined,
				page: requestedPage
			});
			results = reset ? (response.items ?? []) : [...results, ...(response.items ?? [])];
			page = response.page;
			hasMore = response.has_more;
			total = response.total;
		} catch (cause) {
			error = cause instanceof Error ? cause.message : m.video_editor_stock_search_failed();
		} finally {
			searching = false;
		}
	}

	function filterValue(filter: string, value: string): string | undefined {
		return availableFilters.has(filter) && value ? value : undefined;
	}

	function positiveNumber(value: string): number | undefined {
		const parsed = Number(value);
		return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : undefined;
	}

	function resetFilters(): void {
		orientation = '';
		size = '';
		color = '';
		locale = '';
		order = '';
		contentFilter = '';
		collections = '';
		category = '';
		mediaSubtype = '';
		editorsChoice = false;
		minWidth = '';
		minHeight = '';
	}

	async function selectAsset(asset: StockAsset): Promise<void> {
		if (selecting) return;
		selecting = asset.external_id;
		error = '';
		try {
			const resolved = await resolveStockAsset(asset.provider, asset.external_id);
			const response = await fetch(resolved.download_url, {
				mode: 'cors',
				credentials: 'omit',
				referrerPolicy: 'no-referrer'
			});
			if (!response.ok) throw new Error(m.video_editor_stock_download_failed());
			const blob = await response.blob();
			const extension = resolved.mime_type.includes('video') ? 'mp4' : 'jpg';
			const file = new File(
				[blob],
				`${asset.provider}-${asset.external_id.replaceAll(':', '-')}.${extension}`,
				{ type: resolved.mime_type, lastModified: Date.now() }
			);
			await onSelect(file, asset);
		} catch (cause) {
			error = cause instanceof Error ? cause.message : m.video_editor_stock_download_failed();
		} finally {
			selecting = '';
		}
	}

	function colorOptions(): Array<{ value: string; label: string }> {
		const shared = ['red', 'orange', 'yellow', 'green', 'blue', 'black', 'white'];
		const values =
			provider === 'unsplash'
				? ['black_and_white', ...shared, 'purple', 'magenta', 'teal']
				: provider === 'pixabay'
					? ['grayscale', 'transparent', ...shared, 'turquoise', 'lilac', 'pink', 'gray', 'brown']
					: [...shared, 'turquoise', 'violet', 'pink', 'brown', 'gray'];
		return [
			{ value: '', label: m.stock_filter_any_color() },
			...values.map((value) => ({ value, label: value.replaceAll('_', ' ') }))
		];
	}
</script>

<div class={compact ? 'space-y-3' : 'space-y-4'}>
	<div>
		<h2 class={compact ? 'text-sm font-semibold' : 'text-base font-semibold'}>
			{m.video_editor_stock_search()}
		</h2>
		<p
			class={compact ? 'mt-1 text-xs text-muted-foreground' : 'mt-1 text-sm text-muted-foreground'}
		>
			{m.stock_search_provider_truth()}
		</p>
	</div>

	{#if error}
		<InlineNotice tone="error" message={error}>
			{#snippet actions()}
				<Button variant="outline" size="sm" onclick={retry}>
					{m.common_retry()}
				</Button>
			{/snippet}
		</InlineNotice>
	{/if}
	{#if selectingAsset}
		<p
			class="flex items-center gap-2 text-sm text-muted-foreground"
			role="status"
			aria-live="polite"
		>
			<LoaderIcon class="size-4 animate-spin" />
			{m.video_editor_stock_downloading({ title: selectingAsset.title || selectingAsset.kind })}
		</p>
	{/if}

	{#if loading}
		<div class="flex items-center gap-2 py-6 text-sm text-muted-foreground" role="status">
			<LoaderIcon class="size-4 animate-spin" />
			{m.common_loading()}
		</div>
	{:else if providers.length === 0}
		<InlineNotice tone="info" message={m.video_editor_stock_unavailable()} />
	{:else}
		<form
			class="space-y-3"
			onsubmit={(event) => {
				event.preventDefault();
				void search();
			}}
		>
			<div
				class={compact ? 'grid gap-2' : 'grid gap-2 sm:grid-cols-[minmax(0,1fr)_13rem_9rem_auto]'}
			>
				<div class="relative">
					<SearchIcon
						class="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
					/>
					<Input
						bind:value={query}
						class="pl-9"
						placeholder={m.video_editor_stock_query_placeholder()}
						aria-label={m.video_editor_stock_search()}
					/>
				</div>
				<AppSelect
					value={provider}
					onValueChange={changeProvider}
					options={providerOptions}
					ariaLabel={m.video_editor_stock_provider()}
				/>
				{#if kindOptions.length > 1}
					<AppSelect
						value={kind}
						onValueChange={changeKind}
						options={kindOptions}
						ariaLabel={m.video_editor_stock_kind()}
					/>
				{/if}
				<Button type="submit" disabled={!query.trim() || !provider || searching}>
					{#if searching}<LoaderIcon class="size-4 animate-spin" />{:else}<SearchIcon
							class="size-4"
						/>{/if}
					{m.video_editor_stock_search_action()}
				</Button>
			</div>

			<div class="flex flex-wrap items-center gap-2">
				<Button
					type="button"
					variant="outline"
					size="sm"
					onclick={() => (filtersOpen = !filtersOpen)}
				>
					<SlidersIcon />
					{m.stock_filters()}
					{#if activeFilterCount > 0}<span class="font-mono text-xs">{activeFilterCount}</span>{/if}
					<ChevronDownIcon
						class={filtersOpen ? 'rotate-180 transition-transform' : 'transition-transform'}
					/>
				</Button>
				{#if currentProvider}
					<span class="text-xs text-muted-foreground">
						{kind === 'photo'
							? m.stock_provider_searching_photos({ provider: currentProvider.name })
							: m.stock_provider_searching_videos({ provider: currentProvider.name })}
					</span>
				{/if}
				{#if activeFilterCount > 0}
					<Button type="button" variant="ghost" size="sm" onclick={resetFilters}
						>{m.stock_filters_clear()}</Button
					>
				{/if}
			</div>

			{#if filtersOpen}
				<div
					class="grid gap-3 rounded-xl border bg-muted/15 p-3 sm:grid-cols-2 lg:grid-cols-3"
					transition:slide={{ duration: 180 }}
				>
					{#if availableFilters.has('orientation')}
						<label class="grid gap-1 text-xs text-muted-foreground">
							<span>{m.stock_filter_orientation()}</span>
							<AppSelect bind:value={orientation} options={orientationOptions} class="h-10" />
						</label>
					{/if}
					{#if availableFilters.has('size')}
						<label class="grid gap-1 text-xs text-muted-foreground">
							<span>{m.stock_filter_minimum_size()}</span>
							<AppSelect
								bind:value={size}
								options={[
									{ value: '', label: m.stock_filter_any_size() },
									{ value: 'small', label: m.stock_filter_small() },
									{ value: 'medium', label: m.stock_filter_medium() },
									{ value: 'large', label: m.stock_filter_large() }
								]}
								class="h-10"
							/>
						</label>
					{/if}
					{#if availableFilters.has('color')}
						<label class="grid gap-1 text-xs text-muted-foreground">
							<span>{m.stock_filter_color()}</span>
							<AppSelect bind:value={color} options={colorOptions()} class="h-10 capitalize" />
						</label>
					{/if}
					{#if availableFilters.has('order')}
						<label class="grid gap-1 text-xs text-muted-foreground">
							<span>{m.stock_filter_order()}</span>
							<AppSelect
								bind:value={order}
								options={[
									{ value: '', label: m.stock_filter_provider_default() },
									...(provider === 'unsplash'
										? [{ value: 'relevant', label: m.stock_filter_relevant() }]
										: [{ value: 'popular', label: m.stock_filter_popular() }]),
									{ value: 'latest', label: m.stock_filter_latest() }
								]}
								class="h-10"
							/>
						</label>
					{/if}
					{#if availableFilters.has('media_subtype')}
						<label class="grid gap-1 text-xs text-muted-foreground">
							<span>{m.stock_filter_image_type()}</span>
							<AppSelect
								bind:value={mediaSubtype}
								options={[
									{ value: '', label: m.stock_filter_all_images() },
									{ value: 'photo', label: m.video_editor_stock_photos() },
									{ value: 'illustration', label: m.stock_filter_illustrations() },
									{ value: 'vector', label: m.stock_filter_vectors() }
								]}
								class="h-10"
							/>
						</label>
					{/if}
					{#if availableFilters.has('category')}
						<label class="grid gap-1 text-xs text-muted-foreground">
							<span>{m.stock_filter_category()}</span>
							<AppSelect
								bind:value={category}
								options={[
									{ value: '', label: m.stock_filter_any_category() },
									...[
										'backgrounds',
										'business',
										'computer',
										'education',
										'fashion',
										'food',
										'health',
										'industry',
										'music',
										'nature',
										'people',
										'places',
										'science',
										'sports',
										'transportation',
										'travel'
									].map((value) => ({ value, label: value }))
								]}
								class="h-10 capitalize"
							/>
						</label>
					{/if}
					{#if availableFilters.has('locale')}
						<label class="grid gap-1 text-xs text-muted-foreground">
							<span>{m.stock_filter_language()}</span>
							<AppSelect
								bind:value={locale}
								options={[
									{ value: '', label: m.stock_filter_provider_default() },
									{ value: provider === 'pexels' ? 'en-US' : 'en', label: 'English' },
									{ value: provider === 'pexels' ? 'pt-BR' : 'pt', label: 'Português' },
									{ value: provider === 'pexels' ? 'es-ES' : 'es', label: 'Español' },
									{ value: provider === 'pexels' ? 'fr-FR' : 'fr', label: 'Français' },
									{ value: provider === 'pexels' ? 'de-DE' : 'de', label: 'Deutsch' }
								]}
								class="h-10"
							/>
						</label>
					{/if}
					{#if availableFilters.has('content_filter')}
						<label class="grid gap-1 text-xs text-muted-foreground">
							<span>{m.stock_filter_content_safety()}</span>
							<AppSelect
								bind:value={contentFilter}
								options={[
									{ value: '', label: m.stock_filter_standard() },
									{ value: 'high', label: m.stock_filter_strict() }
								]}
								class="h-10"
							/>
						</label>
					{/if}
					{#if availableFilters.has('collections')}
						<label class="grid gap-1 text-xs text-muted-foreground">
							<span>{m.stock_filter_collection_ids()}</span>
							<Input
								bind:value={collections}
								placeholder={m.stock_filter_collection_placeholder()}
								class="h-10"
							/>
						</label>
					{/if}
					{#if availableFilters.has('min_dimensions')}
						<div class="grid grid-cols-2 gap-2">
							<label class="grid gap-1 text-xs text-muted-foreground">
								<span>{m.stock_filter_min_width()}</span>
								<Input
									type="number"
									min="0"
									max="20000"
									step="100"
									bind:value={minWidth}
									class="h-10"
								/>
							</label>
							<label class="grid gap-1 text-xs text-muted-foreground">
								<span>{m.stock_filter_min_height()}</span>
								<Input
									type="number"
									min="0"
									max="20000"
									step="100"
									bind:value={minHeight}
									class="h-10"
								/>
							</label>
						</div>
					{/if}
					{#if availableFilters.has('editors_choice')}
						<label class="flex min-h-10 items-center gap-2 self-end rounded-lg border px-3 text-sm">
							<Checkbox bind:checked={editorsChoice} />
							<span>{m.stock_filter_editors_choice()}</span>
						</label>
					{/if}
				</div>
			{/if}
		</form>

		{#if results.length > 0}
			<div class="flex items-center justify-between gap-3">
				<p class="text-sm text-muted-foreground">
					{total > 0
						? m.stock_results_count({ shown: results.length, total })
						: m.stock_results_shown({ count: results.length })}
				</p>
			</div>
			<div
				class={compact
					? 'grid grid-cols-2 gap-2'
					: 'grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4'}
			>
				{#each results as asset (`${asset.provider}:${asset.external_id}`)}
					<article class="group min-w-0 overflow-hidden rounded-xl border bg-card">
						<div class="relative aspect-[4/3] overflow-hidden bg-muted">
							{#if asset.thumbnail_url}
								<img
									src={asset.thumbnail_url}
									alt={asset.title}
									class="size-full object-cover transition-transform group-hover:scale-[1.02]"
									loading="lazy"
									referrerpolicy="no-referrer"
								/>
							{:else}
								<div class="flex size-full items-center justify-center">
									<ImageIcon class="size-5 text-muted-foreground" />
								</div>
							{/if}
							{#if asset.kind === 'video'}
								<span
									class="absolute bottom-2 left-2 flex size-7 items-center justify-center rounded-full bg-black/75 text-white"
								>
									<VideoIcon class="size-3.5" />
								</span>
								<span
									class="absolute right-2 bottom-2 rounded bg-black/75 px-1.5 py-0.5 font-mono text-xs text-white"
								>
									{Math.floor((asset.duration_seconds ?? 0) / 60)}:{String(
										(asset.duration_seconds ?? 0) % 60
									).padStart(2, '0')}
								</span>
							{/if}
						</div>
						<div class={compact ? 'space-y-1.5 p-2' : 'space-y-2 p-3'}>
							<p class="truncate text-sm font-medium">{asset.title || asset.kind}</p>
							<p class="truncate font-mono text-xs text-muted-foreground">
								{asset.width} × {asset.height}
							</p>
							<p class="truncate text-xs text-muted-foreground">
								<Button
									href={asset.creator_url}
									target="_blank"
									rel="noreferrer"
									variant="link"
									size="xs"
									class="h-auto p-0 text-xs text-muted-foreground"
								>
									{m.video_editor_stock_by({ creator: asset.creator_name })}
								</Button>
							</p>
							<Button
								variant="outline"
								size="sm"
								class="w-full"
								disabled={Boolean(selecting)}
								onclick={() => selectAsset(asset)}
							>
								{#if selecting === asset.external_id}<LoaderIcon class="size-4 animate-spin" />{/if}
								{selecting === asset.external_id
									? m.video_editor_stock_downloading({ title: asset.title || asset.kind })
									: m.video_editor_stock_use()}
							</Button>
						</div>
					</article>
				{/each}
			</div>
			{#if hasMore}
				<div class="flex justify-center pt-1">
					<Button variant="outline" onclick={() => void search(false)} disabled={searching}>
						{#if searching}<LoaderIcon class="animate-spin" />{/if}
						{m.stock_load_more()}
					</Button>
				</div>
			{/if}
		{:else if searched && !searching}
			<div class="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
				{m.video_editor_no_results()}
			</div>
		{:else}
			<div class="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
				{emptyMessage}
			</div>
		{/if}
	{/if}
</div>
