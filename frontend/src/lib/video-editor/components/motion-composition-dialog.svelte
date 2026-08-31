<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Input } from '$lib/components/ui/input';
	import { m } from '$lib/paraglide/messages';
	import type { CreateCompositeCompositionOptions } from '$lib/video-editor/sequences/sequence-actions';

	let {
		open = $bindable(false),
		defaultWidth,
		defaultHeight,
		defaultFps,
		defaultName,
		oncreate
	}: {
		open?: boolean;
		defaultWidth: number;
		defaultHeight: number;
		defaultFps: number;
		defaultName: string;
		oncreate: (options: CreateCompositeCompositionOptions) => void;
	} = $props();

	let name = $state('');
	let width = $state(1920);
	let height = $state(1080);
	let fps = $state(30);
	let durationSeconds = $state(10);
	let initializedForOpen = $state(false);

	$effect(() => {
		if (!open) {
			initializedForOpen = false;
			return;
		}
		if (initializedForOpen) return;
		name = defaultName;
		width = defaultWidth;
		height = defaultHeight;
		fps = defaultFps;
		durationSeconds = 10;
		initializedForOpen = true;
	});

	function submit(event: SubmitEvent): void {
		event.preventDefault();
		const normalizedFps = Math.round(Math.min(120, Math.max(1, fps)));
		oncreate({
			name,
			width,
			height,
			fps: normalizedFps,
			durationInFrames: Math.max(1, Math.round(normalizedFps * durationSeconds))
		});
		open = false;
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content
		class="video-editor-theme w-[calc(100%_-_1rem)] max-w-md border-[oklch(0.31_0.018_55)] bg-[oklch(0.16_0.012_50)] text-[var(--video-editor-text)]"
	>
		<form onsubmit={submit}>
			<Dialog.Header>
				<Dialog.Title>{m.video_editor_motion_new_composition()}</Dialog.Title>
				<Dialog.Description class="text-xs text-[var(--video-editor-muted)]">
					{m.video_editor_motion_new_composition_description()}
				</Dialog.Description>
			</Dialog.Header>

			<div class="mt-4 grid gap-4">
				<label class="grid gap-1.5 text-xs font-medium" for="motion-composition-name">
					{m.video_editor_composition_timeline_name()}
					<Input id="motion-composition-name" bind:value={name} autofocus />
				</label>
				<div class="grid grid-cols-2 gap-3">
					<label class="grid gap-1.5 text-xs font-medium" for="motion-composition-width">
						{m.video_editor_project_width()}
						<Input
							id="motion-composition-width"
							type="number"
							min="1"
							max="7680"
							bind:value={width}
						/>
					</label>
					<label class="grid gap-1.5 text-xs font-medium" for="motion-composition-height">
						{m.video_editor_project_height()}
						<Input
							id="motion-composition-height"
							type="number"
							min="1"
							max="4320"
							bind:value={height}
						/>
					</label>
				</div>
				<div class="grid grid-cols-2 gap-3">
					<label class="grid gap-1.5 text-xs font-medium" for="motion-composition-fps">
						{m.video_editor_project_frame_rate()}
						<Input id="motion-composition-fps" type="number" min="1" max="120" bind:value={fps} />
					</label>
					<label class="grid gap-1.5 text-xs font-medium" for="motion-composition-duration">
						{m.video_editor_overlay_duration()}
						<Input
							id="motion-composition-duration"
							type="number"
							min="0.1"
							max="3600"
							step="0.1"
							bind:value={durationSeconds}
						/>
					</label>
				</div>
			</div>

			<Dialog.Footer class="mt-5">
				<Button type="button" variant="ghost" onclick={() => (open = false)}>
					{m.common_cancel()}
				</Button>
				<Button type="submit">{m.video_editor_composition_timeline_create()}</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
