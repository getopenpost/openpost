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

	let axis = $state<'horizontal' | 'vertical'>('vertical');
	let position = $state<number | undefined>(0);
	const positionHelpID = $props.id();
	const positionLimit = $derived(
		axis === 'horizontal' ? editor.activePageDimensions.height : editor.activePageDimensions.width
	);
	const positionValid = $derived(
		typeof position === 'number' &&
			Number.isFinite(position) &&
			position >= 0 &&
			position <= positionLimit
	);

	$effect.pre(() => {
		if (open) {
			axis = 'vertical';
			position = Math.round(editor.activePageDimensions.width / 2);
		}
	});

	function addGuide(): void {
		if (!positionValid || typeof position !== 'number') return;
		editor.addGuide(axis, position);
		open = false;
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="sm:max-w-sm">
		<Dialog.Header>
			<Dialog.Title>{m.image_editor_add_guide()}</Dialog.Title>
			<Dialog.Description>{m.image_editor_guide_position()}</Dialog.Description>
		</Dialog.Header>
		<div class="grid gap-4">
			<RadioGroup.Root bind:value={axis} class="grid grid-cols-2 gap-2">
				<label
					class="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border px-3 text-sm has-data-[state=checked]:border-primary has-data-[state=checked]:bg-primary/5"
				>
					<RadioGroup.Item value="horizontal" aria-label={m.image_editor_horizontal()} />
					{m.image_editor_horizontal()}
				</label>
				<label
					class="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border px-3 text-sm has-data-[state=checked]:border-primary has-data-[state=checked]:bg-primary/5"
				>
					<RadioGroup.Item value="vertical" aria-label={m.image_editor_vertical()} />
					{m.image_editor_vertical()}
				</label>
			</RadioGroup.Root>
			<div class="grid gap-1.5 text-sm">
				<label for={`${positionHelpID}-input`} class="font-medium"
					>{m.image_editor_guide_position()}</label
				>
				<Input
					id={`${positionHelpID}-input`}
					type="number"
					min="0"
					max={positionLimit}
					step="any"
					aria-invalid={!positionValid}
					aria-describedby={positionHelpID}
					bind:value={position}
					onkeydown={(event) => {
						if (event.key === 'Enter') {
							event.preventDefault();
							addGuide();
						}
					}}
				/>
				<span
					id={positionHelpID}
					class="text-xs"
					class:text-destructive={!positionValid}
					class:text-muted-foreground={positionValid}
					>{m.image_editor_guide_position_range({ max: positionLimit })}</span
				>
			</div>
		</div>
		<Dialog.Footer>
			<Button variant="ghost" onclick={() => (open = false)}>{m.common_cancel()}</Button>
			<Button disabled={!positionValid} onclick={addGuide}>{m.image_editor_add_guide()}</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
