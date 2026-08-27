<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import * as Dialog from '$lib/components/ui/dialog';
	import * as Tabs from '$lib/components/ui/tabs';
	import { m } from '$lib/paraglide/messages';
	import { renderQueueRunner } from '../export/render-queue-runner';
	import { renderQueueStore, type RenderQueueJob } from '../export/render-queue-store';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import ChevronUpIcon from '@lucide/svelte/icons/chevron-up';
	import ListVideoIcon from '@lucide/svelte/icons/list-video';
	import PauseIcon from '@lucide/svelte/icons/pause';
	import PlayIcon from '@lucide/svelte/icons/play';
	import RotateIcon from '@lucide/svelte/icons/rotate-ccw';
	import TrashIcon from '@lucide/svelte/icons/trash-2';
	import XIcon from '@lucide/svelte/icons/x';
	import SavedExportsPanel from './saved-exports-panel.svelte';
	import RenderProgress from './render-progress.svelte';
	import type { RenderExportProgress } from '../media/render-export';

	let { projectId }: { projectId: string } = $props();
	let open = $state(false);
	let activeTab = $state<'queue' | 'saved'>('queue');
	let wasOpen = false;
	const activeCount = $derived(
		$renderQueueStore.jobs.filter((job) => job.status === 'queued' || job.status === 'rendering')
			.length
	);
	const completedVersion = $derived(
		Math.max(
			0,
			...$renderQueueStore.jobs
				.filter((job) => job.status === 'completed')
				.map((job) => job.finishedAt ?? 0)
		)
	);

	$effect(() => {
		if (open && !wasOpen) activeTab = activeCount > 0 ? 'queue' : 'saved';
		wasOpen = open;
	});

	function statusLabel(job: RenderQueueJob): string {
		switch (job.status) {
			case 'queued':
				return m.video_editor_queue_status_queued();
			case 'rendering':
				return m.video_editor_queue_status_rendering();
			case 'completed':
				return m.video_editor_queue_status_completed();
			case 'failed':
				return m.video_editor_queue_status_failed();
			case 'cancelled':
				return m.video_editor_queue_status_cancelled();
		}
	}

	function formatDetails(job: RenderQueueJob): string {
		const duration =
			(job.settings.range.endFrame - job.settings.range.startFrame) / job.snapshot.fps;
		let label = job.settings.format.toUpperCase();
		if (job.settings.format === 'png-sequence') label = 'PNG SEQUENCE';
		if (job.settings.format === 'jpeg-sequence') label = 'JPEG SEQUENCE';
		if (job.settings.format === 'webp-sequence') label = 'WEBP SEQUENCE';
		const output = ['mp3', 'aac', 'wav'].includes(job.settings.format)
			? label
			: `${label} · ${job.settings.width}×${job.settings.height}`;
		return `${output} · ${duration.toFixed(1)}s`;
	}

	function jobProgress(job: RenderQueueJob): RenderExportProgress {
		return {
			phase: job.phase ?? 'preparing',
			progress: job.progress,
			framesDone: job.framesDone ?? 0,
			totalFrames:
				job.totalFrames ?? Math.max(0, job.settings.range.endFrame - job.settings.range.startFrame)
		};
	}
</script>

