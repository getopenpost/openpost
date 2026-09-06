<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { m } from '$lib/paraglide/messages';
	import { ProtectedIcon, ThemeIcon } from '$lib/themes/icons';
	import type { Project } from '$lib/video-editor/project/types';
	import type { CloudVideoProject } from '$lib/video-editor/cloud/project-repository';

	let {
		projects,
		trashedProjects,
		loading,
		error,
		creating,
		oncreate,
		onopen,
		ontrash,
		onrestore,
		localProjects,
		importingId,
		onimportlocal,
		exportingId,
		onexport,
		offlineProjectIds,
		offlineBusyId,
		ontoggleoffline,
		onrefresh
	}: {
		projects: CloudVideoProject<Project>[];
		trashedProjects: CloudVideoProject<Project>[];
		loading: boolean;
		error: string;
		creating: boolean;
		oncreate: (name: string) => Promise<void>;
		onopen: (project: CloudVideoProject<Project>) => Promise<void>;
		ontrash: (project: CloudVideoProject<Project>) => Promise<void>;
		onrestore: (project: CloudVideoProject<Project>) => Promise<void>;
		localProjects: Project[];
		importingId: string | null;
		onimportlocal: (project: Project) => Promise<void>;
		exportingId: string | null;
		onexport: (project: CloudVideoProject<Project>) => Promise<void>;
		offlineProjectIds: string[];
		offlineBusyId: string | null;
		ontoggleoffline: (project: CloudVideoProject<Project>) => Promise<void>;
		onrefresh: () => Promise<void>;
	} = $props();

	let creatingOpen = $state(false);
	let name = $state('');
	let query = $state('');
	let busyProjectId = $state<string | null>(null);
	const visible = $derived(
		projects.filter((project) =>
			project.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())
		)
	);

	async function create(): Promise<void> {
		await oncreate(name.trim() || m.video_editor_project_untitled());
		name = '';
		creatingOpen = false;
	}

	async function trash(project: CloudVideoProject<Project>): Promise<void> {
		busyProjectId = project.id;
		try {
			await ontrash(project);
		} finally {
			busyProjectId = null;
		}
	}

	async function restore(project: CloudVideoProject<Project>): Promise<void> {
		busyProjectId = project.id;
		try {
			await onrestore(project);
		} finally {
			busyProjectId = null;
		}
	}

	function syncStatus(project: CloudVideoProject<Project>): string {
		if (project.syncStatus === 'needs_attention' && project.attentionReason) {
			return `${m.compose_needs_attention()}: ${project.attentionReason}`;
		}
		return project.syncStatus.replaceAll('_', ' ');
	}
</script>

