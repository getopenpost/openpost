<script lang="ts">
	import { onMount } from 'svelte';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import AppSelect from '$lib/components/app-select.svelte';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import { m } from '$lib/paraglide/messages';
	import {
		listStockProviders,
		resolveStockAsset,
		searchStockMedia,
		type StockAsset,
		type StockProvider
	} from '$lib/video-studio/api';
	import ImageIcon from 'lucide-svelte/icons/image';
	import LoaderIcon from 'lucide-svelte/icons/loader-2';
	import SearchIcon from 'lucide-svelte/icons/search';

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

	onMount(() => {
		void initialize();
	});

	const providerOptions = $derived(
		providers
			.filter((item) => (kind === 'photo' ? item.photos : item.videos))
			.map((item) => ({ value: item.key, label: item.name }))
	);
	const kindOptions = $derived([
		...(accept !== 'video' ? [{ value: 'photo', label: m.video_studio_stock_photos() }] : []),
		...(accept !== 'photo' ? [{ value: 'video', label: m.video_studio_stock_videos() }] : [])
	]);

	async function initialize(): Promise<void> {
		try {
			if (accept === 'video') kind = 'video';
			providers = await listStockProviders();
			provider =
				providers.find((item) => (kind === 'photo' ? item.photos : item.videos))?.key ?? '';
		} catch (cause) {
			error = cause instanceof Error ? cause.message : m.video_studio_stock_unavailable();
		} finally {
			loading = false;
		}
	}

	async function search(): Promise<void> {
		if (!query.trim() || !provider || searching) return;
		searching = true;
		error = '';
		searched = true;
		try {
			const page = await searchStockMedia({ provider, query: query.trim(), kind });
			results = page.items ?? [];
		} catch (cause) {
			error = cause instanceof Error ? cause.message : m.video_studio_stock_search_failed();
		} finally {
			searching = false;
		}
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
			if (!response.ok) throw new Error(m.video_studio_stock_download_failed());
			const blob = await response.blob();
			const extension = resolved.mime_type.includes('video') ? 'mp4' : 'jpg';
			const file = new File(
				[blob],
				`${asset.provider}-${asset.external_id.replace(':', '-')}.${extension}`,
				{
					type: resolved.mime_type,
					lastModified: Date.now()
				}
			);
			await onSelect(file, asset);
		} catch (cause) {
			error = cause instanceof Error ? cause.message : m.video_studio_stock_download_failed();
		} finally {
			selecting = '';
		}
	}
</script>

<div class={compact ? 'space-y-3' : 'space-y-4'}>
	<div>
		<h2 class={compact ? 'text-sm font-semibold' : 'text-base font-semibold'}>
			{m.video_studio_stock_search()}
		</h2>
		<p
			class={compact ? 'mt-1 text-xs text-muted-foreground' : 'mt-1 text-sm text-muted-foreground'}
		>
			{m.video_studio_stock_description()}
		</p>
	</div>

	{#if error}<InlineNotice tone="error" message={error} />{/if}

	{#if loading}
		<div class="flex items-center gap-2 py-6 text-sm text-muted-foreground" role="status">
			<LoaderIcon class="size-4 animate-spin" />
			{m.common_loading()}
		</div>
	{:else if providers.length === 0}
		<InlineNotice tone="info" message={m.video_studio_stock_unavailable()} />
	{:else}
		<form
			class={compact ? 'grid gap-2' : 'grid gap-3 sm:grid-cols-[minmax(0,1fr)_10rem_9rem_auto]'}
			onsubmit={(event) => {
				event.preventDefault();
				void search();
			}}
		>
			<Input
				bind:value={query}
				placeholder={m.video_studio_stock_query_placeholder()}
				aria-label={m.video_studio_stock_search()}
			/>
			<AppSelect
				bind:value={provider}
				options={providerOptions}
				ariaLabel={m.video_studio_stock_provider()}
			/>
			{#if accept === 'both'}
				<AppSelect
					bind:value={kind}
					options={kindOptions}
					ariaLabel={m.video_studio_stock_kind()}
					onValueChange={() => {
						if (!providerOptions.some((item) => item.value === provider)) {
							provider = providerOptions[0]?.value ?? '';
						}
					}}
				/>
			{/if}
			<Button type="submit" disabled={!query.trim() || !provider || searching}>
				{#if searching}<LoaderIcon class="size-4 animate-spin" />{:else}<SearchIcon
						class="size-4"
					/>{/if}
				{m.video_studio_stock_search_action()}
			</Button>
		</form>

		{#if results.length > 0}
			<div
				class={compact
					? 'grid grid-cols-2 gap-2'
					: 'grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4'}
			>
				{#each results as asset (asset.external_id)}
					<article class="min-w-0 overflow-hidden rounded-lg border bg-card">
						<div class="relative aspect-[4/3] overflow-hidden bg-muted">
							{#if asset.thumbnail_url}
								<img
									src={asset.thumbnail_url}
									alt={asset.title}
									class="size-full object-cover"
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
							<p class="truncate text-xs text-muted-foreground">
								<Button
									href={asset.creator_url}
									target="_blank"
									rel="noreferrer"
									variant="link"
									size="xs"
									class="h-auto p-0 text-xs text-muted-foreground"
								>
									{m.video_studio_stock_by({ creator: asset.creator_name })}
								</Button>
								·
								<Button
									href={asset.provider_url}
									target="_blank"
									rel="noreferrer"
									variant="link"
									size="xs"
									class="h-auto p-0 text-xs text-muted-foreground"
								>
									{asset.provider}
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
								{m.video_studio_stock_use()}
							</Button>
						</div>
					</article>
				{/each}
			</div>
		{:else if searched && !searching}
			<div class="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
				{m.video_studio_no_results()}
			</div>
		{:else}
			<div class="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
				{m.video_studio_stock_empty()}
			</div>
		{/if}
	{/if}
</div>
