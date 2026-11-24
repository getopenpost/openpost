<!--
	Composition timeline footer: live status, selection actions and the frame
	readout.
-->
<script lang="ts">
	import { m } from '$lib/paraglide/messages';
	import { Button } from '$lib/components/ui/button';
	import { ThemeIcon, ProtectedIcon } from '$lib/themes/icons';
	import { timelineStore } from '$lib/video-editor/timeline/stores/timeline-store.svelte';

	let {
		status,
		selectionCount,
		canPaste,
		canGroup,
		durationFrames,
		oncopy,
		onpaste,
		onduplicate,
		ongroup,
		ondelete
	}: {
		status: string;
		selectionCount: number;
		canPaste: boolean;
		canGroup: boolean;
		durationFrames: number;
		oncopy: () => void;
		onpaste: () => void;
		onduplicate: () => void;
		ongroup: () => void;
		ondelete: () => void;
	} = $props();
</script>

<div class="composition-footer">
	<span class="footer-status" aria-live="polite" data-testid="composition-status">{status}</span>
	<div class="footer-actions">
		<Button
			size="sm"
			variant="ghost"
			aria-label={m.video_editor_composition_timeline_copy()}
			disabled={selectionCount === 0}
			onclick={oncopy}
			data-testid="composition-copy"
			><ThemeIcon role="copy" class="size-3" />{m.video_editor_composition_timeline_copy()}</Button
		>
		<Button
			size="sm"
			variant="ghost"
			aria-label={m.video_editor_composition_timeline_paste()}
			disabled={!canPaste}
			onclick={onpaste}
			data-testid="composition-paste"
			><ThemeIcon role="copy" class="size-3" />{m.video_editor_composition_timeline_paste()}</Button
		>
		<Button
			size="sm"
			variant="ghost"
			aria-label={m.video_editor_composition_timeline_duplicate()}
			disabled={selectionCount === 0}
			onclick={onduplicate}
			data-testid="composition-duplicate">{m.video_editor_composition_timeline_duplicate()}</Button
		>
		<Button
			size="sm"
			variant="ghost"
			aria-label={m.video_editor_composition_timeline_group()}
			disabled={!canGroup}
			onclick={ongroup}
			data-testid="composition-group"
			><ProtectedIcon
				icon="editor-group"
				class="size-3"
			/>{m.video_editor_composition_timeline_group()}</Button
		>
		<Button
			size="sm"
			variant="ghost"
			aria-label={m.video_editor_composition_timeline_delete()}
			disabled={selectionCount === 0}
			onclick={ondelete}
			data-testid="composition-delete"
			><ThemeIcon
				role="delete"
				class="size-3"
			/>{m.video_editor_composition_timeline_delete()}</Button
		>
		<span class="frame-readout" data-testid="composition-frame-readout"
			>{m.video_editor_composition_timeline_frame({
				frame: String(timelineStore.currentFrame),
				total: String(durationFrames)
			})}</span
		>
	</div>
</div>

<style>
	.composition-footer {
		display: flex;
		box-sizing: border-box;
		max-width: 100%;
		min-width: 0;
		align-items: center;
		justify-content: space-between;
		gap: 0.6rem;
		padding: 0.45rem 0.6rem;
		border-top: 1px solid var(--video-editor-border);
		background: var(--video-editor-panel);
		flex-wrap: wrap;
	}
	.footer-status {
		font-size: 0.62rem;
		color: var(--video-editor-muted);
		min-height: 18px;
	}
	.footer-actions {
		display: flex;
		box-sizing: border-box;
		max-width: 100%;
		min-width: 0;
		align-items: center;
		gap: 0.35rem;
		flex-wrap: wrap;
	}
	.frame-readout {
		font-size: 0.62rem;
		font-variant-numeric: tabular-nums;
		color: var(--video-editor-muted);
	}
	@media (max-width: 480px) {
		.composition-footer,
		.footer-actions {
			align-items: stretch;
			width: 100%;
		}
	}
</style>
