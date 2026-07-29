<script lang="ts">
	import { client } from '$lib/api/client';
	import { Button } from '$lib/components/ui/button';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Input } from '$lib/components/ui/input';
	import * as Tabs from '$lib/components/ui/tabs';
	import LoaderIcon from 'lucide-svelte/icons/loader-2';
	import PencilIcon from 'lucide-svelte/icons/pencil';
	import TrashIcon from 'lucide-svelte/icons/trash-2';
	import { m } from '$lib/paraglide/messages';

	interface MediaCollection {
		id: string;
		name: string;
		color: string;
		item_count: number;
	}

	interface MediaTag {
		id: string;
		name: string;
		item_count: number;
	}

	let {
		open = $bindable(false),
		workspaceId,
		collections,
		tags,
		onChanged
	}: {
		open?: boolean;
		workspaceId: string;
		collections: MediaCollection[];
		tags: MediaTag[];
		onChanged: () => void | Promise<void>;
	} = $props();

	let activeTab = $state('collections');
	let editingID = $state('');
	let name = $state('');
	let color = $state('#f97316');
	let saving = $state(false);
	let error = $state('');
	let pendingDelete = $state<{ kind: 'collection' | 'tag'; id: string; name: string } | null>(null);

	function resetForm() {
		editingID = '';
		name = '';
		color = '#f97316';
		error = '';
	}

	function editCollection(collection: MediaCollection) {
		activeTab = 'collections';
		editingID = collection.id;
		name = collection.name;
		color = collection.color || '#f97316';
	}

	function editTag(tag: MediaTag) {
		activeTab = 'tags';
		editingID = tag.id;
		name = tag.name;
	}

	async function submit() {
		if (!name.trim()) return;
		saving = true;
		error = '';
		try {
			if (activeTab === 'collections') {
				if (editingID) {
					const { error: requestError } = await client.PATCH('/media/collections/{id}', {
						params: { path: { id: editingID } },
						body: { name: name.trim(), color }
					});
					if (requestError) throw new Error(requestError.detail);
				} else {
					const { error: requestError } = await client.POST('/media/collections', {
						body: { workspace_id: workspaceId, name: name.trim(), color }
					});
					if (requestError) throw new Error(requestError.detail);
				}
			} else if (editingID) {
				const { error: requestError } = await client.PATCH('/media/tags/{id}', {
					params: { path: { id: editingID } },
					body: { name: name.trim() }
				});
				if (requestError) throw new Error(requestError.detail);
			} else {
				const { error: requestError } = await client.POST('/media/tags', {
					body: { workspace_id: workspaceId, name: name.trim() }
				});
				if (requestError) throw new Error(requestError.detail);
			}
			resetForm();
			await onChanged();
		} catch (cause) {
			error = cause instanceof Error ? cause.message : m.media_organization_save_failed();
		} finally {
			saving = false;
		}
	}

	async function deletePending() {
		const target = pendingDelete;
		if (!target) return;
		saving = true;
		error = '';
		try {
			const result =
				target.kind === 'collection'
					? await client.DELETE('/media/collections/{id}', {
							params: { path: { id: target.id } }
						})
					: await client.DELETE('/media/tags/{id}', {
							params: { path: { id: target.id } }
						});
			if (result.error) throw new Error(result.error.detail);
			if (editingID === target.id) resetForm();
			pendingDelete = null;
			await onChanged();
		} catch (cause) {
			error = cause instanceof Error ? cause.message : m.media_organization_delete_failed();
		} finally {
			saving = false;
		}
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="flex max-h-[min(720px,calc(100dvh-2rem))] flex-col sm:max-w-2xl">
		<Dialog.Header>
			<Dialog.Title>{m.media_organization_title()}</Dialog.Title>
			<Dialog.Description>{m.media_organization_body()}</Dialog.Description>
		</Dialog.Header>

		<Tabs.Root bind:value={activeTab} class="min-h-0 flex-1" onValueChange={() => resetForm()}>
			<Tabs.List class="grid grid-cols-2">
				<Tabs.Trigger value="collections">{m.media_collections()}</Tabs.Trigger>
				<Tabs.Trigger value="tags">{m.media_tags()}</Tabs.Trigger>
			</Tabs.List>

			<div class="mt-4 grid min-h-0 gap-4 md:grid-cols-[1fr_15rem]">
				<div class="max-h-80 space-y-2 overflow-y-auto">
					{#if activeTab === 'collections'}
						{#each collections as collection (collection.id)}
							<div class="flex min-h-12 items-center gap-2 rounded-lg border px-3 py-2">
								<span class="size-4 rounded-full border" style:background={collection.color}></span>
								<div class="min-w-0 flex-1">
									<p class="truncate text-sm font-medium">{collection.name}</p>
									<p class="text-xs text-muted-foreground">
										{m.media_organization_assets({ count: collection.item_count })}
									</p>
								</div>
								<Button
									variant="ghost"
									size="icon"
									aria-label={m.media_organization_edit_named({ name: collection.name })}
									onclick={() => editCollection(collection)}
								>
									<PencilIcon />
								</Button>
								<Button
									variant="ghost"
									size="icon"
									aria-label={m.media_organization_delete_named({ name: collection.name })}
									onclick={() =>
										(pendingDelete = {
											kind: 'collection',
											id: collection.id,
											name: collection.name
										})}
								>
									<TrashIcon />
								</Button>
							</div>
						{/each}
					{:else}
						{#each tags as tag (tag.id)}
							<div class="flex min-h-12 items-center gap-2 rounded-lg border px-3 py-2">
								<div class="min-w-0 flex-1">
									<p class="truncate text-sm font-medium">{tag.name}</p>
									<p class="text-xs text-muted-foreground">
										{m.media_organization_assets({ count: tag.item_count })}
									</p>
								</div>
								<Button
									variant="ghost"
									size="icon"
									aria-label={m.media_organization_edit_named({ name: tag.name })}
									onclick={() => editTag(tag)}
								>
									<PencilIcon />
								</Button>
								<Button
									variant="ghost"
									size="icon"
									aria-label={m.media_organization_delete_named({ name: tag.name })}
									onclick={() => (pendingDelete = { kind: 'tag', id: tag.id, name: tag.name })}
								>
									<TrashIcon />
								</Button>
							</div>
						{/each}
					{/if}
				</div>

				<form
					class="space-y-3 rounded-lg border bg-muted/20 p-3"
					onsubmit={(event) => {
						event.preventDefault();
						void submit();
					}}
				>
					<h3 class="text-sm font-semibold">
						{editingID
							? `${m.media_organization_edit()} ${
									activeTab === 'collections'
										? m.media_organization_collection()
										: m.media_organization_tag()
								}`
							: activeTab === 'collections'
								? m.media_organization_new_collection()
								: m.media_organization_new_tag()}
					</h3>
					<Input
						bind:value={name}
						maxlength={activeTab === 'collections' ? 100 : 64}
						placeholder={m.media_organization_name()}
					/>
					{#if activeTab === 'collections'}
						<label class="flex items-center gap-2 text-sm">
							<Input type="color" bind:value={color} class="h-10 w-12 p-1" />
							<span>{color}</span>
						</label>
					{/if}
					<div class="flex gap-2">
						<Button type="submit" size="sm" disabled={saving || !name.trim()}>
							{#if saving}<LoaderIcon class="animate-spin" />{/if}
							{editingID ? m.common_save() : m.media_organization_create()}
						</Button>
						{#if editingID}
							<Button type="button" variant="ghost" size="sm" onclick={resetForm}
								>{m.common_cancel()}</Button
							>
						{/if}
					</div>
				</form>
			</div>
		</Tabs.Root>

		{#if pendingDelete}
			<div class="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm">
				<p>
					{m.media_organization_delete_confirm({ name: pendingDelete.name })}
				</p>
				<div class="mt-2 flex gap-2">
					<Button variant="destructive" size="sm" disabled={saving} onclick={deletePending}>
						{m.common_delete()}
					</Button>
					<Button variant="ghost" size="sm" onclick={() => (pendingDelete = null)}
						>{m.common_cancel()}</Button
					>
				</div>
			</div>
		{/if}

		{#if error}<p class="text-sm text-destructive" role="alert">{error}</p>{/if}
	</Dialog.Content>
</Dialog.Root>
