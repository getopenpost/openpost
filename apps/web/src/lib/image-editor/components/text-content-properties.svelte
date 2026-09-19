<script lang="ts">
	import AppSelect from '$lib/components/app-select.svelte';
	import ImageEditorFontPicker from '$lib/components/editor-font-picker.svelte';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Textarea } from '$lib/components/ui/textarea';
	import { m } from '$lib/paraglide/messages';
	import { useImageEditor } from '../editor.svelte';

	const editor = useImageEditor();
	let layer = $derived(editor.selectedLayers[0] ?? null);
	let brandFonts = $derived(editor.brandKit?.fonts ?? []);
	let brandTextStyles = $derived(editor.brandKit?.text_styles ?? []);
	let missingFontAsset = $derived(
		layer?.text?.font_asset_id &&
			!brandFonts.some((font) => font.media_id === layer?.text?.font_asset_id)
			? layer.text.font_asset_id
			: ''
	);
	let applicationFeedback = $state('');

	function numberValue(event: Event, fallback: number): number {
		const value =
			event.currentTarget instanceof HTMLInputElement
				? Number(event.currentTarget.value)
				: Number.NaN;
		return Number.isFinite(value) ? value : fallback;
	}

	function applyTextStyle(styleID: string): void {
		const style = brandTextStyles.find((candidate) => candidate.id === styleID);
		if (!style) return;
		const result = editor.applyBrandTextStyle(style);
		applicationFeedback =
			result.skippedLocked || result.skippedUnsupported
				? m.image_editor_partial_application({
						applied: result.applied,
						locked: result.skippedLocked,
						unsupported: result.skippedUnsupported
					})
				: m.image_editor_applied_to_layers({ count: result.applied });
	}
</script>

{#if layer?.type === 'text' && layer.text}
	<section class="space-y-2">
		<h3 class="text-xs font-medium text-muted-foreground">{m.image_editor_text()}</h3>
		{#if brandTextStyles.length > 0}
			<label class="grid gap-1 text-xs">
				<span>{m.image_editor_text_styles()}</span>
				<AppSelect
					value=""
					ariaLabel={m.image_editor_apply_text_style()}
					disabled={!editor.canEdit || layer.locked}
					onValueChange={applyTextStyle}
					options={brandTextStyles.map((style) => ({ value: style.id, label: style.name }))}
					placeholder={m.image_editor_choose_text_style()}
					class="h-7 w-full"
				/>
			</label>
		{/if}
		{#if missingFontAsset}
			<div class="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs" role="alert">
				<p>{m.image_editor_missing_brand_font()}</p>
				<Button
					variant="outline"
					size="xs"
					class="mt-2"
					onclick={() =>
						editor.updateLayer(layer.id, {
							text: {
								...layer.text!,
								font_family: 'Geist Variable',
								font_asset_id: undefined
							}
						})}
				>
					{m.image_editor_use_fallback_font()}
				</Button>
			</div>
		{/if}
		<label class="grid gap-1 text-xs">
			<span>{m.image_editor_text()}</span>
			<Textarea
				class="min-h-20"
				value={layer.text.text}
				disabled={!editor.canEdit}
				oninput={(event) =>
					editor.updateLayer(
						layer.id,
						{ text: { ...layer.text!, text: event.currentTarget.value } },
						`text:${layer.id}`
					)}
			/>
		</label>
		<label class="grid gap-1 text-xs">
			<span>{m.image_editor_font_family()}</span>
			<ImageEditorFontPicker
				value={layer.text.font_family}
				disabled={!editor.canEdit}
				{brandFonts}
				onChange={(font) =>
					editor.updateLayer(layer.id, {
						text: {
							...layer.text!,
							font_family: font.family,
							font_asset_id: font.assetID,
							font_weight: font.weight ?? layer.text!.font_weight,
							font_style: font.style ?? layer.text!.font_style
						}
					})}
			/>
		</label>
		<div class="grid grid-cols-2 gap-2">
			<label class="grid gap-1 text-xs">
				<span>{m.image_editor_size()}</span>
				<Input
					type="number"
					min="1"
					value={layer.text.font_size}
					disabled={!editor.canEdit}
					oninput={(event) =>
						editor.updateLayer(
							layer.id,
							{
								text: {
									...layer.text!,
									font_size: numberValue(event, layer.text!.font_size)
								}
							},
							`font-size:${layer.id}`
						)}
				/>
			</label>
			<label class="grid gap-1 text-xs">
				<span>{m.image_editor_weight()}</span>
				<AppSelect
					value={String(layer.text.font_weight)}
					ariaLabel={m.image_editor_weight()}
					disabled={!editor.canEdit}
					onValueChange={(value) =>
						editor.updateLayer(layer.id, {
							text: { ...layer.text!, font_weight: Number(value) }
						})}
					options={[
						[100, m.image_editor_thin()],
						[200, m.image_editor_extra_light()],
						[300, m.image_editor_light()],
						[400, m.image_editor_regular()],
						[500, m.image_editor_medium()],
						[600, m.image_editor_semibold()],
						[700, m.image_editor_bold()],
						[800, m.image_editor_extra_bold()],
						[900, m.image_editor_black()]
					].map(([weight, label]) => ({ value: String(weight), label: `${weight} · ${label}` }))}
					class="h-7 w-full"
				/>
			</label>
		</div>
		{#if applicationFeedback}
			<p class="rounded-md border bg-muted/40 px-2.5 py-2 text-xs" role="status">
				{applicationFeedback}
			</p>
		{/if}
	</section>
{/if}
