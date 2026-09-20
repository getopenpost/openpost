<script lang="ts">
	import { m } from '$lib/paraglide/messages';
	import { ProtectedIcon, ThemeIcon } from '$lib/themes/icons';
	let {
		storage,
		syncStatus = 'synced',
		offline = false,
		reason = ''
	}: {
		storage: 'local' | 'cloud';
		syncStatus?: 'pending' | 'uploading' | 'saving' | 'synced' | 'needs_attention';
		offline?: boolean;
		reason?: string;
	} = $props();
	const busy = $derived(syncStatus === 'uploading' || syncStatus === 'saving');

	const label = $derived.by(() => {
		if (syncStatus === 'needs_attention') return m.compose_needs_attention();
		if (busy) return m.video_editor_saving();
		if (syncStatus === 'pending')
			return storage === 'local' ? m.image_editor_unsaved_changes() : m.editor_storage_pending();
		if (storage === 'local') return m.video_editor_local_only();
		return offline ? m.video_editor_available_offline() : m.editor_storage_online();
	});
	const description = $derived(
		storage === 'local' && syncStatus === 'synced' && !reason
			? label
			: `${storage === 'local' ? m.video_editor_local_only() : syncStatus === 'synced' ? m.video_editor_saved_cloud() : 'OpenPost'} · ${label}${reason ? ` · ${reason}` : ''}`
	);
</script>

<span
	class="inline-flex shrink-0 items-center gap-1 text-xs whitespace-nowrap text-muted-foreground"
	title={description}
	aria-label={description}
	role="img"
>
	{#if syncStatus === 'needs_attention'}<ProtectedIcon
			icon="warning"
			class="size-3.5 text-destructive"
		/>
	{:else if busy}<ProtectedIcon
			icon="loading"
			class="size-3.5 animate-spin motion-reduce:animate-none"
		/>
	{:else if syncStatus === 'pending'}<ProtectedIcon icon="pending" class="size-3.5" />
	{:else if storage === 'local'}<ThemeIcon role="devices" class="size-3.5" />
	{:else if offline}<ProtectedIcon icon="success" class="size-3.5" />
	{:else}<ProtectedIcon icon="cloud" class="size-3.5" />{/if}
	<span aria-hidden="true">{label}</span>
</span>
