<script lang="ts">
	import { createQuery } from '@tanstack/svelte-query';
	import { mode } from 'mode-watcher';
	import { replaceState } from '$app/navigation';
	import { page } from '$app/state';

	import { themeMutationCachePlan } from '@openpost/query-catalog';
	import { client } from '$lib/api/client';
	import { executeQueryCachePlan } from '$lib/query/cache-plan';
	import { queryClient } from '$lib/query/client';
	import {
		themeAvailableThemesOptions,
		themeOrganizationThemeOptions,
		themeQueryAPI,
		themeRevisionsOptions,
		themeSettingsOptions
	} from '$lib/query/themes';
	import { workspaceCtx } from '$lib/stores/workspace.svelte';
	import { m } from '$lib/paraglide/messages';
	import ThemeEditor from './theme-editor.svelte';
	import ThemeLibrary from './theme-library.svelte';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import type { ThemeManifest } from '$lib/themes';
	import type { CreateThemeInput, ThemeLibraryItem } from './theme-library-types';
	import type { ThemeReference } from './theme-library-model';
	import type { ThemeRevisionItem } from './theme-editor-types';
	import type { components } from '$lib/api/types';

	type ThemeSettings = components['schemas']['ThemeSettings'];
	type ThemeSummary = components['schemas']['ThemeSummary'];

	let workspaceID = $derived(workspaceCtx.currentWorkspace?.id ?? '');
	let organizationID = $derived(workspaceCtx.currentWorkspace?.organization_id ?? '');

	// Previews and selection follow the user's effective light or dark scheme;
	// the backend resolver takes only a concrete scheme.
	let systemDark = $state(false);
	$effect(() => {
		if (typeof window === 'undefined') return;
		const query = window.matchMedia('(prefers-color-scheme: dark)');
		systemDark = query.matches;
		const onChange = (event: MediaQueryListEvent) => (systemDark = event.matches);
		query.addEventListener('change', onChange);
		return () => query.removeEventListener('change', onChange);
	});
	let preferredMode = $derived(mode.current ?? 'system');
	let scheme: 'light' | 'dark' = $derived(
		preferredMode === 'dark' || (preferredMode === 'system' && systemDark) ? 'dark' : 'light'
	);

	const settings = createQuery(() => themeSettingsOptions(workspaceID));
	const available = createQuery(() => themeAvailableThemesOptions(workspaceID));

	// SAFETY: the settings query is typed by themeSettingsOptions against the generated contract.
	let settingsData = $derived(settings.data as ThemeSettings | undefined);
	let canManageOrganization = $derived(settingsData?.can_manage_organization ?? false);
	let canManageWorkspace = $derived(settingsData?.can_manage_workspace ?? false);

	// Published custom themes need their manifest for real previews. One query
	// resolves the bounded page plus each published manifest so the library
	// renders every entry through the product runtime.
	const library = createQuery(() => ({
		queryKey: [...themeAvailableThemesOptions(workspaceID).queryKey, 'manifests'],
		enabled: available.data !== undefined && Boolean(workspaceID),
		queryFn: async ({ signal }: { signal: AbortSignal }) => {
			const pageResult = await themeQueryAPI.listAvailableThemes(workspaceID, signal);
			let failedPreviewCount = 0;
			const items = await Promise.all(
				pageResult.items.map(async (summary: ThemeSummary) => {
					const reference = summary.reference;
					if (reference.kind !== 'custom' || !summary.published_revision) return null;
					try {
						const detail = await themeQueryAPI.getAvailableCustomTheme(
							workspaceID,
							reference.id,
							summary.published_revision,
							signal
						);
						return {
							manifest: detail.manifest,
							reference,
							source: 'organization' as const,
							state: 'published' as const,
							hasDraftChanges: Boolean(
								summary.draft_revision &&
								summary.published_revision &&
								summary.draft_revision > summary.published_revision.version
							),
							assignedWorkspaces: summary.assigned_workspace_count
						} satisfies ThemeLibraryItem;
					} catch {
						// Keep the failure visible instead of silently dropping the theme.
						failedPreviewCount += 1;
						return null;
					}
				})
			);
			return {
				items: items.filter((item): item is ThemeLibraryItem => item !== null),
				failedPreviewCount
			};
		}
	}));

	let libraryItems = $derived(library.data?.items ?? []);
	let failedPreviewCount = $derived(library.data?.failedPreviewCount ?? 0);
	let selectedReference = $derived(settingsData?.effective_selection ?? undefined);
	let workspaceReference = $derived(settingsData?.workspace_selection ?? undefined);
	let organizationDefaultReference = $derived(settingsData?.organization_default ?? undefined);
	let selectionLocked = $derived(settingsData?.assignments_locked ?? false);

	let pendingMutations = $state(0);
	let actionError = $state<string | null>(null);
	let busy = $derived(
		settings.isFetching || available.isFetching || library.isFetching || pendingMutations > 0
	);

	async function runWrite(action: () => Promise<void>, failure: string) {
		actionError = null;
		pendingMutations += 1;
		try {
			await action();
			await executeQueryCachePlan(queryClient, themeMutationCachePlan(workspaceID));
			await queryClient.invalidateQueries({ queryKey: themeSettingsOptions(workspaceID).queryKey });
			await queryClient.invalidateQueries({
				queryKey: themeAvailableThemesOptions(workspaceID).queryKey
			});
		} catch (cause) {
			actionError = cause instanceof Error && cause.message ? cause.message : failure;
		} finally {
			pendingMutations -= 1;
		}
	}

	async function onSelect(reference: ThemeReference) {
		await runWrite(
			() =>
				client
					.PUT('/theme-assignments/{workspace_id}', {
						params: { path: { workspace_id: workspaceID } },
						body: { reference }
					})
					.then((result) => {
						if (result.error) throw new Error(m.theme_library_workspace_change_failed());
					}),
			m.theme_library_workspace_change_failed()
		);
	}

	async function onInherit() {
		await runWrite(
			() =>
				client
					.PUT('/theme-assignments/{workspace_id}', {
						params: { path: { workspace_id: workspaceID } },
						body: { reference: null }
					})
					.then((result) => {
						if (result.error) throw new Error(m.theme_library_workspace_change_failed());
					}),
			m.theme_library_workspace_change_failed()
		);
	}

	async function onSetDefault(reference: ThemeReference) {
		await runWrite(
			() =>
				client
					.PUT('/theme-settings/organization', {
						body: {
							organization_id: organizationID,
							default_reference: reference,
							assignments_locked: settingsData?.assignments_locked ?? false
						}
					})
					.then((result) => {
						if (result.error) throw new Error(m.theme_library_default_change_failed());
					}),
			m.theme_library_default_change_failed()
		);
	}

	async function onToggleLock(locked: boolean) {
		await runWrite(() => {
			const fallback = settingsData?.organization_default;
			if (!fallback) throw new Error(m.theme_library_lock_failed());
			return client
				.PUT('/theme-settings/organization', {
					body: {
						organization_id: organizationID,
						default_reference: fallback,
						assignments_locked: locked
					}
				})
				.then((result) => {
					if (result.error) throw new Error(m.theme_library_lock_failed());
				});
		}, m.theme_library_lock_failed());
	}

	async function onCreate(input: CreateThemeInput) {
		await runWrite(
			() =>
				client
					.POST('/themes', {
						body: {
							organization_id: organizationID,
							name: input.name,
							...(input.source.kind === 'built_in'
								? { duplicate_built_in_id: input.source.id }
								: {
										manifest: libraryItems.find(
											(item) =>
												item.reference.kind === 'custom' && item.reference.id === input.source.id
										)?.manifest
									})
						}
					})
					.then((result) => {
						if (result.error) throw new Error(m.theme_library_create_failed());
					}),
			m.theme_library_create_failed()
		);
	}

	async function onDelete(themeID: string) {
		await runWrite(
			() =>
				client
					.DELETE('/themes/{id}', {
						params: {
							path: { id: themeID },
							query: { organization_id: organizationID, confirm: true }
						}
					})
					.then((result) => {
						if (result.error) throw new Error(m.theme_library_delete_failed());
					}),
			m.theme_library_delete_failed()
		);
	}

	let editingThemeID = $state(page.url.searchParams.get('theme') ?? '');

	function onEdit(themeID: string) {
		const url = new URL(page.url.href);
		url.searchParams.set('tab', 'appearance');
		url.searchParams.set('theme', themeID);
		replaceState(url.href, {});
		editingThemeID = themeID;
	}

	function closeEditor() {
		const url = new URL(page.url.href);
		url.searchParams.delete('theme');
		replaceState(url.href, {});
		editingThemeID = '';
	}

	const editorDetail = createQuery(() =>
		themeOrganizationThemeOptions(workspaceID, organizationID, editingThemeID)
	);
	const editorRevisions = createQuery(() =>
		themeRevisionsOptions(workspaceID, organizationID, editingThemeID)
	);

	let detail = $derived(editorDetail.data);
	let draftManifest = $derived(detail?.draft?.manifest ?? null);
	let baselineManifest = $derived(detail?.latest_published?.manifest ?? null);
	let canPublish = $derived(canManageOrganization && Boolean(detail?.draft));
	let revisionItems = $derived.by(() => {
		const pageResult = editorRevisions.data;
		if (!pageResult) return [];
		return pageResult.items.map((revision) => ({
			revision: revision.revision,
			label: m.theme_editor_revision({ revision: revision.revision }),
			publishedAt: revision.published_at,
			current: detail?.summary.published_revision?.version === revision.revision
		}));
	});

	async function saveDraft(manifest: ThemeManifest) {
		const current = detail;
		if (!current?.draft) throw new Error(m.theme_editor_draft_save_failed());
		const themeID = current.summary.reference.id;
		const { data, error } = await client.PUT('/themes/{id}/draft', {
			params: { path: { id: themeID } },
			body: {
				organization_id: organizationID,
				expected_revision: current.draft.revision,
				name: current.summary.name,
				manifest
			}
		});
		if (error || !data) throw new Error(m.theme_editor_draft_save_failed());
		await queryClient.invalidateQueries({
			queryKey: themeOrganizationThemeOptions(workspaceID, organizationID, themeID).queryKey
		});
		return data;
	}

	async function onSave(manifest: ThemeManifest) {
		await runWrite(async () => {
			await saveDraft(manifest);
		}, m.theme_editor_draft_save_failed());
	}

	async function onPublish(manifest: ThemeManifest) {
		await runWrite(async () => {
			const saved = await saveDraft(manifest);
			const themeID = saved.summary.reference.id;
			const { error } = await client.POST('/themes/{id}/publish', {
				params: { path: { id: themeID } },
				body: {
					organization_id: organizationID,
					expected_draft_revision: saved.draft?.revision ?? 0,
					expected_published_revision: saved.summary.published_revision?.version ?? 0
				}
			});
			if (error) throw new Error(m.theme_editor_publish_failed());
			await queryClient.invalidateQueries({
				queryKey: themeOrganizationThemeOptions(workspaceID, organizationID, themeID).queryKey
			});
		}, m.theme_editor_publish_failed());
	}

	async function onRollback(revision: number) {
		let rolledManifest: ThemeManifest | null = null;
		await runWrite(async () => {
			const current = detail;
			if (!current) throw new Error(m.theme_editor_restore_failed());
			const themeID = current.summary.reference.id;
			const { data, error } = await client.POST('/themes/{id}/rollback', {
				params: { path: { id: themeID } },
				body: {
					organization_id: organizationID,
					source_revision: revision,
					expected_draft_revision: current.draft?.revision ?? 0,
					expected_published_revision: current.summary.published_revision?.version ?? 0
				}
			});
			if (error || !data) throw new Error(m.theme_editor_restore_failed());
			rolledManifest = data.manifest;
			await queryClient.invalidateQueries({
				queryKey: themeOrganizationThemeOptions(workspaceID, organizationID, themeID).queryKey
			});
		}, m.theme_editor_restore_failed());
		if (!rolledManifest) throw new Error(m.theme_editor_restore_failed());
		return rolledManifest;
	}
