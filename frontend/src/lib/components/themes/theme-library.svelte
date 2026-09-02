<script lang="ts">
	import { untrack } from 'svelte';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import * as Dialog from '$lib/components/ui/dialog';
	import * as Select from '$lib/components/ui/select';
	import DestructiveConfirmDialog from '$lib/components/destructive-confirm-dialog.svelte';
	import {
		BUILT_IN_THEMES,
		resolveBuiltInTheme,
		type ThemeManifest,
		type ThemeScheme,
		type WebResolvedTheme
	} from '$lib/themes';
	import ThemePreview from './theme-preview.svelte';
	import { themeCodePointLength } from './theme-editor-model';
	import {
		builtInManifestReference,
		sameThemeFamily,
		sameThemeReference,
		themeReferenceKey,
		WORKSHOP_REFERENCE,
		type ThemeReference
	} from './theme-library-model';

	export interface ThemeLibraryItem {
		manifest: ThemeManifest;
		reference: ThemeReference;
		source: 'builtin' | 'organization';
		state?: 'draft' | 'published';
		hasDraftChanges?: boolean;
		assignedWorkspaces?: number;
	}
	export interface CreateThemeInput {
		name: string;
		source: ThemeReference;
	}
	const localBuiltInThemes: ThemeLibraryItem[] = BUILT_IN_THEMES.map((manifest) => ({
		manifest,
		reference: builtInManifestReference(manifest.id, manifest.revision),
		source: 'builtin',
		state: 'published'
	}));

	interface Props {
		builtInThemes?: ThemeLibraryItem[];
		organizationThemes?: ThemeLibraryItem[];
		selectedReference?: ThemeReference;
		workspaceReference?: ThemeReference;
		organizationDefaultReference?: ThemeReference;
		workspaceSelectionLocked?: boolean;
		scheme?: ThemeScheme;
		canManageOrganization?: boolean;
		canManageWorkspace?: boolean;
		busy?: boolean;
		previewResourceURL?: (resourceID: string, manifest: ThemeManifest) => string;
		onSelect?: (reference: ThemeReference) => void | Promise<void>;
		onInherit?: () => void | Promise<void>;
		onSetDefault?: (reference: ThemeReference) => void | Promise<void>;
		onCreate?: (input: CreateThemeInput) => void | Promise<void>;
		onEdit?: (themeID: string) => void | Promise<void>;
		onDelete?: (themeID: string) => void | Promise<void>;
		onToggleLock?: (locked: boolean) => void | Promise<void>;
	}

	let {
		builtInThemes = localBuiltInThemes,
		organizationThemes = [],
		selectedReference = WORKSHOP_REFERENCE,
		workspaceReference,
		organizationDefaultReference = WORKSHOP_REFERENCE,
		workspaceSelectionLocked = false,
		scheme = 'light',
		canManageOrganization = false,
		canManageWorkspace = false,
		busy = false,
		previewResourceURL,
		onSelect,
		onInherit,
		onSetDefault,
		onCreate,
		onEdit,
		onDelete,
		onToggleLock
	}: Props = $props();
	let deleteCandidate = $state<ThemeLibraryItem | null>(null);
	let deleteDialogOpen = $state(false);
	let lockDialogOpen = $state(false);
	let createDialogOpen = $state(false);
	let createName = $state('');
	let createSourceReference = $state<ThemeReference>(WORKSHOP_REFERENCE);
	let createError = $state('');
	let previewReference = $state<ThemeReference>(untrack(() => selectedReference));
	let observedSelectedReferenceKey = $state(untrack(() => themeReferenceKey(selectedReference)));
	let actionError = $state('');
	let pendingAction = $state(false);

	const effectiveBuiltInThemes = $derived(
		builtInThemes.length > 0 ? builtInThemes : localBuiltInThemes
	);
	const allItems = $derived([...effectiveBuiltInThemes, ...organizationThemes]);
	const copySourceItems = $derived(allItems.filter((item) => item.state !== 'draft'));
	const workshopReference = $derived(
		effectiveBuiltInThemes.find((item) => item.manifest.id === 'workshop')?.reference ??
			WORKSHOP_REFERENCE
	);
	const activeItem = $derived(
		allItems.find((item) => sameThemeReference(item.reference, selectedReference)) ??
			effectiveBuiltInThemes[0]!
	);
	const selectedItem = $derived(
		allItems.find((item) => sameThemeReference(item.reference, previewReference)) ?? activeItem
	);
	const createSourceItem = $derived(
		copySourceItems.find((item) => sameThemeReference(item.reference, createSourceReference)) ??
			effectiveBuiltInThemes[0]!
	);
	const selectedPreview = $derived(resolvePreview(selectedItem, scheme));
	const selectedFallbackMessage = $derived(
		selectedPreview.fallbackReason === 'unsupported-scheme'
			? `${selectedItem.manifest.name} has no complete ${scheme} scheme. OpenPost will use Workshop ${scheme} instead.`
			: selectedPreview.fallbackReason === 'unsafe-resource' ||
				  selectedPreview.fallbackReason === 'resource-failed'
				? `${selectedItem.manifest.name} has a font or illustration that cannot be previewed safely. OpenPost will use Workshop ${scheme} instead.`
				: `${selectedItem.manifest.name} is incomplete. OpenPost will use Workshop ${scheme} instead.`
	);
	const selectedCanAssign = $derived(selectedItem.state !== 'draft');
	const selectedIsOrganizationDefault = $derived(
		sameThemeReference(selectedItem.reference, organizationDefaultReference)
	);
	const selectedIsActive = $derived(sameThemeReference(selectedItem.reference, selectedReference));
	const workspaceInherits = $derived(workspaceReference === undefined);
	const assignmentActionVisible = $derived(
		selectedIsOrganizationDefault ? !workspaceInherits : !selectedIsActive || workspaceInherits
	);
	const assignmentActionAvailable = $derived(
		selectedIsOrganizationDefault ? Boolean(onInherit) : Boolean(onSelect)
	);
	const createNameValid = $derived(
		themeCodePointLength(createName.trim()) >= 1 && themeCodePointLength(createName.trim()) <= 80
	);
	const libraryBusy = $derived(busy || pendingAction);
	const defaultName = $derived(
		allItems.find((item) => sameThemeReference(item.reference, organizationDefaultReference))
			?.manifest.name ?? 'Workshop'
	);

	$effect(() => {
		const nextKey = themeReferenceKey(selectedReference);
		if (nextKey === observedSelectedReferenceKey) return;
		observedSelectedReferenceKey = nextKey;
		previewReference = selectedReference;
	});

	function resolvePreview(item: ThemeLibraryItem, requestedScheme: ThemeScheme): WebResolvedTheme {
		if (item.source === 'builtin') return resolveBuiltInTheme(item.manifest.id, requestedScheme);
		const manifest = item.manifest.schemes[requestedScheme];
		if (!manifest) {
			return {
				...resolveBuiltInTheme('workshop', requestedScheme),
				source: 'fallback',
				fallbackReason: 'unsupported-scheme'
			};
		}
		if (
			!previewResourceURL &&
			[...item.manifest.fonts, ...item.manifest.assets].some((resource) =>
				resource.sourceUrl.startsWith('asset:')
			)
		) {
			return {
				...resolveBuiltInTheme('workshop', requestedScheme),
				source: 'fallback',
				fallbackReason: 'unsafe-resource'
			};
		}
		return {
			id: item.manifest.id,
			revision: item.manifest.revision,
			name: item.manifest.name,
			iconPack: item.manifest.iconPack,
			source: 'organization',
			requestedScheme,
			scheme: requestedScheme,
			manifest,
			fonts: item.manifest.fonts.map((font) => ({
				...font,
				sourceUrl: previewResourceURL?.(font.id, item.manifest) ?? font.sourceUrl
			})),
			assets: item.manifest.assets.map((asset) => ({
				...asset,
				sourceUrl: previewResourceURL?.(asset.id, item.manifest) ?? asset.sourceUrl
			})),
			...(previewResourceURL ? { webResourceScope: 'editor-preview' as const } : {})
		};
	}

	function thumbnailScheme(item: ThemeLibraryItem) {
		return (
			item.manifest.schemes[scheme] ?? item.manifest.schemes[item.manifest.supportedSchemes[0]]
		);
	}

	function navigateThemeOptions(event: KeyboardEvent) {
		if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
			return;
		}
		const listbox = (event.currentTarget as HTMLElement).closest('[role="listbox"]');
		const options = [
			...(listbox?.querySelectorAll<HTMLElement>('[role="option"]:not(:disabled)') ?? [])
		];
		const current = options.indexOf(event.currentTarget as HTMLElement);
		if (current < 0 || options.length === 0) return;
		event.preventDefault();
		const columns = matchMedia('(min-width: 64rem)').matches
			? 4
			: matchMedia('(min-width: 40rem)').matches
				? 2
				: 1;
		const next =
			event.key === 'Home'
				? 0
				: event.key === 'End'
					? options.length - 1
					: event.key === 'ArrowLeft'
						? current - 1
						: event.key === 'ArrowRight'
							? current + 1
							: event.key === 'ArrowUp'
								? current - columns
								: current + columns;
		options[Math.max(0, Math.min(options.length - 1, next))]?.focus();
	}

	async function deleteTheme() {
		if (!deleteCandidate || !onDelete) {
			return { ok: false, message: 'This theme cannot be deleted right now.' };
		}
		try {
			await onDelete(deleteCandidate.manifest.id);
			deleteDialogOpen = false;
			deleteCandidate = null;
			return { ok: true };
		} catch (error) {
			return {
				ok: false,
				message: error instanceof Error ? error.message : 'OpenPost could not delete this theme.'
			};
		}
	}

	async function confirmLock() {
		if (!onToggleLock) {
			return { ok: false, message: 'Organization theme settings are unavailable right now.' };
		}
		try {
			await onToggleLock(true);
			lockDialogOpen = false;
			return { ok: true };
		} catch (error) {
			return {
				ok: false,
				message: error instanceof Error ? error.message : 'OpenPost could not lock theme selection.'
			};
		}
	}

	function openCreateDialog(source: ThemeReference, suggestedName = '') {
		createSourceReference = source;
		createName = suggestedName;
		createError = '';
		createDialogOpen = true;
	}

	async function createTheme() {
		const name = createName.trim();
		if (!onCreate || pendingAction || !createNameValid) return;
		pendingAction = true;
		createError = '';
		actionError = '';
		try {
			await onCreate({ name, source: createSourceReference });
			createDialogOpen = false;
			createName = '';
		} catch (error) {
			createError =
				error instanceof Error ? error.message : 'OpenPost could not create this theme.';
		} finally {
			pendingAction = false;
		}
	}

	async function runAction(action: (() => void | Promise<void>) | undefined, fallback: string) {
		if (!action || pendingAction) return;
		pendingAction = true;
		actionError = '';
		try {
			await action();
		} catch (error) {
			actionError = error instanceof Error ? error.message : fallback;
		} finally {
			pendingAction = false;
		}
	}
