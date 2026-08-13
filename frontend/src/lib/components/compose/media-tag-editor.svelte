<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { m } from '$lib/paraglide/messages';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import XIcon from '@lucide/svelte/icons/x';

	interface MediaTag {
		value: string;
		x: string;
		y: string;
	}

	interface Props {
		id: string;
		value?: string;
		valueKey: 'username' | 'product_id';
		maximum?: number;
		coordinatesRequired?: boolean;
		disabled?: boolean;
		onChange: (value: string) => void;
	}

	let {
		id,
		value = '',
		valueKey,
		maximum = 20,
		coordinatesRequired = false,
		disabled = false,
		onChange
	}: Props = $props();

	const tags = $derived(parseTags(value, valueKey));

	function parseTags(raw: string, key: Props['valueKey']): MediaTag[] {
		if (!raw.trim()) return [];
		try {
			const parsed = JSON.parse(raw);
			if (!Array.isArray(parsed)) return [];
			return parsed.map((tag) => ({
				value: typeof tag?.[key] === 'string' ? tag[key] : String(tag?.[key] ?? ''),
				x: tag?.x === undefined ? '' : String(tag.x),
				y: tag?.y === undefined ? '' : String(tag.y)
			}));
		} catch {
			return [];
		}
	}

	function emit(next: MediaTag[]) {
		const encoded = next
			.filter((tag) => tag.value.trim() || tag.x || tag.y)
			.map((tag) => ({
				[valueKey]: tag.value.trim(),
				...(tag.x !== '' ? { x: Number(tag.x) } : {}),
				...(tag.y !== '' ? { y: Number(tag.y) } : {})
			}));
		onChange(encoded.length > 0 ? JSON.stringify(encoded) : '');
	}

	function updateTag(index: number, key: keyof MediaTag, nextValue: string) {
		const next = tags.map((tag) => ({ ...tag }));
		next[index][key] = nextValue;
		emit(next);
	}

	function addTag() {
		if (tags.length >= maximum) return;
		emit([...tags, { value: '', x: '0.5', y: '0.5' }]);
	}

	function removeTag(index: number) {
		emit(tags.filter((_, tagIndex) => tagIndex !== index));
	}
</script>

<div class="mt-1 space-y-2">
	{#each tags as tag, index (`${id}-${index}`)}
		<div class="grid grid-cols-[minmax(0,1fr)_4.5rem_4.5rem_2.75rem] items-end gap-2">
			<div>
				<label class="sr-only" for="{id}-value-{index}">
					{valueKey === 'username' ? m.compose_media_tag_username() : m.compose_media_tag_product()}
				</label>
				<Input
					id="{id}-value-{index}"
					class="h-11"
					value={tag.value}
					placeholder={valueKey === 'username'
						? m.compose_media_tag_username()
						: m.compose_media_tag_product()}
					{disabled}
					oninput={(event) => updateTag(index, 'value', event.currentTarget.value)}
				/>
			</div>
			<div>
				<label class="text-xs text-muted-foreground" for="{id}-x-{index}">X</label>
				<Input
					id="{id}-x-{index}"
					class="h-11"
					type="number"
					min="0"
					max="1"
					step="0.01"
					value={tag.x}
					aria-required={coordinatesRequired}
					{disabled}
					oninput={(event) => updateTag(index, 'x', event.currentTarget.value)}
				/>
			</div>
			<div>
				<label class="text-xs text-muted-foreground" for="{id}-y-{index}">Y</label>
				<Input
					id="{id}-y-{index}"
					class="h-11"
					type="number"
					min="0"
					max="1"
					step="0.01"
					value={tag.y}
					aria-required={coordinatesRequired}
					{disabled}
					oninput={(event) => updateTag(index, 'y', event.currentTarget.value)}
				/>
			</div>
			<Button
				type="button"
				variant="ghost"
				size="icon"
				class="size-11 text-muted-foreground hover:text-destructive"
				{disabled}
				aria-label={m.compose_remove_media_tag({ number: index + 1 })}
				onclick={() => removeTag(index)}
			>
				<XIcon class="size-4" />
			</Button>
		</div>
	{/each}

	<div class="flex items-center justify-between gap-3">
		<Button
			type="button"
			variant="outline"
			size="sm"
			class="h-11 gap-2 sm:h-9"
			disabled={disabled || tags.length >= maximum}
			onclick={addTag}
		>
			<PlusIcon class="size-4" />
			{m.compose_add_media_tag()}
		</Button>
		<span class="text-xs text-muted-foreground" aria-live="polite">
			{tags.length}/{maximum}
		</span>
	</div>
</div>
