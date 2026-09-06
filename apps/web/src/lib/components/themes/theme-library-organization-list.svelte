<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { m } from '$lib/paraglide/messages';
	import {
		sameThemeFamily,
		sameThemeReference,
		themeReferenceKey,
		type ThemeReference
	} from './theme-library-model';
	import type { ThemeLibraryItem } from './theme-library-types';

	interface Props {
		items: ThemeLibraryItem[];
		organizationDefaultReference: ThemeReference;
		selectedReference: ThemeReference;
		canManage?: boolean;
		busy?: boolean;
		canCreate?: boolean;
		onNew: () => void;
		onStartWithWorkshop: () => void;
		onPreview: (reference: ThemeReference) => void;
		onApply: (reference: ThemeReference) => void;
		canApply: (reference: ThemeReference) => boolean;
		onEdit: (themeID: string) => void;
		onDeleteRequest: (item: ThemeLibraryItem) => void;
	}

	let {
		items,
		organizationDefaultReference,
		selectedReference,
		canManage = false,
		busy = false,
		canCreate = false,
		onNew,
		onStartWithWorkshop,
		onPreview,
		onApply,
		canApply,
		onEdit,
		onDeleteRequest
	}: Props = $props();
</script>

<div class="space-y-4 border-t border-border pt-6">
	<div class="flex flex-wrap items-end justify-between gap-3">
		<div>
			<h3 class="font-semibold">{m.theme_library_organization_themes()}</h3>
			<p class="mt-1 text-sm text-muted-foreground">
				{m.theme_library_organization_themes_description()}
			</p>
		</div>
		{#if canManage}
			<Button size="sm" intent="ordinary" onclick={onNew} disabled={!canCreate || busy}
				>{m.theme_library_new_theme()}</Button
			>
		{/if}
	</div>

	{#if items.length === 0}
		<div
			class="flex min-h-32 items-center justify-between gap-4 rounded-[var(--theme-radius-lg,var(--radius))] border border-dashed border-border p-4"
		>
			<div>
				<p class="text-sm font-medium">{m.theme_library_empty_title()}</p>
				<p class="mt-1 text-sm text-muted-foreground">{m.theme_library_empty_description()}</p>
			</div>
			{#if canManage}
				<Button intent="primary" onclick={onStartWithWorkshop} disabled={!canCreate || busy}
					>{m.theme_library_start_workshop()}</Button
				>
			{/if}
		</div>
	{:else}
		<div class="divide-y divide-border border-y border-border">
			{#each items as item (themeReferenceKey(item.reference))}
				{@const applicable = canApply(item.reference)}
				{@const actionLabel = applicable
					? m.theme_library_apply()
					: sameThemeReference(item.reference, selectedReference)
						? m.theme_library_applied()
						: m.theme_library_apply()}
				<div class="flex flex-wrap items-center justify-between gap-3 py-3">
					<div class="min-w-0">
						<div class="flex flex-wrap items-center gap-2">
							<p class="font-medium">{item.manifest.name}</p>
							<span
								class="rounded-[var(--theme-radius-pill,999px)] bg-muted px-2 py-0.5 text-xs text-muted-foreground"
							>
								{item.hasDraftChanges
									? m.theme_library_draft_changes()
									: item.state === 'draft'
										? m.theme_library_draft()
										: m.theme_library_published()}
							</span>
						</div>
						<p class="mt-1 text-sm text-muted-foreground">
							{m.theme_library_revision_workspaces({
								revision: item.manifest.revision,
								count: item.assignedWorkspaces ?? 0
							})}
						</p>
						{#if sameThemeFamily(item.reference, organizationDefaultReference)}
							<p
								id={`theme-delete-guard-${item.manifest.id}`}
								class="mt-1 text-xs text-muted-foreground"
							>
								{m.theme_library_delete_default_guard()}
							</p>
						{:else if (item.assignedWorkspaces ?? 0) > 0}
							<p
								id={`theme-delete-guard-${item.manifest.id}`}
								class="mt-1 text-xs text-muted-foreground"
							>
								{m.theme_library_delete_assigned_guard()}
							</p>
						{/if}
					</div>
					<div class="flex flex-wrap gap-2">
						<Button
							size="sm"
							intent="ordinary"
							aria-label={`${m.theme_library_test()} ${item.manifest.name}`}
							onclick={() => onPreview(item.reference)}
							disabled={busy}>{m.theme_library_test()}</Button
						>
						<Button
							size="sm"
							intent="focal"
							aria-label={`${actionLabel} ${item.manifest.name}`}
							onclick={() => onApply(item.reference)}
							disabled={busy || !applicable}
						>
							{actionLabel}
						</Button>
						<Button
							size="sm"
							intent="quiet"
							onclick={() => onEdit(item.manifest.id)}
							disabled={!canManage || busy}>{m.common_edit()}</Button
						>
						<Button
							size="sm"
							intent="destructive"
							onclick={() => onDeleteRequest(item)}
							disabled={!canManage ||
								busy ||
								sameThemeFamily(item.reference, organizationDefaultReference) ||
								(item.assignedWorkspaces ?? 0) > 0}
							aria-describedby={sameThemeFamily(item.reference, organizationDefaultReference) ||
							(item.assignedWorkspaces ?? 0) > 0
								? `theme-delete-guard-${item.manifest.id}`
								: undefined}>{m.common_delete()}</Button
						>
					</div>
				</div>
			{/each}
		</div>
	{/if}
</div>