<section class="w-full max-w-5xl" aria-labelledby="cloud-video-projects-title">
	<div class="flex flex-wrap items-start justify-between gap-3">
		<div>
			<h1 id="cloud-video-projects-title" class="text-base font-semibold">
				{m.video_editor_cloud_projects()}
			</h1>
			<p class="mt-1 text-sm text-[var(--video-editor-muted)]">
				{m.video_editor_cloud_projects_description()}
			</p>
		</div>
		<div class="flex gap-2">
			<Button variant="outline" size="sm" onclick={() => void onrefresh()} disabled={loading}>
				<ThemeIcon role="refresh" class="size-4" />
				{m.common_retry()}
			</Button>
			<Button size="sm" onclick={() => (creatingOpen = !creatingOpen)} disabled={creating}>
				<ThemeIcon role="add" class="size-4" />
				{m.video_editor_project_new()}
			</Button>
		</div>
	</div>

	{#if creatingOpen}
		<form
			class="mt-4 flex gap-2"
			onsubmit={(event) => {
				event.preventDefault();
				void create();
			}}
		>
			<Input
				bind:value={name}
				maxlength={100}
				aria-label={m.video_editor_project_name()}
				placeholder={m.video_editor_project_untitled()}
			/>
			<Button type="submit" disabled={creating}>
				{#if creating}<ProtectedIcon
						icon="loading"
						class="size-4 animate-spin motion-reduce:animate-none"
					/>{/if}
				{m.video_editor_project_create()}
			</Button>
		</form>
	{/if}

	<div class="mt-4">
		<Input
			bind:value={query}
			aria-label={m.video_editor_project_search()}
			placeholder={m.video_editor_project_search()}
		/>
	</div>

	{#if loading}
		<p class="mt-8 text-center text-sm text-[var(--video-editor-muted)]" role="status">
			{m.video_editor_cloud_projects_loading()}
		</p>
	{:else if error}
		<p class="mt-8 text-center text-sm text-destructive" role="alert">
			{error}
		</p>
	{:else if visible.length === 0}
		<p class="mt-8 text-center text-sm text-[var(--video-editor-muted)]">
			{m.video_editor_cloud_empty()}
		</p>
	{:else}
		<div class="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
			{#each visible as project (project.id)}
				<article
					class="rounded-xl border border-[var(--video-editor-border)] bg-[var(--video-editor-panel)] p-4"
				>
					<h2 class="truncate text-sm font-semibold" title={project.name}>
						{project.name}
					</h2>
					<p class="mt-1 text-xs text-[var(--video-editor-muted)] first-letter:uppercase">
						{syncStatus(project)}
					</p>
					{#if offlineProjectIds.includes(project.id)}
						<p class="mt-1 text-xs text-[var(--video-editor-muted)]">
							{m.video_editor_available_offline()}
						</p>
					{/if}
					<div class="mt-4 flex flex-wrap justify-between gap-2">
						<Button size="sm" onclick={() => void onopen(project)}
							>{m.video_editor_project_open()}</Button
						>
						<Button
							variant="ghost"
							size="sm"
							disabled={offlineBusyId !== null}
							onclick={() => void ontoggleoffline(project)}
						>
							{#if offlineBusyId === project.id}
								<ProtectedIcon
									icon="loading"
									class="size-4 animate-spin motion-reduce:animate-none"
								/>
							{:else}
								<ThemeIcon
									role={offlineProjectIds.includes(project.id) ? 'delete' : 'download'}
									class="size-4"
								/>
							{/if}
							{offlineProjectIds.includes(project.id)
								? m.video_editor_remove_offline()
								: m.video_editor_keep_offline()}
						</Button>
						<Button
							variant="ghost"
							size="sm"
							disabled={exportingId !== null}
							onclick={() => void onexport(project)}
						>
							{#if exportingId === project.id}
								<ProtectedIcon
									icon="loading"
									class="size-4 animate-spin motion-reduce:animate-none"
								/>
							{:else}
								<ThemeIcon role="download" class="size-4" />
							{/if}
							{m.video_editor_project_export_bundle()}
						</Button>
						<Button
							variant="ghost"
							size="sm"
							disabled={busyProjectId === project.id}
							onclick={() => void trash(project)}
						>
							<ThemeIcon role="delete" class="size-4" />
							{m.common_delete()}
						</Button>
					</div>
				</article>
			{/each}
		</div>
	{/if}

	{#if localProjects.length > 0}
		<section
			class="mt-8 border-t border-[var(--video-editor-border)] pt-4"
			aria-labelledby="cloud-video-local-import-title"
		>
			<h2 id="cloud-video-local-import-title" class="text-sm font-semibold">
				{m.video_editor_cloud_title()}
			</h2>
			<p class="mt-1 text-xs text-[var(--video-editor-muted)]">
				{m.video_editor_cloud_description()}
			</p>
			<ul class="mt-3 grid gap-2 sm:grid-cols-2" role="list">
				{#each localProjects as project (project.id)}
					<li
						class="flex items-center justify-between gap-3 rounded-lg border border-[var(--video-editor-border)] bg-[var(--video-editor-panel)] p-3"
					>
						<span class="min-w-0 truncate text-sm" title={project.name}>{project.name}</span>
						<Button
							variant="outline"
							size="xs"
							disabled={importingId !== null}
							onclick={() => void onimportlocal(project)}
						>
							{#if importingId === project.id}
								<ProtectedIcon
									icon="loading"
									class="size-4 animate-spin motion-reduce:animate-none"
								/>
							{/if}
							{m.video_editor_cloud_start()}
						</Button>
					</li>
				{/each}
			</ul>
		</section>
	{/if}

	{#if trashedProjects.length > 0}
		<section
			class="mt-8 border-t border-[var(--video-editor-border)] pt-4"
			aria-labelledby="cloud-video-trash-title"
		>
			<div class="flex items-center justify-between gap-3">
				<h2 id="cloud-video-trash-title" class="text-sm font-semibold">
					{m.video_editor_project_trash_title()}
				</h2>
				<span class="text-xs text-[var(--video-editor-muted)]"
					>{m.video_editor_project_trash_retention()}</span
				>
			</div>
			<div class="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
				{#each trashedProjects as project (project.id)}
					<article
						class="flex items-center justify-between gap-3 rounded-lg border border-[var(--video-editor-border)] bg-[var(--video-editor-panel)] p-3"
					>
						<span class="truncate text-sm" title={project.name}>{project.name}</span>
						<Button
							variant="outline"
							size="xs"
							disabled={busyProjectId === project.id}
							onclick={() => void restore(project)}>{m.video_editor_project_restore()}</Button
						>
					</article>
				{/each}
			</div>
		</section>
	{/if}
</section>
