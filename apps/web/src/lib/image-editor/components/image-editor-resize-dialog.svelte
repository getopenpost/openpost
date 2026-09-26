<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Input } from '$lib/components/ui/input';
	import * as RadioGroup from '$lib/components/ui/radio-group';
	import { m } from '$lib/paraglide/messages';
	import { useImageEditor } from '../editor.svelte';
	import {
		resizeImageEditorDocument,
		resizeImageEditorPage,
		type ImageEditorResizeMode
	} from '../resize';
	import { IMAGE_EDITOR_LIMITS } from '../types';
	import { imageEditorPageDimensions } from '../page-dimensions';

	interface Props {
		open: boolean;
		scope?: 'design' | 'page';
	}

	let { open = $bindable(), scope = 'design' }: Props = $props();

	const editor = useImageEditor();

	let width = $state(1080);
	let height = $state(1080);
	let mode = $state<ImageEditorResizeMode>('fit');
	let error = $state('');

	$effect.pre(() => {
		if (open && editor.document) {
			const current =
				scope === 'page' && editor.activePage
					? imageEditorPageDimensions(editor.document, editor.activePage)
					: {
							width: editor.document.width_px,
							height: editor.document.height_px
						};
			width = current.width;
			height = current.height;
			mode = 'fit';
			error = '';
		}
	});

	function resize(): void {
		if (!editor.document) return;
		if (
			!Number.isInteger(width) ||
			!Number.isInteger(height) ||
			width < IMAGE_EDITOR_LIMITS.minDimension ||
			height < IMAGE_EDITOR_LIMITS.minDimension ||
			width > IMAGE_EDITOR_LIMITS.maxDimension ||
			height > IMAGE_EDITOR_LIMITS.maxDimension ||
			width * height > IMAGE_EDITOR_LIMITS.maxPixels
		) {
			error = m.image_editor_resize_limits();
			return;
		}
		const current =
			scope === 'page'
				? editor.activePageDimensions
				: {
						width: editor.document.width_px,
						height: editor.document.height_px
					};
		const allPagesAlreadyMatch =
			scope === 'page' ||
			editor.document.pages.every((page) => {
				const size = imageEditorPageDimensions(editor.document!, page);
				return size.width === width && size.height === height;
			});
		if (width === current.width && height === current.height && allPagesAlreadyMatch) {
			open = false;
			return;
		}
		if (scope === 'page') {
			const resized = resizeImageEditorPage(editor.document, editor.activePageID, {
				width,
				height,
				mode
			});
			editor.clearPixelSelection();
			editor.mutate(m.image_editor_resize_page(), (document) => {
				document.pages = resized.pages;
			});
		} else {
			const resized = resizeImageEditorDocument(editor.document, {
				width,
				height,
				mode
			});
			editor.clearPixelSelection();
			editor.mutate(m.image_editor_resize_design(), (document) => {
				document.width_px = resized.width_px;
				document.height_px = resized.height_px;
				document.preset_key = resized.preset_key;
				document.pages = resized.pages;
			});
		}
		editor.fitZoom();
		open = false;
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title
				>{scope === 'page'
					? m.image_editor_resize_page()
					: m.image_editor_resize_design()}</Dialog.Title
			>
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
			<RadioGroup.Root bind:value={mode} class="grid gap-2">
				<label
					class="grid min-h-14 cursor-pointer grid-cols-[auto_1fr] items-start gap-x-2 rounded-lg border p-3 text-sm has-data-[state=checked]:border-primary has-data-[state=checked]:bg-primary/5"
				>
					<RadioGroup.Item value="fit" class="mt-0.5" />
					<span class="grid gap-0.5">
						<span class="font-medium">{m.image_editor_resize_fit()}</span>
						<span class="text-xs text-muted-foreground">
							{m.image_editor_resize_fit_description()}
						</span>
					</span>
				</label>
				<label
					class="grid min-h-14 cursor-pointer grid-cols-[auto_1fr] items-start gap-x-2 rounded-lg border p-3 text-sm has-data-[state=checked]:border-primary has-data-[state=checked]:bg-primary/5"
				>
					<RadioGroup.Item value="fill" class="mt-0.5" />
					<span class="grid gap-0.5">
						<span class="font-medium">{m.image_editor_resize_fill()}</span>
						<span class="text-xs text-muted-foreground">
							{m.image_editor_resize_fill_description()}
						</span>
					</span>
				</label>
				<label
					class="grid min-h-14 cursor-pointer grid-cols-[auto_1fr] items-start gap-x-2 rounded-lg border p-3 text-sm has-data-[state=checked]:border-primary has-data-[state=checked]:bg-primary/5"
				>
					<RadioGroup.Item value="preserve" class="mt-0.5" />
					<span class="grid gap-0.5">
						<span class="font-medium">{m.image_editor_resize_keep_size()}</span>
						<span class="text-xs text-muted-foreground">
							{m.image_editor_resize_keep_size_description()}
						</span>
					</span>
				</label>
				<label
					class="grid min-h-14 cursor-pointer grid-cols-[auto_1fr] items-start gap-x-2 rounded-lg border p-3 text-sm has-data-[state=checked]:border-primary has-data-[state=checked]:bg-primary/5"
				>
					<RadioGroup.Item value="stretch" class="mt-0.5" />
					<span class="grid gap-0.5">
						<span class="font-medium">{m.image_editor_resize_stretch()}</span>
						<span class="text-xs text-muted-foreground">
							{m.image_editor_resize_stretch_description()}
						</span>
					</span>
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
