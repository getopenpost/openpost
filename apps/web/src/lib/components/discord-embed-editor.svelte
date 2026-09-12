<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import { Input } from '$lib/components/ui/input';
	import { Textarea } from '$lib/components/ui/textarea';
	import ColorPicker from './color-picker.svelte';
	import { m } from '$lib/paraglide/messages';

	type EmbedField = { name: string; value: string; inline?: boolean };
	type Embed = {
		title?: string;
		description?: string;
		url?: string;
		timestamp?: string;
		color?: number;
		footer?: { text: string; icon_url?: string };
		image?: { url: string };
		thumbnail?: { url: string };
		author?: { name: string; url?: string; icon_url?: string };
		fields?: EmbedField[];
	};

	let { id, value, onChange }: { id: string; value: string; onChange: (value: string) => void } =
		$props();
	let editing = $state(false);

	const allowedKeys = new Set([
		'title',
		'description',
		'url',
		'timestamp',
		'color',
		'footer',
		'image',
		'thumbnail',
		'author',
		'fields'
	]);
	function isRecord(value: unknown): value is Record<string, unknown> {
		return value !== null && typeof value === 'object' && !Array.isArray(value);
	}

	function hasStringShape(
		value: unknown,
		required: string[],
		optional: string[] = []
	): value is Record<string, string> {
		if (!isRecord(value)) return false;
		if (Object.keys(value).some((key) => !required.includes(key) && !optional.includes(key)))
			return false;
		return (
			required.every((key) => typeof value[key] === 'string') &&
			optional.every((key) => value[key] === undefined || typeof value[key] === 'string')
		);
	}

	function isEmbed(value: unknown): value is Embed {
		if (!isRecord(value) || Object.keys(value).some((key) => !allowedKeys.has(key))) return false;
		if (
			['title', 'description', 'url', 'timestamp'].some(
				(key) => value[key] !== undefined && typeof value[key] !== 'string'
			)
		)
			return false;
		if (
			value.color !== undefined &&
			(typeof value.color !== 'number' ||
				!Number.isInteger(value.color) ||
				value.color < 0 ||
				value.color > 0xffffff)
		)
			return false;
		if (value.footer !== undefined && !hasStringShape(value.footer, ['text'], ['icon_url']))
			return false;
		if (value.image !== undefined && !hasStringShape(value.image, ['url'])) return false;
		if (value.thumbnail !== undefined && !hasStringShape(value.thumbnail, ['url'])) return false;
		if (value.author !== undefined && !hasStringShape(value.author, ['name'], ['url', 'icon_url']))
			return false;
		if (value.fields !== undefined) {
			if (!Array.isArray(value.fields)) return false;
			if (
				value.fields.some(
					(field) =>
						!isRecord(field) ||
						Object.keys(field).some((key) => !['name', 'value', 'inline'].includes(key)) ||
						typeof field.name !== 'string' ||
						typeof field.value !== 'string' ||
						(field.inline !== undefined && typeof field.inline !== 'boolean')
				)
			)
				return false;
		}
		return true;
	}

	const parsed = $derived.by((): Embed | null => {
		if (!value.trim()) return {};
		try {
			const result: unknown = JSON.parse(value);
			return isEmbed(result) ? result : null;
		} catch {
			return null;
		}
	});
	const active = $derived(Boolean(value.trim()) || editing);

	function localTimestamp(value: string | undefined): string {
		if (!value) return '';
		const date = new Date(value);
		if (Number.isNaN(date.getTime())) return '';
		return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
	}

	function save(next: Embed): void {
		const clean: Embed = {};
		for (const key of ['title', 'description', 'url', 'timestamp'] as const) {
			if (next[key]?.trim()) clean[key] = next[key];
		}
		if (next.color !== undefined) clean.color = next.color;
		if (next.footer?.text.trim() || next.footer?.icon_url?.trim()) {
			clean.footer = { text: next.footer.text };
			if (next.footer.icon_url?.trim()) clean.footer.icon_url = next.footer.icon_url;
		}
		if (next.image?.url.trim()) clean.image = { url: next.image.url };
		if (next.thumbnail?.url.trim()) clean.thumbnail = { url: next.thumbnail.url };
		if (next.author?.name.trim() || next.author?.url?.trim() || next.author?.icon_url?.trim()) {
			clean.author = { name: next.author.name };
			if (next.author.url?.trim()) clean.author.url = next.author.url;
			if (next.author.icon_url?.trim()) clean.author.icon_url = next.author.icon_url;
		}
		if (next.fields?.length) clean.fields = next.fields;
		onChange(Object.keys(clean).length ? JSON.stringify(clean) : '');
	}

	function updateField(index: number, patch: Partial<EmbedField>): void {
		if (!parsed) return;
		const fields = [...(parsed.fields ?? [])];
		fields[index] = { ...fields[index], ...patch };
		save({ ...parsed, fields });
	}
