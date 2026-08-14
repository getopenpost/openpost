<script lang="ts">
	import * as Select from '$lib/components/ui/select';
	import { Button } from '$lib/components/ui/button';
	import { Label } from '$lib/components/ui/label';
	import { Input } from '$lib/components/ui/input';
	import ImageEditorColorPicker from '$lib/image-editor/components/image-editor-color-picker.svelte';
	import MediaPicker from '$lib/components/media-picker.svelte';
	import SectionHeader from '$lib/components/section-header.svelte';
	import { getAuthenticatedMediaURL } from '$lib/media-url';
	import { loadImageEditorBrandKit } from '$lib/image-editor/api';
	import type { ImageEditorBrandKit } from '$lib/image-editor/types';
	import { WorkspaceContextError, workspaceCtx } from '$lib/stores/workspace.svelte';
	import { getOptionalUnsavedChanges } from '$lib/unsaved-changes.svelte';
	import { showToast } from '$lib/toast';
	import SettingsFormFooter from '$lib/components/settings-form-footer.svelte';
	import { m } from '$lib/paraglide/messages';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import ClockIcon from '@lucide/svelte/icons/clock';
	import ImageIcon from '@lucide/svelte/icons/image';
	import TrashIcon from '@lucide/svelte/icons/trash';
	import { getTimezoneLabel, timezones } from '../../../routes/settings/settings-data';

	let {
		onDelete,
		organizationOwner = false,
		onDeleteOrganization
	}: {
		onDelete: () => void;
		organizationOwner?: boolean;
		onDeleteOrganization?: () => void;
	} = $props();
	let imagePickerOpen = $state(false);
	let brandColors = $state.raw<ImageEditorBrandKit['colors']>([]);
	let loadedWorkspaceID = '';
	let requestSequence = 0;
	let saving = $state(false);
	const unsavedChanges = getOptionalUnsavedChanges();

	const groupedTimezones = $derived.by(() => {
		const groups: Record<string, typeof timezones> = {};
		for (const timezone of timezones) {
			if (!groups[timezone.group]) groups[timezone.group] = [];
			groups[timezone.group].push(timezone);
		}
		return groups;
	});

	async function loadBrandColors(workspaceID: string) {
		const sequence = ++requestSequence;
		loadedWorkspaceID = workspaceID;
		try {
			const kit = await loadImageEditorBrandKit(workspaceID);
			if (sequence === requestSequence) brandColors = kit.colors;
		} catch {
			if (sequence === requestSequence) brandColors = [];
		}
	}

	async function saveSettings() {
		saving = true;
		try {
			await workspaceCtx.saveSettings({
				name: workspaceCtx.settings.name.trim(),
				avatar_url: workspaceCtx.settings.avatar_url,
				color: workspaceCtx.settings.color,
				timezone: workspaceCtx.settings.timezone,
				week_start: workspaceCtx.settings.week_start
			});
			showToast(m.settings_saved());
		} catch (error) {
			showToast(
				error instanceof WorkspaceContextError
					? m.settings_action_failed()
					: (error as Error).message,
				'error'
			);
		} finally {
			saving = false;
		}
	}

	$effect(() => {
		const workspaceID = workspaceCtx.currentWorkspace?.id ?? '';
		if (workspaceID && workspaceID !== loadedWorkspaceID) void loadBrandColors(workspaceID);
	});

	$effect(() => {
		unsavedChanges?.set(
			'workspace-settings',
			workspaceCtx.settingsDirty,
			m.settings_unsaved_changes()
		);
		return () => unsavedChanges?.clear('workspace-settings');
	});
</script>

