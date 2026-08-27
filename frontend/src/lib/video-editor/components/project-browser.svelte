<script lang="ts">
	import DestructiveConfirmDialog from '$lib/components/destructive-confirm-dialog.svelte';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import PageLoading from '$lib/components/page-loading.svelte';
	import { Button } from '$lib/components/ui/button';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import { Input } from '$lib/components/ui/input';
	import * as Select from '$lib/components/ui/select';
	import { m } from '$lib/paraglide/messages';
	import type { BundleProgress } from '$lib/video-editor/project-bundle/bundle-types';
	import type { Project } from '$lib/video-editor/project/types';
	import type { TrashedProjectEntry } from '$lib/video-editor/workspace-fs/trash';
	import ArchiveIcon from '@lucide/svelte/icons/archive';
	import ArrowDownIcon from '@lucide/svelte/icons/arrow-down';
	import ArrowUpIcon from '@lucide/svelte/icons/arrow-up';
	import CheckIcon from '@lucide/svelte/icons/check';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import CopyIcon from '@lucide/svelte/icons/copy';
	import DownloadIcon from '@lucide/svelte/icons/download';
	import MoreIcon from '@lucide/svelte/icons/ellipsis';
	import LoaderIcon from '@lucide/svelte/icons/loader-2';
	import PencilIcon from '@lucide/svelte/icons/pencil';
	import PlayIcon from '@lucide/svelte/icons/play-circle';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import RestoreIcon from '@lucide/svelte/icons/rotate-ccw';
	import SearchIcon from '@lucide/svelte/icons/search';
	import TrashIcon from '@lucide/svelte/icons/trash-2';
	import UploadIcon from '@lucide/svelte/icons/upload';
	import XIcon from '@lucide/svelte/icons/x';
	import { onMount } from 'svelte';

	let {
		projects,
		thumbnailUrls,
		trashedProjects,
		loading,
		error,
		trashError,
		trashBusyId,
		emptyingTrash,
		creating,
		importing,
		duplicatingId,
		exportingId,
		exportingKind,
		bundleProgress,
		bundleOperation,
		bundleCanceling,
		oncreate,
		onimportjson,
		onimportbundle,
		onopen,
		onrename,
		onduplicate,
		onexportjson,
		onexportbundle,
		oncancelbundle,
		ondelete,
		ondeletebatch,
		onrestore,
		onpurge,
		onemptytrash
	}: {
		projects: Project[];
		thumbnailUrls: Record<string, string>;
		trashedProjects: TrashedProjectEntry[];
		loading: boolean;
		error: string;
		trashError: string;
		trashBusyId: string | null;
		emptyingTrash: boolean;
		creating: boolean;
		importing: boolean;
		duplicatingId: string | null;
		exportingId: string | null;
		exportingKind: 'json' | 'bundle' | null;
		bundleProgress: BundleProgress | null;
		bundleOperation: 'import' | 'export' | null;
		bundleCanceling: boolean;
		oncreate: (name: string) => Promise<boolean>;
		onimportjson: (file: File) => Promise<void>;
		onimportbundle: (file: File) => Promise<void>;
		onopen: (project: Project) => void;
		onrename: (project: Project) => Promise<void>;
		onduplicate: (project: Project) => Promise<void>;
		onexportjson: (project: Project) => Promise<void>;
		onexportbundle: (project: Project) => Promise<void>;
		oncancelbundle: () => void;
		ondelete: (project: Project) => Promise<void>;
		ondeletebatch: (projects: Project[]) => Promise<string[]>;
		onrestore: (projectId: string, projectName: string) => Promise<void>;
		onpurge: (entry: TrashedProjectEntry) => Promise<void>;
		onemptytrash: () => Promise<void>;
	} = $props();

	let showNewProject = $state(false);
	let newProjectName = $state('');
	let searchQuery = $state('');
	let resolutionFilter = $state('all');
	let fpsFilter = $state('all');
	let projectSort = $state<'updated' | 'created' | 'name' | 'resolution'>('updated');
	let sortDirection = $state<'ascending' | 'descending'>('descending');
	let selectedIds = $state<Set<string>>(new Set());
	let selectionAnchorId = $state<string | null>(null);
	let pendingDelete = $state<Project[] | null>(null);
	let deleteDialogOpen = $state(false);
	let trashOpen = $state(false);
	let pendingPurge = $state<TrashedProjectEntry | 'all' | null>(null);
	let purgeDialogOpen = $state(false);
	let jsonImportInput = $state<HTMLInputElement | null>(null);
	let bundleImportInput = $state<HTMLInputElement | null>(null);

	const resolutions = $derived(
		[...new Set(projects.map(projectResolution))].sort((a, b) => a.localeCompare(b))
	);
	const frameRates = $derived(
		[...new Set(projects.map((project) => project.metadata.fps))].sort((a, b) => a - b)
	);

	const visibleProjects = $derived.by(() => {
		const query = searchQuery.trim().toLocaleLowerCase();
		const filtered = projects.filter((project) => {
			if (
				query &&
				!`${project.name} ${project.description ?? ''}`.toLocaleLowerCase().includes(query)
			) {
				return false;
			}
			if (resolutionFilter !== 'all' && projectResolution(project) !== resolutionFilter) {
				return false;
			}
			return fpsFilter === 'all' || String(project.metadata.fps) === fpsFilter;
		});
		const multiplier = sortDirection === 'ascending' ? 1 : -1;
		return [...filtered].sort((a, b) => {
			if (projectSort === 'name') return a.name.localeCompare(b.name) * multiplier;
			if (projectSort === 'resolution') {
				return (
					(a.metadata.width * a.metadata.height - b.metadata.width * b.metadata.height) * multiplier
				);
			}
			const difference =
				projectSort === 'created' ? a.createdAt - b.createdAt : a.updatedAt - b.updatedAt;
			return difference * multiplier;
		});
	});
	const selectedProjects = $derived(projects.filter((project) => selectedIds.has(project.id)));

	$effect(() => {
		const projectIds = new Set(projects.map((project) => project.id));
		const next = new Set([...selectedIds].filter((id) => projectIds.has(id)));
		if (next.size !== selectedIds.size) selectedIds = next;
	});

	function changeProjectSort(value: string): void {
		if (value === 'updated' || value === 'created' || value === 'name' || value === 'resolution') {
			projectSort = value;
		}
	}

	function projectResolution(project: Project): string {
		return `${project.metadata.width}×${project.metadata.height}`;
	}

	function projectAspectRatio(project: Project): string {
		const { width, height } = project.metadata;
		const ratio = width / height;
		if (Math.abs(ratio - 16 / 9) < 0.01) return '16:9';
		if (Math.abs(ratio - 4 / 3) < 0.01) return '4:3';
		if (Math.abs(ratio - 1) < 0.01) return '1:1';
		if (Math.abs(ratio - 21 / 9) < 0.01) return '21:9';
		return `${width}:${height}`;
	}

	function formatDuration(seconds: number): string {
		const rounded = Math.max(0, Math.round(seconds));
		const hours = Math.floor(rounded / 3600);
		const minutes = Math.floor((rounded % 3600) / 60);
		const remainingSeconds = rounded % 60;
		return hours > 0
			? `${hours}:${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`
			: `${minutes}:${String(remainingSeconds).padStart(2, '0')}`;
	}

	async function createProject(): Promise<void> {
		const created = await oncreate(newProjectName.trim());
		if (!created) return;
		newProjectName = '';
		showNewProject = false;
	}

	function confirmDelete(project: Project): void {
		pendingDelete = [project];
		deleteDialogOpen = true;
	}

	function confirmBulkDelete(): void {
		if (selectedProjects.length === 0) return;
		pendingDelete = [...selectedProjects];
		deleteDialogOpen = true;
	}

	function clearSelection(): void {
		selectedIds = new Set();
		selectionAnchorId = null;
	}

	function toggleSelection(event: MouseEvent, project: Project): void {
		event.stopPropagation();
		const next = new Set(selectedIds);
		if (event.shiftKey && selectionAnchorId) {
			const from = visibleProjects.findIndex((candidate) => candidate.id === selectionAnchorId);
			const to = visibleProjects.findIndex((candidate) => candidate.id === project.id);
			if (from >= 0 && to >= 0) {
				const start = Math.min(from, to);
				const end = Math.max(from, to);
				for (const candidate of visibleProjects.slice(start, end + 1)) next.add(candidate.id);
			}
		} else if (next.has(project.id)) {
			next.delete(project.id);
		} else {
			next.add(project.id);
		}
		selectedIds = next;
		selectionAnchorId = project.id;
	}

	function confirmPurge(target: TrashedProjectEntry | 'all'): void {
		pendingPurge = target;
		purgeDialogOpen = true;
	}

	async function importFile(event: Event, kind: 'json' | 'bundle'): Promise<void> {
		const input = event.currentTarget;
		if (!(input instanceof HTMLInputElement)) return;
		const file = input.files?.[0];
		input.value = '';
		if (file) await (kind === 'json' ? onimportjson(file) : onimportbundle(file));
	}

	onMount(() => {
		function handleSelectionKeydown(event: KeyboardEvent): void {
			const target = event.target;
			if (
				target instanceof HTMLElement &&
				(target.matches('input, textarea, select') ||
					target.isContentEditable ||
					target.closest('button, a, [role="dialog"], [role="menu"], [role="listbox"]'))
			) {
				return;
			}
			if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === 'a') {
				event.preventDefault();
				selectedIds = new Set(visibleProjects.map((project) => project.id));
				selectionAnchorId = visibleProjects[0]?.id ?? null;
				return;
			}
			if (event.key === 'Escape' && selectedIds.size > 0) {
				clearSelection();
				return;
			}
			if ((event.key === 'Delete' || event.key === 'Backspace') && selectedIds.size > 0) {
				event.preventDefault();
				confirmBulkDelete();
			}
		}
		window.addEventListener('keydown', handleSelectionKeydown);
		return () => window.removeEventListener('keydown', handleSelectionKeydown);
	});