</script>

<div {id} class="mt-2 space-y-3">
	{#if !active}
		<Button type="button" variant="outline" class="min-h-11" onclick={() => (editing = true)}>
			{m.compose_embed_add()}
		</Button>
	{:else if !parsed}
		<p class="text-sm text-destructive" role="alert">
			{m.compose_embed_invalid_json()}
		</p>
		<Textarea
			aria-label={m.compose_embed_json()}
			class="min-h-32 font-mono text-xs"
			{value}
			oninput={(event) => onChange(event.currentTarget.value)}
		/>
	{:else}
		<div class="grid gap-3 sm:grid-cols-2">
			<div>
				<label class="text-xs font-medium" for={`${id}-title`}
					>{m.compose_publication_title()}</label
				>
				<Input
					id={`${id}-title`}
					class="mt-1 h-11"
					maxlength={256}
					value={parsed.title ?? ''}
					oninput={(event) => save({ ...parsed, title: event.currentTarget.value })}
				/>
			</div>
			<div class="sm:col-span-2">
				<label class="text-xs font-medium" for={`${id}-description`}
					>{m.compose_description()}</label
				>
				<Textarea
					id={`${id}-description`}
					class="mt-1 min-h-24"
					maxlength={4096}
					value={parsed.description ?? ''}
					oninput={(event) => save({ ...parsed, description: event.currentTarget.value })}
				/>
			</div>
		</div>
		<details class="space-y-3 rounded-md border p-3">
			<summary class="cursor-pointer text-sm font-medium">{m.compose_embed_more()}</summary>
			<div class="grid gap-3 pt-3 sm:grid-cols-2">
				<div class="sm:col-span-2">
					<label class="text-xs font-medium" for={`${id}-url`}>{m.compose_link_url()}</label>
					<Input
						id={`${id}-url`}
						type="url"
						class="mt-1 h-11"
						value={parsed.url ?? ''}
						oninput={(event) => save({ ...parsed, url: event.currentTarget.value })}
					/>
				</div>
				<div>
					<ColorPicker
						id={`${id}-color`}
						label={m.compose_embed_color()}
						value={parsed.color === undefined
							? '#000000'
							: `#${parsed.color.toString(16).padStart(6, '0')}`}
						onChange={(color) => save({ ...parsed, color: Number.parseInt(color.slice(1), 16) })}
					/>
					{#if parsed.color !== undefined}<Button
							type="button"
							variant="ghost"
							size="sm"
							onclick={() => save({ ...parsed, color: undefined })}
							>{m.compose_embed_clear_color()}</Button
						>{/if}
				</div>
				<div>
					<label class="text-xs font-medium" for={`${id}-timestamp`}
						>{m.compose_embed_timestamp()}</label
					>
					<Input
						id={`${id}-timestamp`}
						type="datetime-local"
						class="mt-1 h-11"
						value={localTimestamp(parsed.timestamp)}
						oninput={(event) =>
							save({
								...parsed,
								timestamp: event.currentTarget.value
									? new Date(event.currentTarget.value).toISOString()
									: ''
							})}
					/>
				</div>
				<div>
					<label class="text-xs font-medium" for={`${id}-image`}
						>{m.compose_embed_image_url()}</label
					>
					<Input
						id={`${id}-image`}
						type="url"
						class="mt-1 h-11"
						value={parsed.image?.url ?? ''}
						oninput={(event) => save({ ...parsed, image: { url: event.currentTarget.value } })}
					/>
				</div>
				<div>
					<label class="text-xs font-medium" for={`${id}-thumbnail`}
						>{m.compose_embed_thumbnail_url()}</label
					>
					<Input
						id={`${id}-thumbnail`}
						type="url"
						class="mt-1 h-11"
						value={parsed.thumbnail?.url ?? ''}
						oninput={(event) => save({ ...parsed, thumbnail: { url: event.currentTarget.value } })}
					/>
				</div>
				<div>
					<label class="text-xs font-medium" for={`${id}-author`}
						>{m.compose_embed_author_name()}</label
					>
					<Input
						id={`${id}-author`}
						class="mt-1 h-11"
						maxlength={256}
						value={parsed.author?.name ?? ''}
						oninput={(event) =>
							save({ ...parsed, author: { ...parsed.author, name: event.currentTarget.value } })}
					/>
				</div>
				<div>
					<label class="text-xs font-medium" for={`${id}-author-url`}
						>{m.compose_embed_author_url()}</label
					>
					<Input
						id={`${id}-author-url`}
						type="url"
						class="mt-1 h-11"
						value={parsed.author?.url ?? ''}
						oninput={(event) =>
							save({
								...parsed,
								author: {
									name: parsed.author?.name ?? '',
									...parsed.author,
									url: event.currentTarget.value
								}
							})}
					/>
				</div>
				<div>
					<label class="text-xs font-medium" for={`${id}-author-icon`}
						>{m.compose_embed_author_icon_url()}</label
					>
					<Input
						id={`${id}-author-icon`}
						type="url"
						class="mt-1 h-11"
						value={parsed.author?.icon_url ?? ''}
						oninput={(event) =>
							save({
								...parsed,
								author: {
									name: parsed.author?.name ?? '',
									...parsed.author,
									icon_url: event.currentTarget.value
								}
							})}
					/>
				</div>
				<div>
					<label class="text-xs font-medium" for={`${id}-footer`}>{m.compose_embed_footer()}</label>
					<Input
						id={`${id}-footer`}
						class="mt-1 h-11"
						maxlength={2048}
						value={parsed.footer?.text ?? ''}
						oninput={(event) =>
							save({ ...parsed, footer: { ...parsed.footer, text: event.currentTarget.value } })}
					/>
				</div>
				<div>
					<label class="text-xs font-medium" for={`${id}-footer-icon`}
						>{m.compose_embed_footer_icon_url()}</label
					>
					<Input
						id={`${id}-footer-icon`}
						type="url"
						class="mt-1 h-11"
						value={parsed.footer?.icon_url ?? ''}
						oninput={(event) =>
							save({
								...parsed,
								footer: {
									text: parsed.footer?.text ?? '',
									...parsed.footer,
									icon_url: event.currentTarget.value
								}
							})}
					/>
				</div>
			</div>
			<div class="space-y-3 pt-3">
				{#each parsed.fields ?? [] as field, index (index)}
					<fieldset class="grid gap-3 rounded-md border p-3 sm:grid-cols-2">
						<legend class="px-1 text-xs font-medium"
							>{m.compose_embed_field({ number: String(index + 1) })}</legend
						>
						<div>
							<label class="text-xs font-medium" for={`${id}-field-name-${index}`}
								>{m.compose_embed_field_name()}</label
							><Input
								id={`${id}-field-name-${index}`}
								class="mt-1 h-11"
								maxlength={256}
								value={field.name}
								oninput={(event) => updateField(index, { name: event.currentTarget.value })}
							/>
						</div>
						<div>
							<label class="text-xs font-medium" for={`${id}-field-value-${index}`}
								>{m.compose_embed_field_value()}</label
							><Input
								id={`${id}-field-value-${index}`}
								class="mt-1 h-11"
								maxlength={1024}
								value={field.value}
								oninput={(event) => updateField(index, { value: event.currentTarget.value })}
							/>
						</div>
						<label class="flex min-h-11 items-center gap-2 text-xs"
							><Checkbox
								checked={Boolean(field.inline)}
								onCheckedChange={(checked) => updateField(index, { inline: checked })}
							/>{m.compose_embed_inline()}</label
						>
						<Button
							type="button"
							variant="ghost"
							size="sm"
							class="justify-self-start"
							onclick={() =>
								save({
									...parsed,
									fields: parsed.fields?.filter((_, fieldIndex) => fieldIndex !== index)
								})}>{m.compose_embed_remove_field()}</Button
						>
					</fieldset>
				{/each}
				{#if (parsed.fields?.length ?? 0) < 25}<Button
						type="button"
						variant="outline"
						size="sm"
						onclick={() =>
							save({ ...parsed, fields: [...(parsed.fields ?? []), { name: '', value: '' }] })}
						>{m.compose_embed_add_field()}</Button
					>{/if}
			</div>
		</details>
		<Button
			type="button"
			variant="ghost"
			size="sm"
			onclick={() => {
				onChange('');
				editing = false;
			}}>{m.compose_clear()}</Button
		>
	{/if}
</div>