<section id="workspace" class="scroll-mt-24 space-y-4">
	<div class="rounded-lg border bg-muted/20 p-4">
		{#if imagePickerOpen}
			<MediaPicker
				bind:open={imagePickerOpen}
				workspaceId={workspaceCtx.currentWorkspace?.id ?? ''}
				accept={['image/*']}
				maxSelection={1}
				multiple={false}
				purpose="media_library"
				showCreate={false}
				title={m.settings_workspace_image_url()}
				onConfirm={(ids) => {
					if (ids[0]) workspaceCtx.settings.avatar_url = `/media/${ids[0]}`;
				}}
			/>
		{/if}
		<div class="flex flex-col gap-4 sm:flex-row sm:items-center">
			<div
				class="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted text-lg font-semibold text-muted-foreground"
			>
				{#if workspaceCtx.settings.avatar_url}
					<img
						src={getAuthenticatedMediaURL(workspaceCtx.settings.avatar_url)}
						alt={workspaceCtx.currentWorkspace?.name || m.settings_workspace()}
						class="h-full w-full object-cover"
					/>
				{:else}
					{(workspaceCtx.currentWorkspace?.name?.[0] ?? 'W').toUpperCase()}
				{/if}
			</div>
			<div class="min-w-0 flex-1 space-y-3">
				<div class="flex flex-col gap-1">
					<span class="text-sm font-medium">{workspaceCtx.currentWorkspace?.name}</span>
					<span class="text-sm text-muted-foreground">
						{workspaceCtx.currentWorkspace?.organization_name || m.settings_personal_workspace()}
					</span>
				</div>
				<div class="flex flex-wrap gap-2">
					<Button type="button" variant="outline" onclick={() => (imagePickerOpen = true)}>
						<ImageIcon class="mr-2 size-4" />
						{m.settings_workspace_image_url()}
					</Button>
					{#if workspaceCtx.settings.avatar_url}
						<Button
							type="button"
							variant="ghost"
							class="text-destructive hover:text-destructive"
							onclick={() => (workspaceCtx.settings.avatar_url = '')}
						>
							<TrashIcon class="mr-2 size-4" />{m.settings_remove()}
						</Button>
					{/if}
				</div>
			</div>
		</div>
	</div>
	<div id="workspace-name" class="max-w-sm space-y-2">
		<Label for="workspace-name-input">{m.onboarding_workspace_name()}</Label>
		<Input
			id="workspace-name-input"
			bind:value={workspaceCtx.settings.name}
			maxlength={100}
			required
		/>
	</div>
	<div class="mt-4 max-w-sm space-y-2">
		<Label for="workspace-color">{m.settings_workspace_color()}</Label>
		<div class="[&>button]:min-h-11">
			<ImageEditorColorPicker
				id="workspace-color"
				label={m.settings_workspace_color()}
				value={workspaceCtx.settings.color}
				{brandColors}
				onChange={(color) => (workspaceCtx.settings.color = color)}
			/>
		</div>
		<p class="text-sm text-muted-foreground">{m.settings_workspace_color_description()}</p>
	</div>
	<div class="flex flex-col gap-3 border-t pt-5 sm:flex-row sm:items-center sm:justify-between">
		<div>
			<p class="text-sm font-medium">{m.settings_connected_channels()}</p>
			<p class="text-sm text-muted-foreground">{m.settings_connected_channels_body()}</p>
		</div>
		<Button variant="outline" onclick={() => goto(resolve('/settings?tab=accounts' as '/'))}>
			{m.settings_manage_accounts()}
		</Button>
	</div>
	{#if workspaceCtx.currentWorkspace?.role === 'admin'}
		<div
			class="flex flex-col gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4 sm:flex-row sm:items-center sm:justify-between"
		>
			<div>
				<p class="text-sm font-medium text-destructive">{m.workspace_delete_title()}</p>
				<p class="text-sm text-muted-foreground">{m.workspace_delete_description()}</p>
			</div>
			<Button variant="destructive" class="shrink-0" onclick={onDelete}>
				{m.workspace_delete_confirm()}
			</Button>
		</div>
	{/if}
	{#if organizationOwner && onDeleteOrganization}
		<div
			class="flex flex-col gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4 sm:flex-row sm:items-center sm:justify-between"
		>
			<div>
				<p class="text-sm font-medium text-destructive">{m.organization_delete_title()}</p>
				<p class="text-sm text-muted-foreground">{m.organization_delete_description()}</p>
			</div>
			<Button variant="destructive" class="shrink-0" onclick={onDeleteOrganization}
				>{m.organization_delete_confirm()}</Button
			>
		</div>
	{/if}
</section>

<section id="date-time" class="scroll-mt-24 space-y-4">
	<SectionHeader title={m.settings_date_time()} icon={ClockIcon} class="mb-4">
		{#snippet actions()}
			<span class="rounded-full border px-2 py-1 text-xs text-muted-foreground">
				{m.settings_workspace_scope()}
			</span>
		{/snippet}
	</SectionHeader>
	<div class="grid gap-4 sm:grid-cols-2">
		<div class="space-y-2">
			<label class="text-sm font-medium" for="timezone-select">{m.settings_timezone()}</label>
			<Select.Root
				type="single"
				value={workspaceCtx.settings.timezone}
				onValueChange={(value) => (workspaceCtx.settings.timezone = value)}
			>
				<Select.Trigger id="timezone-select" class="w-full">
					{getTimezoneLabel(workspaceCtx.settings.timezone)}
				</Select.Trigger>
				<Select.Content class="max-h-80 overflow-y-auto">
					{#each Object.entries(groupedTimezones) as [group, values] (group)}
						<Select.Group>
							<Select.GroupHeading class="text-xs">{group}</Select.GroupHeading>
							{#each values as timezone (timezone.value)}
								<Select.Item value={timezone.value}>{timezone.label}</Select.Item>
							{/each}
						</Select.Group>
					{/each}
				</Select.Content>
			</Select.Root>
			<p class="text-sm text-muted-foreground">{m.settings_timezone_body()}</p>
		</div>
		<div class="space-y-2">
			<label class="text-sm font-medium" for="week-start-select">{m.settings_week_starts()}</label>
			<Select.Root
				type="single"
				value={String(workspaceCtx.settings.week_start)}
				onValueChange={(value) => (workspaceCtx.settings.week_start = Number(value))}
			>
				<Select.Trigger id="week-start-select" class="w-full">
					{workspaceCtx.settings.week_start === 0 ? m.settings_sunday() : m.settings_monday()}
				</Select.Trigger>
				<Select.Content>
					<Select.Item value="0">{m.settings_sunday()}</Select.Item>
					<Select.Item value="1">{m.settings_monday()}</Select.Item>
				</Select.Content>
			</Select.Root>
			<p class="text-sm text-muted-foreground">{m.settings_week_start_body()}</p>
		</div>
	</div>
</section>

<section id="media-cleanup" class="scroll-mt-24 space-y-4">
	<SectionHeader title={m.settings_media_cleanup()} icon={ImageIcon} class="mb-4" />
	<div class="rounded-xl border bg-muted/25 p-4">
		<p class="text-sm font-medium">{m.settings_media_lifecycle_title()}</p>
		<p class="mt-1 text-sm leading-relaxed text-muted-foreground">
			{m.settings_media_lifecycle_body()}
		</p>
	</div>
</section>

<SettingsFormFooter
	label={m.settings_save_changes()}
	savingLabel={m.settings_save_changes()}
	{saving}
	disabled={!workspaceCtx.settingsDirty}
	onSave={saveSettings}
/>
