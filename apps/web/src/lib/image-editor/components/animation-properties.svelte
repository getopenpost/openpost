<script lang="ts">
	import { imageEditorErrorMessage } from '$lib/image-editor/animation-error-message';
	import { onDestroy, untrack } from 'svelte';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import { m } from '$lib/paraglide/messages';
	import { getAuthenticatedMediaURL } from '$lib/media-url';
	import { useImageEditor } from '../editor.svelte';
	import { readImageEditorGif } from '../gif-client';
	import {
		imageEditorAnimationDuration,
		imageEditorAnimationFrame,
		imageEditorPageAnimations,
		validImageEditorAnimation,
		IMAGE_EDITOR_ANIMATION_LIMITS
	} from '../animation';
	import type { ImageEditorLayer, ImageEditorAnimation } from '../types';
	let { layer }: { layer: ImageEditorLayer } = $props();
	const editor = useImageEditor();
	let animation = $derived(layer.image?.animation);
	let disabled = $derived(!editor.canEdit || editor.isLayerLocked(layer.id));
	let selected = $derived(
		animation
			? Math.max(
					0,
					Math.min(
						animation.frames.length - 1,
						editor.animationFrameOverrides[layer.id] ??
							imageEditorAnimationFrame(animation, editor.animationTimeMs)
					)
				)
			: 0
	);
	let playing = $state(false);
	let failure = $state('');
	let loading = $state(false);
	let thumbnails = $state.raw<string[]>([]);
	let request: AbortController | undefined;
	const pageID = editor.activePageID;
	// The keyed layer can disappear before this instance is destroyed.
	const instanceLayerID = untrack(() => layer.id);
	function select(index: number) {
		playing = false;
		editor.animationFrameOverrides = { ...editor.animationFrameOverrides, [layer.id]: index };
	}
	function update(next: ImageEditorAnimation) {
		if (!layer.image || disabled) return;
		if (!validImageEditorAnimation(next)) {
			failure = m.image_editor_animation_limit();
			return;
		}
		failure = '';
		playing = false;
		editor.updateLayer(layer.id, { image: { ...layer.image, animation: next } });
		select(Math.min(selected, next.frames.length - 1));
	}
	async function loadFrames(enable = false) {
		if (!layer.image) return;
		request?.abort();
		request = new AbortController();
		const signal = request.signal;
		const mediaID = layer.image.media_id;
		const layerID = layer.id;
		loading = true;
		failure = '';
		try {
			const response = await fetch(getAuthenticatedMediaURL(`/media/${mediaID}`), {
				credentials: 'include',
				signal
			});
			if (!response.ok) throw new Error(m.image_editor_export_missing_media());
			const decoded = await readImageEditorGif(await response.blob(), true, signal);
			if (
				layer.id !== layerID ||
				layer.image?.media_id !== mediaID ||
				editor.activePageID !== pageID
			)
				return;
			const previews: string[] = [];
			const canvas = document.createElement('canvas');
			canvas.width = decoded.width;
			canvas.height = decoded.height;
			const thumb = document.createElement('canvas');
			const scale = Math.min(1, 64 / Math.max(decoded.width, decoded.height));
			thumb.width = Math.max(1, Math.round(decoded.width * scale));
			thumb.height = Math.max(1, Math.round(decoded.height * scale));
			for (const pixels of decoded.pixels) {
				signal.throwIfAborted();
				canvas
					.getContext('2d')!
					.putImageData(
						new ImageData(new Uint8ClampedArray(pixels), decoded.width, decoded.height),
						0,
						0
					);
				thumb.getContext('2d')!.clearRect(0, 0, thumb.width, thumb.height);
				thumb.getContext('2d')!.drawImage(canvas, 0, 0, thumb.width, thumb.height);
				previews.push(thumb.toDataURL('image/png'));
			}
			canvas.width = canvas.height = thumb.width = thumb.height = 0;
			thumbnails = previews;
			if (
				enable &&
				layer.image &&
				editor.activePageID === pageID &&
				editor.canEdit &&
				!editor.isLayerLocked(layerID)
			)
				update(decoded.animation);
		} catch (cause) {
			if (!signal.aborted)
				failure = imageEditorErrorMessage(cause) ?? m.image_editor_animation_failed();
		} finally {
			if (!signal.aborted) loading = false;
		}
	}
	$effect(() => {
		const mediaID = layer.image?.media_id;
		if (animation && mediaID) void loadFrames();
		return () => request?.abort();
	});
	$effect(() => {
		if (!playing || !animation) return;
		const id = editor.id;
		const animations = editor.activePage ? imageEditorPageAnimations(editor.activePage) : [];
		const infinite = animations.some((item) => item.repeat === 0);
		const duration = Math.max(
			0,
			...animations.map(
				(item) => imageEditorAnimationDuration(item) * (item.repeat < 0 ? 1 : item.repeat + 1)
			)
		);
		const start = performance.now() - untrack(() => editor.animationTimeMs);
		let timer = 0;
		function tick() {
			if (document.hidden || editor.id !== id || editor.activePageID !== pageID) {
				playing = false;
				return;
			}
			const elapsed = performance.now() - start;
			if (!infinite && elapsed >= duration) {
				editor.animationTimeMs = Math.max(0, duration - 1);
				playing = false;
			} else {
				editor.animationTimeMs = Math.floor(elapsed / 10) * 10;
				timer = requestAnimationFrame(tick);
			}
		}
		timer = requestAnimationFrame(tick);
		return () => cancelAnimationFrame(timer);
	});
	onDestroy(() => {
		request?.abort();
		const { [instanceLayerID]: _removed, ...rest } = editor.animationFrameOverrides;
		editor.animationFrameOverrides = rest;
	});
