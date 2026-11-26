<!--
	Lightweight dialog that collects a name, frame rate and duration for a new
	motion composition. The owner creates the composition from the values.
-->
<script lang="ts">
	import { untrack } from 'svelte';
	import { m } from '$lib/paraglide/messages';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';

	let {
		fps: initialFps,
		durationInFrames: initialDuration,
		testIdSuffix = '',
		oncreate,
		onclose
	}: {
		fps: number;
		durationInFrames: number;
		/** Distinguishes the empty-state dialog from the timeline dialog in tests. */
		testIdSuffix?: string;
		oncreate: (values: { name: string; fps: number; durationInFrames: number }) => void;
		onclose: () => void;
	} = $props();

	let name = $state('');
	// The dialog mounts per open, so the opening defaults seed its fields once.
	let fps = $state(untrack(() => initialFps));
	let durationInFrames = $state(untrack(() => initialDuration));
</script>

<div class="dialog-backdrop" role="presentation" onclick={onclose}></div>
<div
	class="dialog"
	role="dialog"
	aria-modal="true"
	aria-label={m.video_editor_motion_new_composition()}
	data-testid={`new-composition-dialog${testIdSuffix}`}
>
	<h3>{m.video_editor_motion_new_composition()}</h3>
	<label
		>{m.video_editor_composition_timeline_name()}<Input
			value={name}
			oninput={(e) => (name = (e.currentTarget as HTMLInputElement).value)}
			data-testid={`new-composition-name${testIdSuffix}`}
		/></label
	>
	<label
		>{m.video_editor_composition_timeline_fps()}<Input
			type="number"
			min="1"
			max="120"
			value={fps}
			oninput={(e) => (fps = Number((e.currentTarget as HTMLInputElement).value))}
			data-testid={`new-composition-fps${testIdSuffix}`}
		/></label
	>
	<label
		>{m.video_editor_composition_timeline_duration()}<Input
			type="number"
			min="1"
			value={durationInFrames}
			oninput={(e) => (durationInFrames = Number((e.currentTarget as HTMLInputElement).value))}
			data-testid={`new-composition-duration${testIdSuffix}`}
		/></label
	>
	<div class="dialog-actions">
		<Button variant="ghost" onclick={onclose} data-testid={`new-composition-cancel${testIdSuffix}`}
			>{m.video_editor_composition_timeline_cancel()}</Button
		>
		<Button
			onclick={() => oncreate({ name, fps, durationInFrames })}
			data-testid={`new-composition-create${testIdSuffix}`}
			>{m.video_editor_composition_timeline_create()}</Button
		>
	</div>
</div>

<style>
	.dialog-backdrop {
		position: fixed;
		inset: 0;
		background: oklch(0 0 0 / 0.5);
		z-index: 40;
	}
	.dialog {
		position: fixed;
		left: 50%;
		top: 50%;
		transform: translate(-50%, -50%);
		background: var(--video-editor-panel);
		border: 1px solid var(--video-editor-border);
		border-radius: 0.5rem;
		padding: 1rem;
		z-index: 50;
		box-sizing: border-box;
		width: min(320px, calc(100vw - 2rem));
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		color: var(--video-editor-text);
	}
	.dialog h3 {
		margin: 0;
		font-size: 0.86rem;
		font-weight: 650;
	}
	.dialog label {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		font-size: 0.72rem;
	}
	.dialog :global(input) {
		height: 32px;
		border-radius: 0.32rem;
		border: 1px solid var(--video-editor-border);
		background: var(--video-editor-control);
		color: inherit;
		padding: 0 0.5rem;
	}
	.dialog :global(input:focus-visible) {
		outline: 2px solid var(--video-editor-focus);
		outline-offset: 2px;
	}
	.dialog-actions {
		display: flex;
		justify-content: flex-end;
		gap: 0.4rem;
		margin-top: 0.4rem;
	}
</style>