</script>

<div class="w-full max-w-5xl">
	<div class="flex items-center justify-between gap-3">
		<h1 class="text-base font-semibold">{m.video_editor_projects_title()}</h1>
		<div class="flex items-center gap-2">
			<Input
				bind:ref={jsonImportInput}
				type="file"
				accept="application/json,.json,.openpost.json"
				class="sr-only"
				aria-label={m.video_editor_project_import_json_label()}
				onchange={(event) => void importFile(event, 'json')}
			/>
			<Input
				bind:ref={bundleImportInput}
				type="file"
				accept="application/zip,.zip,.openpost.zip"
				class="sr-only"
				aria-label={m.video_editor_project_import_bundle_label()}
				onchange={(event) => void importFile(event, 'bundle')}
			/>
			<DropdownMenu.Root>
				<DropdownMenu.Trigger>
					{#snippet child({ props })}
						<Button
							{...props}
							variant="outline"
							size="sm"
							disabled={importing || bundleOperation !== null}
							aria-label={m.video_editor_project_import()}
							title={m.video_editor_project_import()}
							aria-busy={importing}
						>
							{#if importing}
								<LoaderIcon
									class="size-4 animate-spin motion-reduce:animate-none"
									aria-hidden="true"
								/>
							{:else}
								<UploadIcon class="size-4" aria-hidden="true" />
							{/if}
							<span class="hidden sm:inline">{m.video_editor_project_import()}</span>
						</Button>
					{/snippet}
				</DropdownMenu.Trigger>
				<DropdownMenu.Content class="video-editor-theme" align="end">
					<DropdownMenu.Item onclick={() => bundleImportInput?.click()}>
						<ArchiveIcon class="size-4" aria-hidden="true" />
						{m.video_editor_project_import_bundle()}
					</DropdownMenu.Item>
					<DropdownMenu.Item onclick={() => jsonImportInput?.click()}>
						<UploadIcon class="size-4" aria-hidden="true" />
						{m.video_editor_project_import_json()}
					</DropdownMenu.Item>
				</DropdownMenu.Content>
			</DropdownMenu.Root>
			<Button
				size="sm"
				disabled={creating || importing || exportingId !== null || bundleOperation !== null}
				onclick={() => (showNewProject = !showNewProject)}
			>
				<PlusIcon class="size-4" aria-hidden="true" />
				{m.video_editor_project_new()}
			</Button>
		</div>
	</div>

	{#if bundleProgress && bundleOperation}
		<div
			class="mt-4 rounded-lg border border-[oklch(0.3_0.025_55)] bg-[oklch(0.16_0.008_55)] px-3 py-2"
			role="status"
			aria-live="polite"
		>
			<div class="flex items-center justify-between gap-3 text-xs">
				<span class="font-medium">
					{bundleOperation === 'import'
						? m.video_editor_project_bundle_importing()
						: m.video_editor_project_bundle_exporting()}
				</span>
				<div class="flex items-center gap-2">
					<span>{Math.round(bundleProgress.percent)}%</span>
					<Button variant="ghost" size="xs" disabled={bundleCanceling} onclick={oncancelbundle}>
						{#if bundleCanceling}
							<LoaderIcon
								class="size-3.5 animate-spin motion-reduce:animate-none"
								aria-hidden="true"
							/>
						{:else}
							<XIcon class="size-3.5" aria-hidden="true" />
						{/if}
						{bundleCanceling
							? m.video_editor_project_bundle_canceling()
							: m.video_editor_project_bundle_cancel()}
					</Button>
				</div>
			</div>
			<div
				class="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-[oklch(0.25_0.015_55)]"
				role="progressbar"
				aria-valuemin="0"
				aria-valuemax="100"
				aria-valuenow={Math.round(bundleProgress.percent)}
				aria-label={bundleOperation === 'import'
					? m.video_editor_project_bundle_importing()
					: m.video_editor_project_bundle_exporting()}
			>
				<div
					class="h-full rounded-full bg-[oklch(0.66_0.14_45)] transition-[width] motion-reduce:transition-none"
					style:width={`${Math.max(0, Math.min(100, bundleProgress.percent))}%`}
				></div>
			</div>
			{#if bundleProgress.currentFile}
				<p
					class="mt-1 truncate text-xs text-[oklch(0.65_0.015_55)]"
					title={bundleProgress.currentFile}
				>
					{bundleProgress.currentFile}
				</p>
			{/if}
		</div>
	{/if}

	{#if showNewProject}
		<form
			class="mt-4 flex gap-2"
			onsubmit={(event) => {
				event.preventDefault();
				void createProject();
			}}
		>
			<Input
				type="text"
				bind:value={newProjectName}
				placeholder={m.editors_project_name()}
				aria-label={m.editors_project_name()}
				class="bg-[oklch(0.16_0.008_55)] text-[oklch(0.9_0.006_85)] placeholder:text-[oklch(0.58_0.015_55)]"
			/>
			<Button type="submit" disabled={creating}>
				{#if creating}<LoaderIcon
						class="size-4 animate-spin motion-reduce:animate-none"
						aria-hidden="true"
					/>{/if}
				{m.video_editor_project_create()}
			</Button>
		</form>
	{/if}

	<div class="mt-4 grid grid-cols-2 gap-2 lg:grid-cols-[minmax(12rem,1fr)_10.5rem_9rem_10rem_auto]">
		<label class="relative col-span-2 block lg:col-span-1" for="video-editor-project-search">
			<span class="sr-only">{m.video_editor_project_search()}</span>
			<SearchIcon
				class="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-[oklch(0.6_0.015_55)]"
				aria-hidden="true"
			/>
			<Input
				id="video-editor-project-search"
				bind:value={searchQuery}
				placeholder={m.video_editor_project_search()}
				class="bg-[oklch(0.16_0.008_55)] pl-9 text-[oklch(0.9_0.006_85)] placeholder:text-[oklch(0.58_0.015_55)]"
			/>
		</label>
		<Select.Root
			type="single"
			value={resolutionFilter}
			onValueChange={(value) => (resolutionFilter = value)}
		>
			<Select.Trigger
				aria-label={m.video_editor_project_filter_resolution()}
				class="w-full bg-[oklch(0.16_0.008_55)] text-[oklch(0.86_0.008_85)]"
			>
				{resolutionFilter === 'all' ? m.video_editor_project_all_resolutions() : resolutionFilter}
			</Select.Trigger>
			<Select.Content class="video-editor-theme">
				<Select.Item value="all">{m.video_editor_project_all_resolutions()}</Select.Item>
				{#each resolutions as resolution (resolution)}
					<Select.Item value={resolution}>{resolution}</Select.Item>
				{/each}
			</Select.Content>
		</Select.Root>
		<Select.Root type="single" value={fpsFilter} onValueChange={(value) => (fpsFilter = value)}>
			<Select.Trigger
				aria-label={m.video_editor_project_filter_fps()}
				class="w-full bg-[oklch(0.16_0.008_55)] text-[oklch(0.86_0.008_85)]"
			>
				{fpsFilter === 'all' ? m.video_editor_project_all_fps() : `${fpsFilter} fps`}
			</Select.Trigger>
			<Select.Content class="video-editor-theme">
				<Select.Item value="all">{m.video_editor_project_all_fps()}</Select.Item>
				{#each frameRates as fps (fps)}
					<Select.Item value={String(fps)}>{fps} fps</Select.Item>
				{/each}
			</Select.Content>
		</Select.Root>
		<Select.Root type="single" value={projectSort} onValueChange={changeProjectSort}>
			<Select.Trigger
				aria-label={m.video_editor_project_sort()}
				class="w-full bg-[oklch(0.16_0.008_55)] text-[oklch(0.86_0.008_85)]"
			>
				{projectSort === 'updated'
					? m.video_editor_project_sort_updated()
					: projectSort === 'created'
						? m.video_editor_project_sort_created()
						: projectSort === 'name'
							? m.video_editor_project_sort_name()
							: m.video_editor_project_sort_resolution()}
			</Select.Trigger>
			<Select.Content class="video-editor-theme">
				<Select.Item value="updated">{m.video_editor_project_sort_updated()}</Select.Item>
				<Select.Item value="created">{m.video_editor_project_sort_created()}</Select.Item>
				<Select.Item value="name">{m.video_editor_project_sort_name()}</Select.Item>
				<Select.Item value="resolution">{m.video_editor_project_sort_resolution()}</Select.Item>
			</Select.Content>
		</Select.Root>
		<Button
			variant="outline"
			size="icon"
			class="w-full bg-[oklch(0.16_0.008_55)] text-[oklch(0.86_0.008_85)] lg:w-auto"
			aria-label={sortDirection === 'ascending'
				? m.video_editor_project_sort_ascending()
				: m.video_editor_project_sort_descending()}
			title={sortDirection === 'ascending'
				? m.video_editor_project_sort_ascending()
				: m.video_editor_project_sort_descending()}
			onclick={() => (sortDirection = sortDirection === 'ascending' ? 'descending' : 'ascending')}
		>
			{#if sortDirection === 'ascending'}
				<ArrowUpIcon class="size-4" aria-hidden="true" />
			{:else}
				<ArrowDownIcon class="size-4" aria-hidden="true" />
			{/if}
		</Button>
	</div>
	{#if selectedProjects.length > 0}
		<div
			class="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[oklch(0.36_0.06_48)] bg-[oklch(0.2_0.025_48)] px-3 py-2"
		>
			<span class="text-sm font-medium tabular-nums" aria-live="polite">
				{m.video_editor_project_selected_count({ count: selectedProjects.length })}
			</span>
			<div class="flex gap-2">
				<Button variant="ghost" size="sm" onclick={clearSelection}>
					<XIcon class="size-4" aria-hidden="true" />
					{m.video_editor_project_clear_selection()}
				</Button>
				<Button variant="destructive" size="sm" onclick={confirmBulkDelete}>
					<TrashIcon class="size-4" aria-hidden="true" />
					{m.video_editor_project_move_selected_to_trash()}
				</Button>
			</div>
		</div>
	{/if}

	{#if error}<InlineNotice tone="error" class="mt-4">{error}</InlineNotice>{/if}

	{#if loading}
		<PageLoading label={m.editors_loading()} />
	{:else if projects.length === 0}
		<p class="mt-10 text-center text-sm text-[oklch(0.65_0.015_55)]">
			{m.video_editor_projects_empty()}
		</p>
	{:else if visibleProjects.length === 0}
		<p class="mt-10 text-center text-sm text-[oklch(0.65_0.015_55)]">
			{m.video_editor_projects_no_match()}
		</p>
	{:else}
		<ul class="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3" role="list">
			{#each visibleProjects as project (project.id)}
				<li>
					<div
						class={`group relative overflow-hidden rounded-xl border bg-[oklch(0.2_0.01_50)] transition-[border-color,transform] active:scale-[0.995] motion-reduce:transition-none ${selectedIds.has(project.id) ? 'border-[oklch(0.66_0.14_45)]' : 'border-[oklch(0.25_0.015_55)] hover:border-[oklch(0.38_0.025_55)]'}`}
					>
						<button
							type="button"
							class="absolute top-2 left-2 z-10 flex size-11 items-center justify-center rounded-full border border-white/25 bg-black/60 text-white opacity-70 backdrop-blur-sm transition-opacity hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[oklch(0.66_0.14_45)] data-[selected=true]:border-[oklch(0.72_0.15_50)] data-[selected=true]:bg-[oklch(0.58_0.14_45)] data-[selected=true]:opacity-100"
							data-selected={selectedIds.has(project.id)}
							role="checkbox"
							aria-checked={selectedIds.has(project.id)}
							aria-label={selectedIds.has(project.id)
								? m.video_editor_project_deselect({ name: project.name })
								: m.video_editor_project_select({ name: project.name })}
							onclick={(event) => toggleSelection(event, project)}
						>
							{#if selectedIds.has(project.id)}
								<CheckIcon class="size-4" aria-hidden="true" />
							{:else}
								<span class="size-3 rounded-full border border-current" aria-hidden="true"></span>
							{/if}
						</button>
						<button
							type="button"
							class="block w-full text-left focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[oklch(0.66_0.14_45)]"
							onclick={() => onopen(project)}
						>
							<span class="relative block aspect-video overflow-hidden bg-[oklch(0.13_0.008_55)]">
								{#if thumbnailUrls[project.id]}
									<img
										src={thumbnailUrls[project.id]}
										alt={m.video_editor_project_thumbnail_alt({ name: project.name })}
										class="size-full object-contain"
										draggable="false"
									/>
								{:else}
									<span
										class="flex size-full items-center justify-center text-[oklch(0.48_0.015_55)]"
									>
										<PlayIcon class="size-11" aria-hidden="true" />
									</span>
								{/if}
								<span
									class="absolute right-2 bottom-2 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-medium text-white"
								>
									{projectAspectRatio(project)}
								</span>
							</span>
							<span class="block p-4 pr-12">
								<span class="block truncate font-medium">{project.name}</span>
								<span
									class="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-xs text-[oklch(0.68_0.015_55)]"
								>
									<span>{projectResolution(project)}</span>
									<span>{project.metadata.fps} fps</span>
									<span
										>{m.video_editor_project_duration({
											duration: formatDuration(project.duration)
										})}</span
									>
								</span>
								<span class="mt-2 block text-xs text-[oklch(0.58_0.015_55)]">
									{new Date(project.updatedAt).toLocaleDateString()}
								</span>
							</span>
						</button>
						<div class="absolute top-2 right-2 rounded-md bg-black/55 backdrop-blur-sm">
							<DropdownMenu.Root>
								<DropdownMenu.Trigger>
									{#snippet child({ props })}
										<Button
											{...props}
											variant="ghost"
											size="icon-xs"
											disabled={importing ||
												duplicatingId !== null ||
												exportingId !== null ||
												bundleOperation !== null}
											aria-busy={duplicatingId === project.id || exportingId === project.id}
											aria-label={m.video_editor_project_actions({ name: project.name })}
										>
											{#if duplicatingId === project.id || exportingId === project.id}
												<LoaderIcon
													class="size-4 animate-spin motion-reduce:animate-none"
													aria-hidden="true"
												/>
											{:else}
												<MoreIcon class="size-4" aria-hidden="true" />
											{/if}
										</Button>
									{/snippet}
								</DropdownMenu.Trigger>
								<DropdownMenu.Content class="video-editor-theme" align="end">
									<DropdownMenu.Item onclick={() => void onrename(project)}>
										<PencilIcon class="size-4" aria-hidden="true" />
										{m.video_editor_project_rename()}
									</DropdownMenu.Item>
									<DropdownMenu.Item
										disabled={duplicatingId !== null || importing || bundleOperation !== null}
										onclick={() => void onduplicate(project)}
									>
										<CopyIcon class="size-4" aria-hidden="true" />
										{m.video_editor_project_duplicate()}
									</DropdownMenu.Item>
									<DropdownMenu.Item
										disabled={exportingId !== null || bundleOperation !== null}
										onclick={() => void onexportbundle(project)}
									>
										{#if exportingId === project.id && exportingKind === 'bundle'}
											<LoaderIcon
												class="size-4 animate-spin motion-reduce:animate-none"
												aria-hidden="true"
											/>
										{:else}
											<DownloadIcon class="size-4" aria-hidden="true" />
										{/if}
										{m.video_editor_project_export_bundle()}
									</DropdownMenu.Item>
									<DropdownMenu.Item
										disabled={exportingId !== null || bundleOperation !== null}
										onclick={() => void onexportjson(project)}
									>
										{#if exportingId === project.id && exportingKind === 'json'}
											<LoaderIcon
												class="size-4 animate-spin motion-reduce:animate-none"
												aria-hidden="true"
											/>
										{:else}
											<DownloadIcon class="size-4" aria-hidden="true" />
										{/if}
										{m.video_editor_project_export_json()}
									</DropdownMenu.Item>
									<DropdownMenu.Separator />
									<DropdownMenu.Item
										class="text-red-300 focus:text-red-200"
										onclick={() => confirmDelete(project)}
									>
										<TrashIcon class="size-4" aria-hidden="true" />
										{m.video_editor_project_move_to_trash()}
									</DropdownMenu.Item>
								</DropdownMenu.Content>
							</DropdownMenu.Root>
						</div>
					</div>
				</li>
			{/each}
		</ul>
	{/if}

	{#if trashError}
		<InlineNotice tone="error" class="mt-8">{trashError}</InlineNotice>
	{:else if trashedProjects.length > 0}
		<section class="mt-10" aria-labelledby="video-editor-trash-title">
			<div class="flex items-center justify-between gap-3">
				<button
					type="button"
					class="flex min-h-11 items-center gap-2 rounded-md text-sm text-[oklch(0.68_0.015_55)] hover:text-[oklch(0.92_0.005_85)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[oklch(0.66_0.14_45)]"
					aria-expanded={trashOpen}
					aria-controls="video-editor-trash-list"
					onclick={() => (trashOpen = !trashOpen)}
				>
					<ChevronRightIcon
						class={`size-4 transition-transform motion-reduce:transition-none ${trashOpen ? 'rotate-90' : ''}`}
						aria-hidden="true"
					/>
					<TrashIcon class="size-4" aria-hidden="true" />
					<span id="video-editor-trash-title" class="font-medium">
						{m.video_editor_project_trash_title()}
					</span>
					<span class="rounded-full bg-[oklch(0.24_0.012_55)] px-2 py-0.5 text-xs tabular-nums">
						{trashedProjects.length}
					</span>
					{#if !trashOpen}
						<span class="hidden text-xs sm:inline">
							{m.video_editor_project_trash_retention()}
						</span>
					{/if}
				</button>
				{#if trashOpen}
					<Button
						variant="outline"
						size="sm"
						class="text-red-300 hover:text-red-200"
						disabled={emptyingTrash || trashBusyId !== null}
						onclick={() => confirmPurge('all')}
					>
						{#if emptyingTrash}
							<LoaderIcon
								class="size-4 animate-spin motion-reduce:animate-none"
								aria-hidden="true"
							/>
							{m.video_editor_project_emptying_trash()}
						{:else}
							<TrashIcon class="size-4" aria-hidden="true" />
							{m.video_editor_project_empty_trash()}
						{/if}
					</Button>
				{/if}
			</div>

			{#if trashOpen}
				<ul
					id="video-editor-trash-list"
					class="mt-3 divide-y divide-[oklch(0.27_0.014_55)] overflow-hidden rounded-lg border border-[oklch(0.27_0.014_55)]"
					role="list"
				>
					{#each trashedProjects as entry (entry.id)}
						<li
							class="flex flex-col gap-3 bg-[oklch(0.18_0.009_50)] p-3 sm:flex-row sm:items-center"
						>
							<div class="min-w-0 flex-1">
								<p class="truncate text-sm font-medium">{entry.marker.originalName}</p>
								<p class="mt-0.5 text-xs text-[oklch(0.62_0.015_55)]">
									{m.video_editor_project_trash_deleted({
										date: new Date(entry.marker.deletedAt).toLocaleDateString()
									})}
								</p>
							</div>
							<div class="flex gap-2 sm:shrink-0">
								<Button
									variant="ghost"
									size="sm"
									disabled={trashBusyId !== null || emptyingTrash}
									onclick={() => void onrestore(entry.id, entry.marker.originalName)}
								>
									{#if trashBusyId === entry.id}
										<LoaderIcon
											class="size-4 animate-spin motion-reduce:animate-none"
											aria-hidden="true"
										/>
									{:else}
										<RestoreIcon class="size-4" aria-hidden="true" />
									{/if}
									{m.video_editor_project_restore()}
								</Button>
								<Button
									variant="ghost"
									size="sm"
									class="text-red-300 hover:text-red-200"
									disabled={trashBusyId !== null || emptyingTrash}
									onclick={() => confirmPurge(entry)}
								>
									<TrashIcon class="size-4" aria-hidden="true" />
									{m.video_editor_project_delete_forever()}
								</Button>
							</div>
						</li>
					{/each}
				</ul>
			{/if}
		</section>
	{/if}
</div>

<DestructiveConfirmDialog
	bind:open={deleteDialogOpen}
	title={pendingDelete && pendingDelete.length > 1
		? m.video_editor_project_move_selected_to_trash()
		: m.video_editor_project_move_to_trash()}
	description={pendingDelete && pendingDelete.length > 1
		? m.video_editor_project_bulk_delete_body({ count: pendingDelete.length })
		: m.video_editor_project_delete_body({ name: pendingDelete?.[0]?.name ?? '' })}
	confirmLabel={pendingDelete && pendingDelete.length > 1
		? m.video_editor_project_move_selected_to_trash()
		: m.video_editor_project_move_to_trash()}
	onConfirm={async () => {
		if (pendingDelete?.length === 1) {
			await ondelete(pendingDelete[0]!);
			clearSelection();
		} else if (pendingDelete && pendingDelete.length > 1) {
			const failedIds = await ondeletebatch(pendingDelete);
			selectedIds = new Set(failedIds);
			selectionAnchorId = failedIds[0] ?? null;
		}
		pendingDelete = null;
		return { ok: true };
	}}
/>

<DestructiveConfirmDialog
	bind:open={purgeDialogOpen}
	title={pendingPurge === 'all'
		? m.video_editor_project_empty_trash()
		: m.video_editor_project_delete_forever()}
	description={pendingPurge === 'all'
		? m.video_editor_project_empty_trash_body({ count: trashedProjects.length })
		: m.video_editor_project_delete_forever_body({
				name: pendingPurge?.marker.originalName ?? ''
			})}
	confirmLabel={pendingPurge === 'all'
		? m.video_editor_project_empty_trash()
		: m.video_editor_project_delete_forever()}
	onConfirm={async () => {
		if (pendingPurge === 'all') await onemptytrash();
		else if (pendingPurge) await onpurge(pendingPurge);
		pendingPurge = null;
		return { ok: true };
	}}
/>