</script>

{#if animation || /\.gif$/i.test(layer.name)}
	<section class="space-y-3 border-t pt-4" aria-label={m.image_editor_animation()}>
		<h3 class="text-xs font-medium">{m.image_editor_animation()}</h3>
		{#if !animation}
			<Button
				variant="outline"
				size="sm"
				disabled={disabled || loading}
				onclick={() => loadFrames(true)}>{m.image_editor_animation_edit()}</Button
			>
		{:else}
			<div class="flex flex-wrap items-center gap-2">
				<Button
					variant="outline"
					size="sm"
					disabled={loading}
					onclick={() => {
						if (playing) {
							playing = false;
							return;
						}
						editor.animationFrameOverrides = {};
						editor.animationTimeMs = 0;
						playing = true;
					}}>{playing ? m.image_editor_animation_pause() : m.image_editor_animation_play()}</Button
				>
				<span class="text-xs text-muted-foreground"
					>{m.image_editor_animation_summary({
						frames: animation.frames.length,
						seconds: (imageEditorAnimationDuration(animation) / 1000).toFixed(2)
					})}</span
				>
			</div>
			<div
				class="flex gap-1 overflow-x-auto pb-2"
				role="group"
				aria-label={m.image_editor_animation_frames()}
			>
				{#each animation.frames as frame, index (index)}
					<button
						type="button"
						data-frame={index}
						tabindex={index === selected ? 0 : -1}
						aria-pressed={index === selected}
						aria-label={m.image_editor_animation_frame({
							index: index + 1,
							duration: frame.duration_ms
						})}
						class="min-h-14 min-w-14 shrink-0 rounded border p-1 text-xs hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
						class:border-primary={index === selected}
						onclick={() => select(index)}
						onkeydown={(event) => {
							let next = index;
							if (event.key === 'ArrowRight')
								next = Math.min(animation!.frames.length - 1, index + 1);
							else if (event.key === 'ArrowLeft') next = Math.max(0, index - 1);
							else if (event.key === 'Home') next = 0;
							else if (event.key === 'End') next = animation!.frames.length - 1;
							else return;
							event.preventDefault();
							select(next);
							event.currentTarget.parentElement
								?.querySelector<HTMLButtonElement>(`[data-frame="${next}"]`)
								?.focus();
						}}
					>
						{#if thumbnails[frame.source_index]}<img
								src={thumbnails[frame.source_index]}
								alt=""
								class="mx-auto h-10 w-12 object-contain"
							/>{/if}
						<span>{index + 1}</span>
					</button>
				{/each}
			</div>
			<label class="grid gap-1 text-xs">
				<span>{m.image_editor_animation_duration()}</span>
				<Input
					type="number"
					min={20}
					max={10000}
					step={10}
					value={animation.frames[selected]?.duration_ms ?? 100}
					{disabled}
					onchange={(event) => {
						const duration_ms = Number(event.currentTarget.value);
						update({
							...animation!,
							frames: animation!.frames.map((frame, index) =>
								index === selected ? { ...frame, duration_ms } : frame
							)
						});
					}}
				/>
			</label>
			<div class="flex flex-wrap gap-2">
				<Button
					variant="outline"
					size="sm"
					disabled={disabled || animation.frames.length >= IMAGE_EDITOR_ANIMATION_LIMITS.maxFrames}
					onclick={() => {
						const frames = [...animation!.frames];
						frames.splice(selected + 1, 0, { ...frames[selected] });
						update({ ...animation!, frames });
						select(selected + 1);
					}}>{m.image_editor_animation_duplicate()}</Button
				>
				<Button
					variant="outline"
					size="sm"
					disabled={disabled || animation.frames.length === 1}
					onclick={() =>
						update({
							...animation!,
							frames: animation!.frames.filter((_, index) => index !== selected)
						})}>{m.image_editor_animation_delete()}</Button
				>
			</div>
			<label class="flex min-h-11 items-center gap-2 text-xs">
				<Checkbox
					checked={animation.repeat >= 0}
					{disabled}
					onCheckedChange={(checked) => update({ ...animation!, repeat: checked ? 0 : -1 })}
				/>
				{m.image_editor_animation_loop()}
			</label>
			<p class="text-xs text-muted-foreground">{m.image_editor_animation_help()}</p>
		{/if}
		{#if loading}<p role="status" class="text-xs text-muted-foreground">
				{m.image_editor_animation_loading()}
			</p>{/if}
		{#if failure}<p role="alert" class="text-xs text-destructive">{failure}</p>{/if}
	</section>
{/if}
