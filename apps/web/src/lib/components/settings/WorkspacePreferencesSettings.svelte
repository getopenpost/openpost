<script lang="ts">
	import * as Select from '$lib/components/ui/select';
	import { Button } from '$lib/components/ui/button';
	import { Label } from '$lib/components/ui/label';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import { Input } from '$lib/components/ui/input';
	import FormField from '$lib/components/form-field.svelte';
	import ColorPicker from '$lib/components/color-picker.svelte';
	import MediaPicker from '$lib/components/media-picker.svelte';
	import SectionHeader from '$lib/components/section-header.svelte';
	import Disclosure from '$lib/components/disclosure.svelte';
	import { getAuthenticatedMediaURL } from '$lib/media-url';
	import { queryImageEditorBrandKit } from '$lib/query/image-editor';
	import type { ImageEditorBrandKit } from '$lib/image-editor/types';
	import { WorkspaceContextError, workspaceCtx } from '$lib/stores/workspace.svelte';
	import { getOptionalUnsavedChanges } from '$lib/unsaved-changes.svelte';
	import { showToast } from '$lib/toast';
	import SettingsFormFooter from '$lib/components/settings-form-footer.svelte';
	import { m } from '$lib/paraglide/messages';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { ThemeIcon } from '$lib/themes/icons';
	import { getLocaleTag } from '$lib/i18n';
	import {
		getTimezoneLabel,
		timezoneOptions,
		type TimezoneOption
	} from '../../../routes/settings/settings-data';

	let {
		onDelete
	}: {
		onDelete: () => void;
	} = $props();
	let imagePickerOpen = $state(false);
	let brandColors = $state.raw<ImageEditorBrandKit['colors']>([]);
	let loadedWorkspaceID = '';
	let requestSequence = 0;
	let saving = $state(false);
	const unsavedChanges = getOptionalUnsavedChanges();

	const groupedTimezones = $derived.by(() => {
		const groups: Record<string, TimezoneOption[]> = {};
		for (const timezone of timezoneOptions(workspaceCtx.settings.timezone, getLocaleTag())) {
			if (!groups[timezone.group]) groups[timezone.group] = [];
			groups[timezone.group].push(timezone);
		}
		return groups;
	});

	async function loadBrandColors(workspaceID: string) {
		const sequence = ++requestSequence;
		loadedWorkspaceID = workspaceID;
		try {
			const kit = await queryImageEditorBrandKit(workspaceID);
			if (sequence === requestSequence) brandColors = kit.colors;
		} catch {
			if (sequence === requestSequence) brandColors = [];
		}
	}

	async function saveSettings() {
		saving = true;
		try {
			const settings: Partial<typeof workspaceCtx.settings> = {
				name: workspaceCtx.settings.name.trim(),
				avatar_url: workspaceCtx.settings.avatar_url,
				color: workspaceCtx.settings.color,
				timezone: workspaceCtx.settings.timezone,
				week_start: workspaceCtx.settings.week_start
			};
			if (
				workspaceCtx.settings.require_client_review !==
				workspaceCtx.savedSettings.require_client_review
			) {
				settings.require_client_review = workspaceCtx.settings.require_client_review;
			}
			await workspaceCtx.saveSettings(settings);
			showToast(m.settings_saved());
		} catch (cause) {
			showToast(
				cause instanceof WorkspaceContextError
					? m.settings_action_failed()
					: cause instanceof Error
						? cause.message
						: m.settings_action_failed(),
				'error'
			);
		} finally {
			saving = false;
		}
	}

	function selectWorkspaceImage(mediaIDs: string[]): boolean {
		const mediaID = mediaIDs[0];
		if (!mediaID) return false;
		workspaceCtx.settings.avatar_url = `/media/${mediaID}`;
		return true;
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
				initialMode="upload"
				autoConfirmUploads={true}
				title={m.settings_workspace_image_url()}
				onConfirm={selectWorkspaceImage}
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
					{#if workspaceCtx.currentWorkspace?.organization_name && workspaceCtx.currentWorkspace.organization_name !== workspaceCtx.currentWorkspace.name}
						<span class="text-sm text-muted-foreground">
							{workspaceCtx.currentWorkspace.organization_name}
						</span>
					{/if}
				</div>
				<div class="flex flex-wrap gap-2">
					<Button type="button" variant="outline" onclick={() => (imagePickerOpen = true)}>
						<ThemeIcon role="image" class="mr-2 size-4" />
						{m.settings_change_workspace_image()}
					</Button>
					{#if workspaceCtx.settings.avatar_url}
						<Button
							type="button"
							variant="ghost"
							class="text-destructive hover:text-destructive"
							onclick={() => (workspaceCtx.settings.avatar_url = '')}
						>
							<ThemeIcon role="delete" class="mr-2 size-4" />{m.settings_remove()}
						</Button>
					{/if}
				</div>
			</div>
		</div>
	</div>
	<div id="workspace-name" class="max-w-sm">
		<FormField id="workspace-name-input" label={m.onboarding_workspace_name()} required>
			{#snippet children({ id, describedBy, invalid })}
				<Input
					{id}
					aria-describedby={describedBy}
					aria-invalid={invalid}
					bind:value={workspaceCtx.settings.name}
					maxlength={100}
					required
				/>
			{/snippet}
		</FormField>
	</div>
	<div class="mt-4 max-w-sm space-y-2">
		<Label for="workspace-color">{m.settings_workspace_color()}</Label>
		<div class="[&>button]:min-h-11">
			<ColorPicker
				id="workspace-color"
				label={m.settings_workspace_color()}
				value={workspaceCtx.settings.color}
				{brandColors}
				onChange={(color) => (workspaceCtx.settings.color = color)}
			/>
		</div>
	</div>
</section>

<section id="date-time" class="scroll-mt-24 space-y-4">
	<SectionHeader title={m.settings_date_time()} themeIconRole="time" class="mb-4" />
	<div class="grid gap-4 sm:grid-cols-2">
		<div class="space-y-2">
			<label class="text-sm font-medium" for="timezone-select">{m.settings_timezone()}</label>
			<Select.Root
				type="single"
				value={workspaceCtx.settings.timezone}
				onValueChange={(value) => (workspaceCtx.settings.timezone = value)}
			>
				<Select.Trigger id="timezone-select" class="w-full">
					{getTimezoneLabel(workspaceCtx.settings.timezone, getLocaleTag())}
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
		</div>
	</div>
</section>

{#if workspaceCtx.currentWorkspace?.role === 'admin' && (workspaceCtx.currentWorkspace.client_reviews_enabled || workspaceCtx.savedSettings.require_client_review)}
	<section id="client-review" class="scroll-mt-24 space-y-4">
		<SectionHeader title={m.settings_client_review()} themeIconRole="security" class="mb-4" />
		<div class="flex items-start gap-3 rounded-lg border bg-muted/20 p-4">
			<Checkbox
				id="require-client-review"
				bind:checked={workspaceCtx.settings.require_client_review}
				aria-describedby="require-client-review-description"
			/>
			<div class="min-w-0 flex-1">
				<Label for="require-client-review" class="font-medium"
					>{m.settings_require_client_review()}</Label
				>
				<p
					id="require-client-review-description"
					class="mt-1 text-sm leading-6 text-muted-foreground"
				>
					{m.settings_require_client_review_description()}
				</p>
			</div>
		</div>
	</section>
{/if}

<SettingsFormFooter
	label={m.settings_save_changes()}
	savingLabel={m.settings_save_changes()}
	{saving}
	disabled={!workspaceCtx.settingsDirty}
	onSave={saveSettings}
/>

{#if workspaceCtx.currentWorkspace?.role === 'admin'}
	<section id="workspace-danger" class="scroll-mt-24">
		<Disclosure
			summary={m.settings_danger_zone()}
			boxed
			class="border-destructive/30"
			summaryClass="text-destructive"
		>
			<div class="border-t p-4">
				<div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
					<div>
						<p class="text-sm font-medium text-destructive">{m.workspace_delete_title()}</p>
						<p class="text-sm text-muted-foreground">{m.workspace_delete_description()}</p>
					</div>
					<Button variant="destructive" class="shrink-0" onclick={onDelete}>
						{m.workspace_delete_confirm()}
					</Button>
				</div>
			</div>
		</Disclosure>
	</section>
{/if}
