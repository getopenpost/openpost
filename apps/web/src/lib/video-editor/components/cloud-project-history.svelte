<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolveAppPath } from '$lib/app-path';
	import { Button } from '$lib/components/ui/button';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Input } from '$lib/components/ui/input';
	import { m } from '$lib/paraglide/messages';
	import {
		CloudVideoProjectRepository,
		type CloudVideoProjectConflict,
		type CloudVideoProjectRevision
	} from '$lib/video-editor/cloud/project-repository';
	import type { Project } from '$lib/video-editor/project/types';

	let {
		open = $bindable(false),
		projectId,
		workspaceId,
		onreload
	}: {
		open?: boolean;
		projectId: string;
		workspaceId: string;
		onreload: () => Promise<void>;
	} = $props();

	let revisions = $state<CloudVideoProjectRevision<Project>[]>([]);
	let conflicts = $state<CloudVideoProjectConflict<Project>[]>([]);
	let checkpointName = $state('');
	let loading = $state(false);
	let working = $state(false);
	let error = $state('');

	$effect(() => {
		if (!open || !projectId || !workspaceId) return;
		void load();
	});

	function repository(): CloudVideoProjectRepository<Project> {
		return new CloudVideoProjectRepository<Project>(workspaceId);
	}

	async function load(): Promise<void> {
		loading = true;
		error = '';
		try {
			[revisions, conflicts] = await Promise.all([
				repository().listRevisions(projectId),
				repository().listConflicts(projectId)
			]);
		} catch {
			error = m.video_editor_history_failed();
		} finally {
			loading = false;
		}
	}

	async function createCheckpoint(): Promise<void> {
		const name = checkpointName.trim();
		if (!name || working) return;
		working = true;
		error = '';
		try {
			await repository().createCheckpoint(projectId, name);
			checkpointName = '';
			await load();
		} catch {
			error = m.video_editor_checkpoint_failed();
		} finally {
			working = false;
		}
	}

	async function restoreRevision(revision: number): Promise<void> {
		if (working) return;
		working = true;
		error = '';
		try {
			await repository().restoreRevision(projectId, revision);
			await onreload();
			await load();
		} catch {
			error = m.video_editor_restore_failed();
		} finally {
			working = false;
		}
	}

	async function deleteCheckpoint(checkpointId: string): Promise<void> {
		if (working) return;
		working = true;
		error = '';
		try {
			await repository().deleteCheckpoint(projectId, checkpointId);
			await load();
		} catch {
			error = m.video_editor_checkpoint_failed();
		} finally {
			working = false;
		}
	}

	async function keepCurrent(conflictId: string): Promise<void> {
		if (working) return;
		working = true;
		error = '';
		try {
			await repository().resolveConflict(projectId, conflictId, 'keep_current');
			await onreload();
			await load();
		} catch {
			error = m.video_editor_restore_failed();
		} finally {
			working = false;
		}
	}

	async function useConflict(conflictId: string): Promise<void> {
		if (working) return;
		working = true;
		error = '';
		try {
			await repository().resolveConflict(projectId, conflictId, 'use_conflict');
			await onreload();
			await load();
		} catch {
			error = m.video_editor_restore_failed();
		} finally {
			working = false;
		}
	}

	async function saveConflictCopy(conflict: CloudVideoProjectConflict<Project>): Promise<void> {
		if (working) return;
		working = true;
		error = '';
		try {
			const copyName = m.video_editor_project_copy_name({ name: conflict.document.name });
			const copy = await repository().create(copyName, {
				...conflict.document,
				id: crypto.randomUUID(),
				name: copyName,
				createdAt: Date.now(),
				updatedAt: Date.now()
			});
			await repository().resolveConflict(projectId, conflict.id, 'keep_current');
			await goto(resolveAppPath(`/video-editor/${copy.id}?storage=cloud`));
		} catch {
			error = m.video_editor_restore_failed();
		} finally {
			working = false;
		}
	}

	function revisionLabel(revision: CloudVideoProjectRevision<Project>): string {
		return (
			revision.checkpointNames[0] ??
			m.video_editor_history_autosave({ revision: String(revision.revision) })
		);
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="video-editor-theme max-h-[min(44rem,90dvh)] max-w-2xl overflow-y-auto">
		<Dialog.Header>
			<Dialog.Title>{m.video_editor_history()}</Dialog.Title>
			<Dialog.Description>{m.video_editor_history_description()}</Dialog.Description>
		</Dialog.Header>

		<div class="space-y-5 py-2">
			<div class="flex flex-col gap-2 sm:flex-row">
				<Input
					bind:value={checkpointName}
					placeholder={m.video_editor_checkpoint_placeholder()}
					aria-label={m.video_editor_checkpoint_name()}
					onkeydown={(event) => {
						if (event.key === 'Enter') void createCheckpoint();
					}}
				/>
				<Button
					disabled={working || !checkpointName.trim()}
					onclick={() => void createCheckpoint()}
				>
					{m.video_editor_checkpoint_create()}
				</Button>
			</div>

			{#if error}
				<p role="alert" class="text-sm text-destructive">{error}</p>
			{/if}

			{#if conflicts.length > 0}
				<section class="space-y-2" aria-labelledby="video-project-conflicts-heading">
					<h3 id="video-project-conflicts-heading" class="text-sm font-semibold">
						{m.video_editor_conflict_title()}
					</h3>
					<p class="text-xs text-muted-foreground">{m.video_editor_conflict_preserved()}</p>
					{#each conflicts as conflict (conflict.id)}
						<div class="rounded-lg border p-3">
							<p class="text-sm font-medium">{conflict.name}</p>
							<p class="mt-1 text-xs text-muted-foreground">
								{new Date(conflict.createdAt).toLocaleString()}
							</p>
							<div class="mt-3 flex flex-wrap gap-2">
								<Button size="sm" onclick={() => void useConflict(conflict.id)} disabled={working}>
									{m.video_editor_restore()}
								</Button>
								<Button
									size="sm"
									variant="outline"
									onclick={() => void saveConflictCopy(conflict)}
									disabled={working}
								>
									{m.video_editor_conflict_save_copy()}
								</Button>
								<Button
									size="sm"
									variant="ghost"
									onclick={() => void keepCurrent(conflict.id)}
									disabled={working}
								>
									{m.video_editor_conflict_reload()}
								</Button>
							</div>
						</div>
					{/each}
				</section>
			{/if}

			<section class="space-y-2" aria-labelledby="video-project-history-heading">
				<h3 id="video-project-history-heading" class="text-sm font-semibold">
					{m.video_editor_history_cloud()}
				</h3>
				{#if loading}
					<p class="text-sm text-muted-foreground">{m.common_loading()}</p>
				{:else if revisions.length === 0}
					<p class="text-sm text-muted-foreground">{m.video_editor_history_empty()}</p>
				{:else}
					<ul class="divide-y rounded-lg border">
						{#each revisions as revision (revision.revision)}
							<li class="flex items-center justify-between gap-4 p-3">
								<div class="min-w-0">
									<p class="truncate text-sm font-medium">{revisionLabel(revision)}</p>
									<p class="text-xs text-muted-foreground">
										{new Date(revision.createdAt).toLocaleString()}
									</p>
								</div>
								<div class="flex flex-wrap justify-end gap-1">
									{#each revision.checkpoints as checkpoint (checkpoint.id)}
										<Button
											size="sm"
											variant="ghost"
											disabled={working}
											onclick={() => void deleteCheckpoint(checkpoint.id)}
										>
											{m.common_delete()}
											{checkpoint.name}
										</Button>
									{/each}
									<Button
										size="sm"
										variant="ghost"
										disabled={working || revision.revision === revisions[0]?.revision}
										onclick={() => void restoreRevision(revision.revision)}
									>
										{m.video_editor_restore()}
									</Button>
								</div>
							</li>
						{/each}
					</ul>
				{/if}
			</section>
		</div>

		<Dialog.Footer>
			<Button variant="outline" onclick={() => (open = false)}>{m.common_close()}</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
