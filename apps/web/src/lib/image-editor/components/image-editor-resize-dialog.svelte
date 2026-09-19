<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Input } from '$lib/components/ui/input';
	import * as RadioGroup from '$lib/components/ui/radio-group';
	import { m } from '$lib/paraglide/messages';
	import { useImageEditor } from '../editor.svelte';

	interface Props {
		open: boolean;
	}

	let { open = $bindable() }: Props = $props();

	const editor = useImageEditor();

	let width = $state(1080);
	let height = $state(1080);
	let mode = $state<'scale' | 'preserve'>('scale');
	let error = $state('');

	$effect.pre(() => {
		if (open && editor.document) {
			width = editor.document.width_px;
			height = editor.document.height_px;
			mode = 'scale';
			error = '';
		}
	});

	function resize(): void {
		if (!editor.document) return;
		if (width < 64 || height < 64 || width > 4096 || height > 4096 || width * height > 25_000_000) {
			error = m.image_editor_resize_limits();
			return;
		}
		const previousWidth = editor.document.width_px;
		const previousHeight = editor.document.height_px;
		editor.mutate('Resize design', (document) => {
			if (mode === 'scale') {
				const scaleX = width / previousWidth;
				const scaleY = height / previousHeight;
				for (const page of document.pages) {
					for (const layer of page.layers) {
						layer.transform.x *= scaleX;
						layer.transform.y *= scaleY;
						layer.transform.width *= scaleX;
						layer.transform.height *= scaleY;
						if (layer.text) layer.text.font_size *= Math.min(scaleX, scaleY);
					}
				}
			}
			document.width_px = width;
			document.height_px = height;
			document.preset_key = 'custom';
		});
		editor.fitZoom();
		open = false;
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title>{m.image_editor_resize_design()}</Dialog.Title>
			<Dialog.Description>{m.image_editor_resize_body()}</Dialog.Description>
		</Dialog.Header>
		<div class="grid gap-4">
			<div class="grid grid-cols-2 gap-3">
				<label class="grid gap-1.5 text-sm">
					<span class="font-medium">{m.image_editor_width()}</span>
					<Input type="number" min="64" max="4096" bind:value={width} />
				</label>
				<label class="grid gap-1.5 text-sm">
					<span class="font-medium">{m.image_editor_height()}</span>
					<Input type="number" min="64" max="4096" bind:value={height} />
				</label>
			</div>
			<RadioGroup.Root bind:value={mode}>
				<label
					class="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border px-3 text-sm has-data-[state=checked]:border-primary has-data-[state=checked]:bg-primary/5"
				>
					<RadioGroup.Item value="scale" aria-label={m.image_editor_scale_content()} />
					<span>{m.image_editor_scale_content()}</span>
				</label>
				<label
					class="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border px-3 text-sm has-data-[state=checked]:border-primary has-data-[state=checked]:bg-primary/5"
				>
					<RadioGroup.Item value="preserve" aria-label={m.image_editor_preserve_content()} />
					<span>{m.image_editor_preserve_content()}</span>
				</label>
			</RadioGroup.Root>
			{#if error}
				<p class="rounded-md bg-destructive/10 p-3 text-sm text-destructive" role="alert">
					{error}
				</p>
			{/if}
		</div>
		<Dialog.Footer>
			<Button variant="ghost" onclick={() => (open = false)}>{m.common_cancel()}</Button>
			<Button onclick={resize}>{m.image_editor_resize()}</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
