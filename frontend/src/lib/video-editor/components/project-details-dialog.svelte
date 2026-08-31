<script lang="ts">
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import { Button } from '$lib/components/ui/button';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Input } from '$lib/components/ui/input';
	import * as Select from '$lib/components/ui/select';
	import { Textarea } from '$lib/components/ui/textarea';
	import { m } from '$lib/paraglide/messages';
	import {
		MAX_PROJECT_HEIGHT,
		MAX_PROJECT_WIDTH,
		MIN_PROJECT_HEIGHT,
		MIN_PROJECT_WIDTH
	} from '$lib/video-editor/project/project-presets';
	import {
		buildProjectDetailsUpdate,
		MAX_PROJECT_DESCRIPTION_LENGTH,
		MAX_PROJECT_NAME_LENGTH,
		PROJECT_DETAILS_FPS_OPTIONS,
		projectDetailsChanged,
		type ProjectDetailsInput,
		type ProjectDetailsUpdate
	} from '$lib/video-editor/project/project-details';
	import type { Project } from '$lib/video-editor/project/types';
	import LoaderIcon from '@lucide/svelte/icons/loader-2';

	let {
		open = $bindable(false),
		project,
		onsave
	}: {
		open?: boolean;
		project: Project | null;
		onsave: (project: Project, update: ProjectDetailsUpdate) => Promise<string | null>;
	} = $props();

	let name = $state('');
	let description = $state('');
	let width = $state('1920');
	let height = $state('1080');
	let fps = $state('30');
	let saving = $state(false);
	let saveError = $state('');
	let initializedProjectId = '';

	$effect(() => {
		if (!open || !project || initializedProjectId === project.id) return;
		name = project.name;
		description = project.description;
		width = String(project.metadata.width);
		height = String(project.metadata.height);
		fps = String(project.metadata.fps);
		saveError = '';
		initializedProjectId = project.id;
	});

	$effect(() => {
		if (!open) initializedProjectId = '';
	});

	const draft = $derived<ProjectDetailsInput>({
		name,
		description,
		width: Number(width),
		height: Number(height),
		fps: Number(fps)
	});
	const update = $derived(project ? buildProjectDetailsUpdate(project, draft) : null);
	const canSave = $derived(Boolean(project && update && projectDetailsChanged(project, update)));

	async function save(): Promise<void> {
		if (!project || !update || !canSave || saving) return;
		saving = true;
		saveError = '';
		try {
			const error = await onsave(project, update);
			if (error) {
				saveError = error;
				return;
			}
			open = false;
		} finally {
			saving = false;
		}
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content
		class="video-editor-theme w-[calc(100%_-_1rem)] max-w-[520px] border-[oklch(0.31_0.018_55)] bg-[oklch(0.16_0.012_50)] text-[var(--video-editor-text)] sm:max-w-[520px]"
	>
		<Dialog.Header>
			<Dialog.Title class="text-base">{m.video_editor_project_edit_title()}</Dialog.Title>
			<Dialog.Description class="text-xs leading-relaxed text-[var(--video-editor-muted)]">
				{m.video_editor_project_edit_description()}
			</Dialog.Description>
		</Dialog.Header>

		<form
			class="mt-4 space-y-4"
			onsubmit={(event) => {
				event.preventDefault();
				void save();
			}}
		>
			<label class="grid gap-1.5 text-xs font-medium">
				<span>{m.video_editor_project_name()}</span>
				<Input bind:value={name} maxlength={MAX_PROJECT_NAME_LENGTH} required />
			</label>

			<label class="grid gap-1.5 text-xs font-medium">
				<span>{m.video_editor_project_description_label()}</span>
				<Textarea
					bind:value={description}
					maxlength={MAX_PROJECT_DESCRIPTION_LENGTH}
					rows={3}
					placeholder={m.video_editor_project_description_placeholder()}
				/>
				<span
					class="text-right text-[10px] font-normal text-[var(--video-editor-muted)] tabular-nums"
				>
					{description.length}/{MAX_PROJECT_DESCRIPTION_LENGTH}
				</span>
			</label>

			<fieldset class="rounded-lg border border-[oklch(0.3_0.018_55)] p-3">
				<legend class="px-1 text-xs font-medium">{m.video_editor_project_canvas()}</legend>
				<div class="grid grid-cols-2 gap-2 sm:grid-cols-[1fr_1fr_8rem]">
					<label class="grid gap-1 text-xs">
						<span>{m.video_editor_project_width()}</span>
						<Input
							type="number"
							bind:value={width}
							min={MIN_PROJECT_WIDTH}
							max={MAX_PROJECT_WIDTH}
							step="1"
						/>
					</label>
					<label class="grid gap-1 text-xs">
						<span>{m.video_editor_project_height()}</span>
						<Input
							type="number"
							bind:value={height}
							min={MIN_PROJECT_HEIGHT}
							max={MAX_PROJECT_HEIGHT}
							step="1"
						/>
					</label>
					<label class="col-span-2 grid gap-1 text-xs sm:col-span-1">
						<span>{m.video_editor_project_frame_rate()}</span>
						<Select.Root type="single" value={fps} onValueChange={(value) => (fps = value)}>
							<Select.Trigger class="w-full" aria-label={m.video_editor_project_frame_rate()}>
								{fps} fps
							</Select.Trigger>
							<Select.Content class="video-editor-theme">
								{#each PROJECT_DETAILS_FPS_OPTIONS as option (option)}
									<Select.Item value={String(option)}>{option} fps</Select.Item>
								{/each}
							</Select.Content>
						</Select.Root>
					</label>
				</div>
				<p class="mt-2 text-[10px] leading-relaxed text-[var(--video-editor-muted)]">
					{m.video_editor_project_edit_timing_hint()}
				</p>
			</fieldset>

			{#if saveError}<InlineNotice tone="error">{saveError}</InlineNotice>{/if}

			<Dialog.Footer>
				<Button
					type="button"
					variant="ghost"
					class="min-h-11"
					disabled={saving}
					onclick={() => (open = false)}
				>
					{m.common_cancel()}
				</Button>
				<Button type="submit" class="min-h-11" disabled={!canSave || saving}>
					{#if saving}<LoaderIcon
							class="size-4 animate-spin motion-reduce:animate-none"
							aria-hidden="true"
						/>{/if}
					{m.video_editor_project_save_changes()}
				</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
