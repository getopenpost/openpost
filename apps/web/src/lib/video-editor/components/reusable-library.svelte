<script lang="ts">
	import { m } from '$lib/paraglide/messages';
	import { Button } from '$lib/components/ui/button';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import { Input } from '$lib/components/ui/input';
	import AppSelect from '$lib/components/app-select.svelte';
	import { ThemeIcon } from '$lib/themes/icons';
	import { toast } from 'svelte-sonner';
	import { videoLibrary } from '../library/library-store.svelte';
	import { captureLibrarySelection } from '../library/selection';
	import type { TransitionDirection } from '../project/types';
	import {
		setTransitionDragData,
		clearTransitionDragData,
		TRANSITION_DRAG_MIME
	} from '../timeline/transition-drop';
	import type { LibraryEntry } from '../library/types';
	import type { ProjectAssetImporter } from '../media/types';
	import {
		clearGeneratedItemDragData,
		writeGeneratedItemDragData
	} from '../timeline/generated-item-drag';
	import { clearEffectDragData, setEffectDragData } from '../timeline/effect-drop';
	import { applyLibraryEntry } from '../library/apply';
	import { effectTemplatesFromItems } from '../effects/effect-presets';
	import { captureAnimationFromItem } from '../timeline/saved-animation';
	import { timelineStore } from '../timeline/stores/timeline-store.svelte';
	import RepeatSelection from './repeat-selection.svelte';
	let {
		selectedIds,
		oninserted,
		onedit,
		importAsset,
		ontransition
	}: {
		ontransition: (presentation: string, direction?: TransitionDirection) => void;
		selectedIds: string[];
		oninserted: (ids: string[]) => void;
		onedit: () => void;
		importAsset?: ProjectAssetImporter;
	} = $props();
	let view = $state('favorites');
	let query = $state('');
	let collection = $state('');
	let saveOpen = $state(false);
	let name = $state('');
	let saveCollection = $state('');
	let busy = $state(false);
	let editingId = $state<string | null>(null);
	let editName = $state('');
	let editCollection = $state('');
	let saveKind = $state('selection');
	const collections = $derived([
		...new Set(videoLibrary.entries.map((entry) => entry.collection).filter(Boolean))
	]);
	const entries = $derived(
		videoLibrary.entries
			.filter(
				(entry) =>
					(view !== 'favorites' || entry.favorite) &&
					(view !== 'recent' || entry.lastUsed) &&
					(!collection || entry.collection === collection) &&
					entry.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())
			)
			.toSorted((a, b) =>
				view === 'recent' ? (b.lastUsed ?? 0) - (a.lastUsed ?? 0) : a.position - b.position
			)
	);
	$effect(() => {
		if (collection && !collections.includes(collection)) collection = '';
	});
	function fail(cause: unknown): void {
		toast.error(cause instanceof Error ? cause.message : String(cause));
	}
	async function save(): Promise<void> {
		if (!name.trim() || busy) return;
		busy = true;
		const scope = videoLibrary.scope;
		try {
			const selected = timelineStore.itemById.get(selectedIds[0] ?? '');
			let recipe;
			if (saveKind === 'text-style' && selected?.type === 'text')
				recipe = {
					kind: 'text-style' as const,
					selection: await captureLibrarySelection([selected.id])
				};
			else if (saveKind === 'effects' && selected?.effects?.length)
				recipe = {
					kind: 'effects' as const,
					effects: effectTemplatesFromItems($state.snapshot(selected.effects))
				};
			else if (saveKind === 'animation' && selected) {
				const preset = captureAnimationFromItem(selected, name);
				if (!preset) throw new Error(m.video_editor_saved_animation_nothing_to_save());
				recipe = { kind: 'animation' as const, preset };
			} else if (saveKind === 'selection') recipe = await captureLibrarySelection(selectedIds);
			else throw new Error(m.video_editor_library_select_target());
			if (scope !== videoLibrary.scope) return;
			await videoLibrary.save(name, recipe, saveCollection);
			saveOpen = false;
		} catch (error) {
			fail(error);
		} finally {
			busy = false;
		}
	}
	async function use(entry: LibraryEntry): Promise<void> {
		if (busy) return;
		busy = true;
		try {
			if (entry.recipe.kind === 'transition') {
				ontransition(entry.recipe.presentation, entry.recipe.direction);
				await videoLibrary.update(entry, { lastUsed: Date.now() });
				return;
			}
			const ids = await applyLibraryEntry($state.snapshot(entry), { selectedIds, importAsset });
			if (ids.length) oninserted(ids);
			onedit();
			await videoLibrary.update(entry, { lastUsed: Date.now() });
		} catch (error) {
			fail(error);
		} finally {
			busy = false;
		}
	}
	function drag(event: DragEvent, entry: LibraryEntry): void {
		if (!event.dataTransfer) return;
		if (entry.recipe.kind === 'transition') {
			const data = {
				presentation: entry.recipe.presentation,
				direction: entry.recipe.direction,
				label: entry.name
			};
			setTransitionDragData(data);
			event.dataTransfer.setData(TRANSITION_DRAG_MIME, JSON.stringify(data));
			return;
		}
		if (entry.recipe.kind === 'effects') {
			const data = {
				type: 'timeline-effect' as const,
				label: entry.name,
				effects: $state.snapshot(entry.recipe.effects)
			};
			setEffectDragData(data);
			event.dataTransfer.setData('application/json', JSON.stringify(data));
			return;
		}
		writeGeneratedItemDragData(event.dataTransfer, {
			version: 1,
			kind: 'library',
			label: entry.name,
			entryId: entry.id
		});
	}
	async function remove(entry: LibraryEntry): Promise<void> {
		try {
			const copy = $state.snapshot(entry);
			await videoLibrary.remove(entry);
			toast(m.video_editor_library_remove({ name: entry.name }), {
				action: {
					label: m.video_editor_undo(),
					onClick: () => {
						void videoLibrary.restore(copy).catch(fail);
					}
				}
			});
		} catch (error) {
			fail(error);
		}
	}
	async function edit(entry: LibraryEntry): Promise<void> {
		try {
			await videoLibrary.update(entry, {
				name: editName.trim(),
				collection: editCollection.trim()
			});
			editingId = null;
		} catch (error) {
			fail(error);
		}
	}
	async function move(entry: LibraryEntry, delta: number): Promise<void> {
		const index = entries.findIndex((value) => value.id === entry.id);
		const adjacent = entries[index + delta];
		if (!adjacent) return;
		try {
			const old = entry.position;
			await videoLibrary.update(entry, { position: adjacent.position });
			await videoLibrary.update(adjacent, { position: old });
		} catch (error) {
			fail(error);
		}
	}