<Dialog.Root bind:open>
	<Button size="sm" variant="ghost" class="mt-1 w-full" onclick={() => (open = true)}>
		<ListVideoIcon class="size-3.5" aria-hidden="true" />
		{m.video_editor_exports_title()}{activeCount > 0 ? ` (${activeCount})` : ''}
	</Button>
	<Dialog.Content
		class="video-editor-theme flex max-h-[calc(100dvh-2rem)] flex-col gap-0 border border-[var(--video-editor-border)] bg-[var(--video-editor-panel)] text-[var(--video-editor-text)] sm:max-w-lg"
	>
		<Dialog.Header class="pr-8">
			<Dialog.Title class="text-base text-[var(--video-editor-text)]">
				{m.video_editor_exports_title()}
			</Dialog.Title>
			<Dialog.Description class="text-[var(--video-editor-muted)]">
				{m.video_editor_exports_description()}
			</Dialog.Description>
		</Dialog.Header>
		<Tabs.Root bind:value={activeTab} class="mt-3 min-h-0 flex-1">
			<Tabs.List class="grid w-full grid-cols-2">
				<Tabs.Trigger value="queue">
					{m.video_editor_queue_tab_queue()}
					{#if activeCount > 0}
						<span
							class="rounded-full bg-[var(--video-editor-focus)] px-1.5 text-[10px] leading-tight font-medium text-white tabular-nums"
						>
							{activeCount}
						</span>
					{/if}
				</Tabs.Trigger>
				<Tabs.Trigger value="saved">{m.video_editor_queue_tab_saved()}</Tabs.Trigger>
			</Tabs.List>
			<Tabs.Content value="queue" class="mt-3 flex min-h-0 flex-col">
				<div class="flex flex-wrap items-center gap-2">
					<Button
						size="sm"
						variant="outline"
						disabled={activeCount === 0}
						onclick={() => renderQueueStore.setPaused(!$renderQueueStore.isPaused)}
					>
						{#if $renderQueueStore.isPaused}<PlayIcon
							/>{m.video_editor_queue_resume()}{:else}<PauseIcon
							/>{m.video_editor_queue_pause()}{/if}
					</Button>
					<Button
						size="sm"
						variant="ghost"
						disabled={!$renderQueueStore.jobs.some(
							(job) =>
								job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled'
						)}
						onclick={() => renderQueueStore.clearFinished()}
						>{m.video_editor_queue_clear_finished()}</Button
					>
					<Button
						size="sm"
						variant="destructive"
						disabled={$renderQueueStore.jobs.length === 0}
						onclick={() => renderQueueRunner.clearAll()}>{m.video_editor_queue_clear_all()}</Button
					>
				</div>
				{#if $renderQueueStore.isPaused && activeCount > 0}<p class="mt-2 text-xs text-amber-200">
						{m.video_editor_queue_paused()}
					</p>{/if}
				<div class="mt-3 min-h-0 flex-1 overflow-y-auto pr-1">
					{#if $renderQueueStore.jobs.length === 0}<p
							class="py-10 text-center text-sm text-[var(--video-editor-muted)]"
						>
							{m.video_editor_queue_empty()}
						</p>{:else}
						<ul class="space-y-2">
							{#each $renderQueueStore.jobs as job (job.id)}<li
									class="rounded-lg border border-[var(--video-editor-border)] bg-[var(--video-editor-control)] p-3"
								>
									<div class="flex items-start gap-2">
										<div class="min-w-0 flex-1">
											<p class="text-sm leading-tight font-medium break-words">{job.name}</p>
											<p class="text-[11px] text-[var(--video-editor-muted)]">
												{formatDetails(job)} · {statusLabel(job)}
											</p>
											{#if job.status === 'rendering'}
												<RenderProgress
													progress={jobProgress(job)}
													startedAt={job.startedAt}
													class="mt-2"
												/>
											{/if}
											{#if job.error}<p class="mt-1 text-xs text-red-200">{job.error}</p>{/if}
											{#if job.savedPath}<p class="mt-1 truncate text-xs text-emerald-200">
													{job.savedPath}
												</p>{/if}
										</div>
										<div class="flex shrink-0 gap-0.5">
											{#if job.status === 'queued'}<Button
													variant="ghost"
													size="icon-xs"
													aria-label={m.video_editor_queue_move_up()}
													onclick={() => renderQueueStore.move(job.id, -1)}
													><ChevronUpIcon /></Button
												><Button
													variant="ghost"
													size="icon-xs"
													aria-label={m.video_editor_queue_move_down()}
													onclick={() => renderQueueStore.move(job.id, 1)}
													><ChevronDownIcon /></Button
												>{/if}
											{#if job.status === 'failed' || job.status === 'cancelled'}<Button
													variant="ghost"
													size="icon-xs"
													aria-label={m.video_editor_queue_retry()}
													onclick={() => renderQueueStore.retry(job.id)}><RotateIcon /></Button
												>{/if}
											{#if job.status === 'queued' || job.status === 'rendering'}<Button
													variant="ghost"
													size="icon-xs"
													aria-label={m.video_editor_queue_cancel()}
													onclick={() => renderQueueRunner.cancel(job.id)}><XIcon /></Button
												>{:else}<Button
													variant="ghost"
													size="icon-xs"
													aria-label={m.video_editor_queue_remove()}
													onclick={() => renderQueueStore.remove(job.id)}><TrashIcon /></Button
												>{/if}
										</div>
									</div>
								</li>{/each}
						</ul>
					{/if}
				</div>
			</Tabs.Content>
			<Tabs.Content value="saved" class="mt-3 min-h-0">
				{#if open && activeTab === 'saved'}
					<SavedExportsPanel {projectId} refreshVersion={completedVersion} />
				{/if}
			</Tabs.Content>
		</Tabs.Root>
	</Dialog.Content>
</Dialog.Root>
