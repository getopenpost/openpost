<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import AppSelect from '$lib/components/app-select.svelte';
	import MediaTagFilter from '$lib/components/media-tag-filter.svelte';
	import { ThemeIcon } from '$lib/themes/icons';
	import type { MediaTag } from '$lib/media-tags';
	import { m } from '$lib/paraglide/messages';

	interface Props {
		open?: boolean;
		filter?: string;
		mediaType?: string;
		source?: string;
		aspect?: string;
		minWidth?: number;
		minHeight?: number;
		maxWidth?: number;
		maxHeight?: number;
		dateFrom?: string;
		dateTo?: string;
		selectedTagIDs?: string[];
		showUntagged?: boolean;
		tags: MediaTag[];
		lifecycleView: string;
		canEdit: boolean;
		onTagsChange: (tagIDs: string[], untagged: boolean) => void;
		onManageTags: () => void;
		onReset: () => void;
		onApply: () => void;
	}

	let {
		open = $bindable(false),
		filter = $bindable('all'),
		mediaType = $bindable('all'),
		source = $bindable('all'),
		aspect = $bindable('all'),
		minWidth = $bindable(0),
		minHeight = $bindable(0),
		maxWidth = $bindable(0),
		maxHeight = $bindable(0),
		dateFrom = $bindable(''),
		dateTo = $bindable(''),
		selectedTagIDs = $bindable([]),
		showUntagged = $bindable(false),
		tags,
		lifecycleView,
		canEdit,
		onTagsChange,
		onManageTags,
		onReset,
		onApply
	}: Props = $props();
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="max-h-[calc(100dvh-1rem)] overflow-y-auto sm:max-w-xl">
		<Dialog.Header>
			<Dialog.Title>{m.media_filters()}</Dialog.Title>
			<Dialog.Description>{m.media_filters_body()}</Dialog.Description>
		</Dialog.Header>
		<div class="grid gap-4 py-2 sm:grid-cols-2">
			<label class="grid gap-1.5 text-sm font-medium">
				<span>{m.media_filter_usage()}</span>
				<AppSelect
					bind:value={filter}
					options={[
						{ value: 'all', label: m.media_filter_all() },
						{ value: 'unused', label: m.media_filter_unused() },
						{ value: 'favorites', label: m.media_filter_favorites() }
					]}
					class="h-11 w-full"
				/>
			</label>
			<label class="grid gap-1.5 text-sm font-medium">
				<span>{m.media_type()}</span>
				<AppSelect
					bind:value={mediaType}
					ariaLabel={m.media_type()}
					options={[
						{ value: 'all', label: m.media_all_types() },
						{ value: 'image', label: m.media_images() },
						{ value: 'video', label: m.media_videos() },
						{ value: 'audio', label: m.media_audio() }
					]}
					class="h-11 w-full"
				/>
			</label>
			<label class="grid gap-1.5 text-sm font-medium">
				<span>{m.media_source()}</span>
				<AppSelect
					bind:value={source}
					options={[
						{ value: 'all', label: m.media_all_sources() },
						{ value: 'upload', label: m.media_uploads() },
						{ value: 'camera', label: m.media_camera() },
						{ value: 'image_editor_export', label: m.media_image_editor_exports() },
						{ value: 'image_editor_edit', label: m.media_image_editor_edits() },
						{ value: 'background_removal', label: m.media_background_removal() }
					]}
					class="h-11 w-full"
				/>
			</label>
			<label class="grid gap-1.5 text-sm font-medium">
				<span>{m.media_aspect_ratio()}</span>
				<AppSelect
					bind:value={aspect}
					options={[
						{ value: 'all', label: m.media_any_aspect() },
						{ value: 'square', label: m.media_square() },
						{ value: 'portrait', label: m.media_portrait() },
						{ value: 'landscape', label: m.media_landscape() }
					]}
					class="h-11 w-full"
				/>
			</label>
		</div>
		{#if lifecycleView !== 'trash'}
			<div class="space-y-2 border-t pt-4">
				<p class="text-sm font-medium">{m.media_tags()}</p>
				<MediaTagFilter
					{tags}
					selectedIds={selectedTagIDs}
					untagged={showUntagged}
					{canEdit}
					onChange={onTagsChange}
					onManage={onManageTags}
				/>
			</div>
		{/if}
		<details class="border-y py-1">
			<summary class="flex min-h-11 cursor-pointer items-center text-sm font-medium">
				{m.media_dimensions_date()}
			</summary>
			<div class="grid gap-3 pb-3 sm:grid-cols-2">
				<div class="grid grid-cols-2 gap-2">
					<label class="grid gap-1 text-xs font-medium">
						<span>{m.media_min_width()}</span>
						<Input class="h-11 min-w-0 px-2" type="number" min="0" bind:value={minWidth} />
					</label>
					<label class="grid gap-1 text-xs font-medium">
						<span>{m.media_min_height()}</span>
						<Input class="h-11 min-w-0 px-2" type="number" min="0" bind:value={minHeight} />
					</label>
				</div>
				<div class="grid grid-cols-2 gap-2">
					<label class="grid gap-1 text-xs font-medium">
						<span>{m.media_max_width()}</span>
						<Input class="h-11 min-w-0 px-2" type="number" min="0" bind:value={maxWidth} />
					</label>
					<label class="grid gap-1 text-xs font-medium">
						<span>{m.media_max_height()}</span>
						<Input class="h-11 min-w-0 px-2" type="number" min="0" bind:value={maxHeight} />
					</label>
				</div>
				<div class="grid grid-cols-2 gap-2 sm:col-span-2">
					<label class="grid gap-1 text-xs font-medium">
						<span>{m.media_from()}</span>
						<Input class="h-11 min-w-0 px-2" type="date" bind:value={dateFrom} />
					</label>
					<label class="grid gap-1 text-xs font-medium">
						<span>{m.media_to()}</span>
						<Input class="h-11 min-w-0 px-2" type="date" bind:value={dateTo} />
					</label>
				</div>
			</div>
		</details>
		{#if canEdit}
			<Button
				variant="ghost"
				class="justify-start"
				onclick={() => {
					onManageTags();
				}}
			>
				<ThemeIcon role="tag" />
				{m.media_manage_organization()}
			</Button>
		{/if}
		<Dialog.Footer>
			<Button variant="ghost" onclick={onReset}>{m.media_clear()}</Button>
			<Button onclick={onApply}>{m.media_apply_filters()}</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