</script>

<section
	class="space-y-8"
	aria-labelledby="theme-library-heading"
	aria-busy={libraryBusy}
	data-testid="theme-library"
>
	<div class="flex flex-wrap items-start justify-between gap-4">
		<div class="max-w-2xl">
			<h2 id="theme-library-heading" class="text-lg font-semibold tracking-tight">
				Organization theme
			</h2>
			<p class="mt-1 text-sm leading-relaxed text-muted-foreground">
				Choose how OpenPost looks for this workspace. Organization admins can publish custom themes
				and decide whether workspaces may choose their own.
			</p>
		</div>
		{#if canManageOrganization}
			<Button
				intent="focal"
				onclick={() => openCreateDialog(workshopReference)}
				disabled={!onCreate || libraryBusy}>Create theme</Button
			>
		{/if}
	</div>

	{#if actionError}
		<div
			class="rounded-[var(--theme-radius-md,var(--radius))] border border-destructive/35 bg-destructive/8 px-3 py-2 text-sm text-destructive"
			role="alert"
		>
			{actionError}
		</div>
	{/if}

	<div class="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1.55fr)_minmax(17rem,0.65fr)]">
		<div class="min-w-0 space-y-3">
			<div class="flex flex-wrap items-start justify-between gap-3">
				<div>
					<div class="flex flex-wrap items-center gap-2">
						<h3 class="font-semibold">{selectedItem.manifest.name}</h3>
						<span
							class="rounded-[var(--theme-radius-pill,999px)] bg-muted px-2 py-0.5 text-xs text-muted-foreground"
							>{selectedItem.source === 'builtin'
								? 'Built-in'
								: selectedItem.hasDraftChanges
									? 'Draft changes'
									: (selectedItem.state ?? 'published')}</span
						>
					</div>
					<p class="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">
						{selectedItem.manifest.description}
					</p>
				</div>
				<span class="text-xs text-muted-foreground">Revision {selectedItem.manifest.revision}</span>
			</div>
			<ThemePreview
				theme={selectedPreview}
				scene="dashboard"
				viewport="desktop"
				label={`${selectedPreview.name} dashboard preview`}
			/>
			{#if selectedPreview.fallbackReason}
				<p
					class="rounded-[var(--theme-radius-md,var(--radius))] border border-warning/35 bg-warning/10 px-3 py-2 text-xs text-foreground"
					role="status"
				>
					{selectedFallbackMessage}
				</p>
			{/if}
		</div>
		<div
			class="flex flex-col divide-y divide-border rounded-[var(--theme-radius-lg,var(--radius))] border border-border bg-card px-4"
		>
			<div class="py-4">
				<p class="text-xs font-medium text-muted-foreground">This workspace</p>
				<div class="mt-1 flex items-center justify-between gap-3">
					<div>
						<p class="font-semibold">{activeItem.manifest.name}</p>
						<p class="mt-0.5 text-xs text-muted-foreground">
							{workspaceSelectionLocked || workspaceInherits
								? `Set by organization · ${defaultName}`
								: 'Workspace selection'}
						</p>
					</div>
					<span
						class="rounded-[var(--theme-radius-pill,999px)] bg-success/12 px-2 py-1 text-xs font-medium text-success"
					>
						Active
					</span>
				</div>
			</div>

			<div class="py-4">
				<div class="flex items-start justify-between gap-4">
					<div>
						<p class="text-sm font-medium">Organization default</p>
						<p class="mt-0.5 text-xs leading-relaxed text-muted-foreground">
							New workspaces start with {defaultName}.
						</p>
					</div>
					{#if canManageOrganization && selectedCanAssign && !sameThemeReference(previewReference, organizationDefaultReference)}
						<Button
							size="sm"
							intent="ordinary"
							onclick={() =>
								void runAction(
									() => onSetDefault?.(previewReference),
									'OpenPost could not change the organization default.'
								)}
							disabled={libraryBusy}
						>
							Make default
						</Button>
					{/if}
				</div>
			</div>

			<div class="py-4">
				<div class="flex items-center justify-between gap-4">
					<div>
						<p class="text-sm font-medium">Lock workspace selection</p>
						<p class="mt-0.5 text-xs leading-relaxed text-muted-foreground">
							Use the organization default everywhere and clear workspace overrides.
						</p>
					</div>
					<button
						type="button"
						role="switch"
						aria-checked={workspaceSelectionLocked}
						aria-label="Lock workspace theme selection"
						disabled={!canManageOrganization || libraryBusy}
						class="group relative h-11 w-14 shrink-0 rounded-full focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-50"
						onclick={() => {
							if (workspaceSelectionLocked) {
								void runAction(
									() => onToggleLock?.(false),
									'OpenPost could not unlock workspace theme selection.'
								);
								return;
							}
							lockDialogOpen = true;
						}}
					>
						<span
							class="absolute top-2 left-1 h-7 w-12 rounded-full border border-border bg-muted transition-colors group-aria-checked:bg-[var(--action-primary)]"
						>
							<span
								class="absolute top-1/2 left-1 size-5 -translate-y-1/2 rounded-full bg-background shadow-sm transition-transform group-aria-checked:translate-x-5"
							></span>
						</span>
					</button>
				</div>
			</div>

			<div class="flex flex-wrap gap-2 py-4">
				{#if assignmentActionVisible}
					<Button
						intent="focal"
						onclick={() =>
							void runAction(
								selectedIsOrganizationDefault ? onInherit : () => onSelect?.(previewReference),
								'OpenPost could not change this workspace theme.'
							)}
						disabled={!selectedCanAssign ||
							!canManageWorkspace ||
							workspaceSelectionLocked ||
							!assignmentActionAvailable ||
							libraryBusy}
						title={selectedItem.state === 'draft'
							? 'Publish this theme before assigning it'
							: workspaceSelectionLocked
								? 'The organization has locked workspace theme selection'
								: undefined}
					>
						{selectedIsOrganizationDefault
							? 'Use organization default'
							: `Use ${selectedItem.manifest.name}`}
					</Button>
				{/if}
				<Button
					intent="ordinary"
					onclick={() => openCreateDialog(previewReference, `${selectedItem.manifest.name} copy`)}
					disabled={!canManageOrganization || !onCreate || libraryBusy}
				>
					Duplicate
				</Button>
				{#if selectedItem.source === 'organization'}
					<Button
						intent="quiet"
						onclick={() =>
							void runAction(
								() => onEdit?.(previewReference.id),
								'OpenPost could not open this theme.'
							)}
						disabled={!canManageOrganization || libraryBusy}
					>
						Edit theme
					</Button>
				{/if}
			</div>
		</div>
	</div>

	<div class="space-y-4">
		<div>
			<h3 class="font-semibold">Built-in themes</h3>
			<p class="mt-1 text-sm text-muted-foreground">
				Immutable, versioned starting points. Duplicate one to make it yours.
			</p>
		</div>
		<div
			class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
			role="listbox"
			aria-label="Built-in themes"
		>
			{#each effectiveBuiltInThemes as item (themeReferenceKey(item.reference))}
				{@const preview = thumbnailScheme(item)}
				<button
					type="button"
					role="option"
					aria-selected={sameThemeReference(item.reference, previewReference)}
					disabled={libraryBusy}
					onclick={() => (previewReference = item.reference)}
					onkeydown={navigateThemeOptions}
					class="group min-h-32 overflow-hidden rounded-[var(--theme-radius-lg,var(--radius))] border border-border bg-card text-left transition-[border-color,box-shadow,transform] hover:border-ring/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:cursor-default aria-selected:border-ring aria-selected:ring-2 aria-selected:ring-ring/20"
				>
					<div class="h-20 p-3" style:background={preview?.colors.canvas ?? 'var(--background)'}>
						<div
							class="flex h-full overflow-hidden rounded-md border"
							style:background={preview?.colors.surface ?? 'var(--card)'}
							style:border-color={preview?.colors.border ?? 'var(--border)'}
						>
							<div
								class="w-1/4"
								style:background={preview?.colors.sidebar ?? 'var(--sidebar)'}
							></div>
							<div class="flex flex-1 flex-col justify-between p-2">
								<div
									class="h-1.5 w-3/5 rounded-full"
									style:background={preview?.colors.ink ?? 'var(--foreground)'}
								></div>
								<div
									class="h-4 w-1/2 rounded"
									style:background={preview?.colors.actionFocal ?? 'var(--primary)'}
								></div>
							</div>
						</div>
					</div>
					<div class="flex items-start justify-between gap-2 px-3 py-2.5">
						<div class="min-w-0">
							<p class="truncate text-sm font-semibold">{item.manifest.name}</p>
							<p class="mt-0.5 text-xs text-muted-foreground">
								{item.manifest.supportedSchemes.join(' + ')}
							</p>
						</div>
						{#if sameThemeReference(item.reference, selectedReference)}
							<span class="text-xs font-medium text-success">Applied</span>
						{:else if sameThemeReference(item.reference, organizationDefaultReference)}
							<span class="text-xs font-medium text-muted-foreground">Default</span>
						{/if}
					</div>
				</button>
			{/each}
		</div>
	</div>

	<div class="space-y-4 border-t border-border pt-6">
		<div class="flex flex-wrap items-end justify-between gap-3">
			<div>
				<h3 class="font-semibold">Organization themes</h3>
				<p class="mt-1 text-sm text-muted-foreground">
					Published themes are available to every workspace in this organization.
				</p>
			</div>
			{#if canManageOrganization}
				<Button
					size="sm"
					intent="ordinary"
					onclick={() => openCreateDialog(workshopReference)}
					disabled={!onCreate || libraryBusy}>New theme</Button
				>
			{/if}
		</div>

		{#if organizationThemes.length === 0}
			<div
				class="flex min-h-32 items-center justify-between gap-4 rounded-[var(--theme-radius-lg,var(--radius))] border border-dashed border-border p-4"
			>
				<div>
					<p class="text-sm font-medium">No custom themes yet</p>
					<p class="mt-1 text-sm text-muted-foreground">
						Duplicate a built-in theme, then shape it around your organization.
					</p>
				</div>
				{#if canManageOrganization}
					<Button
						intent="primary"
						onclick={() => openCreateDialog(workshopReference, 'Workshop copy')}
						disabled={!onCreate || libraryBusy}>Start with Workshop</Button
					>
				{/if}
			</div>
		{:else}
			<div class="divide-y divide-border border-y border-border">
				{#each organizationThemes as item (themeReferenceKey(item.reference))}
					<div class="flex flex-wrap items-center justify-between gap-3 py-3">
						<div class="min-w-0">
							<div class="flex flex-wrap items-center gap-2">
								<p class="font-medium">{item.manifest.name}</p>
								<span
									class="rounded-[var(--theme-radius-pill,999px)] bg-muted px-2 py-0.5 text-xs text-muted-foreground"
									>{item.hasDraftChanges ? 'Draft changes' : (item.state ?? 'published')}</span
								>
							</div>
							<p class="mt-1 text-sm text-muted-foreground">
								Revision {item.manifest.revision} · {item.assignedWorkspaces ?? 0} workspaces
							</p>
						</div>
						<div class="flex gap-2">
							<Button
								size="sm"
								intent="ordinary"
								onclick={() => (previewReference = item.reference)}
								disabled={libraryBusy}>Preview</Button
							>
							<Button
								size="sm"
								intent="quiet"
								onclick={() =>
									void runAction(
										() => onEdit?.(item.manifest.id),
										'OpenPost could not open this theme.'
									)}
								disabled={!canManageOrganization || libraryBusy}>Edit</Button
							>
							<Button
								size="sm"
								intent="destructive"
								onclick={() => {
									deleteCandidate = item;
									deleteDialogOpen = true;
								}}
								disabled={!canManageOrganization ||
									libraryBusy ||
									sameThemeFamily(item.reference, organizationDefaultReference) ||
									(item.assignedWorkspaces ?? 0) > 0}
								title={sameThemeFamily(item.reference, organizationDefaultReference)
									? 'Choose another organization default before deleting this theme'
									: (item.assignedWorkspaces ?? 0) > 0
										? 'Move every assigned workspace before deleting this theme'
										: undefined}>Delete</Button
							>
						</div>
					</div>
				{/each}
			</div>
		{/if}
	</div>
</section>

<Dialog.Root bind:open={createDialogOpen}>
	<Dialog.Content aria-busy={pendingAction} showCloseButton={false} class="sm:max-w-md">
		<form
			class="space-y-4"
			onsubmit={(event) => {
				event.preventDefault();
				void createTheme();
			}}
		>
			<Dialog.Header>
				<Dialog.Title>Create organization theme</Dialog.Title>
				<Dialog.Description>
					Start with a complete theme, then change only the parts that should feel like your
					organization.
				</Dialog.Description>
			</Dialog.Header>
			<label class="grid gap-1.5 text-sm font-medium" for="theme-create-name">
				Theme name
				<Input
					id="theme-create-name"
					bind:value={createName}
					autocomplete="off"
					disabled={pendingAction}
					autofocus
				/>
				<span class="text-xs font-normal text-muted-foreground tabular-nums">
					{themeCodePointLength(createName.trim())}/80
				</span>
			</label>
			<label class="grid gap-1.5 text-sm font-medium" for="theme-create-source">
				Starting point
				<Select.Root
					value={themeReferenceKey(createSourceReference)}
					onValueChange={(value) => {
						const source = allItems.find((item) => themeReferenceKey(item.reference) === value);
						if (source) createSourceReference = source.reference;
					}}
				>
					<Select.Trigger id="theme-create-source" class="w-full" aria-label="Starting point"
						>{createSourceItem.manifest.name}</Select.Trigger
					>
					<Select.Content>
						{#each copySourceItems as item (themeReferenceKey(item.reference))}
							<Select.Item value={themeReferenceKey(item.reference)}>
								{item.manifest.name}{item.state === 'draft' ? ' draft' : ''}
							</Select.Item>
						{/each}
					</Select.Content>
				</Select.Root>
			</label>
			{#if createError}<p class="text-sm text-destructive" role="alert">{createError}</p>{/if}
			<Dialog.Footer>
				<Button
					type="button"
					intent="quiet"
					disabled={pendingAction}
					onclick={() => (createDialogOpen = false)}>Cancel</Button
				>
				<Button type="submit" intent="focal" disabled={pendingAction || !createNameValid}>
					{pendingAction ? 'Creating…' : 'Create draft'}
				</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>

<DestructiveConfirmDialog
	bind:open={deleteDialogOpen}
	title={deleteCandidate ? `Delete ${deleteCandidate.manifest.name}?` : 'Delete theme?'}
	description="This permanently removes the draft and its revision history. This cannot be undone."
	confirmLabel="Delete theme"
	onConfirm={deleteTheme}
/>

<DestructiveConfirmDialog
	bind:open={lockDialogOpen}
	title="Lock theme selection?"
	description="Every workspace will switch to the organization default. Existing workspace choices will be cleared and cannot be restored automatically."
	confirmLabel="Lock and clear choices"
	onConfirm={confirmLock}
/>
