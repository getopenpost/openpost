<script lang="ts">
	import TextField from './text-field.svelte';
	import ImageField from './image-field.svelte';
	import { m } from '$lib/paraglide/messages';
	import type { Meme } from './meme';
	let {
		workspaceId,
		value,
		onchange
	}: { workspaceId: string; value: Meme; onchange: (value: Meme, key?: string) => void } = $props();
</script>

{#each value.captions as caption, index (index)}
	<TextField
		label={m.meme_generator_caption_label({ number: index + 1 })}
		value={caption}
		maxlength={200}
		multiline
		oninput={(text) =>
			onchange(
				{ ...value, captions: value.captions.map((current, i) => (i === index ? text : current)) },
				`caption-${index}`
			)}
	/>
{/each}
{#each Array.from({ length: value.overlay_slots }) as _, index (index)}
	<fieldset disabled={index > value.overlay_media_ids.length}>
		<ImageField
			accept={['image/png', 'image/jpeg', 'image/webp', 'image/gif']}
			{workspaceId}
			mediaId={value.overlay_media_ids[index]}
			label={m.meme_generator_image_slot_label({ number: index + 1 })}
			onchange={(id) =>
				onchange({
					...value,
					overlay_media_ids: id
						? [
								...value.overlay_media_ids.slice(0, index),
								id,
								...value.overlay_media_ids.slice(index + 1)
							]
						: value.overlay_media_ids.slice(0, index)
				})}
		/>
	</fieldset>
{/each}