</script>

<div class="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2">
	<div class="flex gap-1" role="group" aria-label={m.video_editor_library()}>
		{#each [{ value: 'favorites', label: m.video_editor_library_favorites() }, { value: 'saved', label: m.video_editor_library_saved() }, { value: 'recent', label: m.video_editor_library_recent() }] as tab}
			<Button
				size="xs"
				variant={view === tab.value ? 'secondary' : 'ghost'}
				aria-pressed={view === tab.value}
				onclick={() => (view = tab.value)}>{tab.label}</Button
			>
		{/each}
	</div>
	<Input
		type="search"
		bind:value={query}
		placeholder={m.video_editor_library_search()}
		aria-label={m.video_editor_library_search()}
	/>
	{#if collections.length}<AppSelect
			value={collection}
			options={[
				{ value: '', label: m.video_editor_library_all_collections() },
				...collections.map((value) => ({ value, label: value }))
			]}
			ariaLabel={m.video_editor_library_collection()}
			onValueChange={(value) => (collection = value)}
		/>{/if}
	<Button
		size="sm"
		variant="outline"
		disabled={!selectedIds.length || busy}
		onclick={() => {
			name = timelineStore.itemById.get(selectedIds[0]!)?.label ?? '';
			saveOpen = !saveOpen;
		}}>{m.video_editor_library_save()}</Button
	>
	{#if saveOpen}
		<form
			class="grid gap-2"
			onsubmit={(event) => {
				event.preventDefault();
				void save();
			}}
		>
			<AppSelect
				value={saveKind}
				ariaLabel={m.video_editor_library_save()}
				options={[
					{ value: 'selection', label: m.video_editor_library_save() },
					{ value: 'text-style', label: m.video_editor_library_text_style() },
					{ value: 'effects', label: m.video_editor_effects() },
					{ value: 'animation', label: m.video_editor_saved_animation_title() }
				]}
				onValueChange={(value) => (saveKind = value)}
			/>
			<Input
				bind:value={name}
				maxlength={80}
				aria-label={m.video_editor_library_name()}
				placeholder={m.video_editor_library_name()}
			/>
			<Input
				bind:value={saveCollection}
				maxlength={80}
				aria-label={m.video_editor_library_collection()}
				placeholder={m.video_editor_library_collection()}
			/>
			<Button type="submit" size="sm" disabled={busy || !name.trim()}
				>{m.video_editor_library_save()}</Button
			>
		</form>
	{/if}
	<p class="text-xs text-[var(--video-editor-muted)]">{m.video_editor_library_local()}</p>
	{#each entries as entry (entry.id)}
		<div
			class="flex flex-wrap items-center gap-1 border-b border-[var(--video-editor-border)] py-2"
		>
			<Button
				size="sm"
				variant="ghost"
				class="min-w-0 flex-1 justify-start truncate"
				draggable={entry.recipe.kind !== 'animation' && entry.recipe.kind !== 'text-style'}
				ondragstart={(event) => drag(event, entry)}
				ondragend={() => {
					clearGeneratedItemDragData();
					clearEffectDragData();
					clearTransitionDragData();
				}}
				disabled={busy}
				onclick={() => use(entry)}>{entry.name}</Button
			>
			<Button
				size="icon-xs"
				variant="ghost"
				aria-label={m.video_editor_library_favorite({ name: entry.name })}
				aria-pressed={entry.favorite}
				onclick={() => videoLibrary.update(entry, { favorite: !entry.favorite }).catch(fail)}
				><ThemeIcon role="favorite" /></Button
			>
			<DropdownMenu.Root>
				<DropdownMenu.Trigger
					>{#snippet child({ props })}<Button
							{...props}
							size="icon-xs"
							variant="ghost"
							aria-label={entry.name}><ThemeIcon role="more-horizontal" /></Button
						>{/snippet}</DropdownMenu.Trigger
				>
				<DropdownMenu.Content class="video-editor-theme">
					<DropdownMenu.Item
						onclick={() => {
							editingId = entry.id;
							editName = entry.name;
							editCollection = entry.collection;
						}}
						>{m.video_editor_library_name()} / {m.video_editor_library_collection()}</DropdownMenu.Item
					>
					<DropdownMenu.Item
						disabled={view === 'recent' || entries[0]?.id === entry.id}
						onclick={() => move(entry, -1)}
						>{m.video_editor_library_move_up({ name: entry.name })}</DropdownMenu.Item
					>
					<DropdownMenu.Item onclick={() => remove(entry)}
						>{m.video_editor_library_remove({ name: entry.name })}</DropdownMenu.Item
					>
				</DropdownMenu.Content>
			</DropdownMenu.Root>
			{#if editingId === entry.id}
				<form
					class="grid w-full gap-2"
					onsubmit={(event) => {
						event.preventDefault();
						void edit(entry);
					}}
				>
					<Input bind:value={editName} aria-label={m.video_editor_library_name()} maxlength={80} />
					<Input
						bind:value={editCollection}
						aria-label={m.video_editor_library_collection()}
						maxlength={80}
					/>
					<Button type="submit" size="sm" disabled={!editName.trim()}>{m.common_save()}</Button>
				</form>
			{/if}
		</div>
	{:else}<p class="text-xs text-[var(--video-editor-muted)]">
			{m.video_editor_library_empty()}
		</p>{/each}
	<RepeatSelection {selectedIds} {oninserted} />
</div>