</script>

{#if actionError}
	<InlineNotice tone="error" message={actionError} />
{/if}

{#if editingThemeID && detail && draftManifest}
	<ThemeEditor
		initialTheme={draftManifest}
		baselineTheme={baselineManifest ?? undefined}
		revisions={revisionItems}
		{canPublish}
		busy={busy || editorDetail.isFetching || editorRevisions.isFetching}
		{onSave}
		onPublish={canPublish ? onPublish : undefined}
		onRollback={canPublish ? onRollback : undefined}
		onReload={() => {
			const manifest = detail?.draft?.manifest;
			if (!manifest) throw new Error(m.theme_editor_reload_failed());
			return manifest;
		}}
		onClose={closeEditor}
	/>
{:else if editingThemeID && editorDetail.isError}
	<InlineNotice tone="error" message={m.theme_library_open_failed()} />
{/if}

{#if !editingThemeID}
	{#if failedPreviewCount > 0}
		<InlineNotice tone="warning" message={m.theme_library_preview_failed()} />
	{/if}
	<ThemeLibrary
		organizationThemes={libraryItems}
		{selectedReference}
		{workspaceReference}
		{organizationDefaultReference}
		workspaceSelectionLocked={selectionLocked}
		{scheme}
		{canManageOrganization}
		{canManageWorkspace}
		{busy}
		onSelect={canManageWorkspace ? onSelect : undefined}
		onInherit={canManageWorkspace ? onInherit : undefined}
		onSetDefault={canManageOrganization ? onSetDefault : undefined}
		onCreate={canManageOrganization ? onCreate : undefined}
		onEdit={canManageOrganization ? onEdit : undefined}
		onDelete={canManageOrganization ? onDelete : undefined}
		onToggleLock={canManageOrganization ? onToggleLock : undefined}
	/>
{/if}
