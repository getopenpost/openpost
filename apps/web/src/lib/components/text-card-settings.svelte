<script lang="ts">
	import type { SocialAccount } from '$lib/api/client';
	import type { ComposerSettings, ComposerSettingValue } from './compose/modes';
	import {
		textCardIdentityForAccount,
		textCardSettings,
		type TextCardResult
	} from '$lib/text-cards';
	import { m } from '$lib/paraglide/messages';
	import AppSelect from './app-select.svelte';
	import ColorPicker from './color-picker.svelte';
	import TextCardPreview from './text-card-preview.svelte';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import { Label } from '$lib/components/ui/label';
	import Disclosure from '$lib/components/disclosure.svelte';

	let {
		account,
		values,
		defaults = {},
		outputProfile = '',
		text = '',
		attachmentCount = 0,
		savedPreview,
		onChange
	}: {
		account: SocialAccount;
		values: ComposerSettings;
		// Catalogue defaults resolved once via textCardDefaultsFrom. The caller
		// already normalizes values against the same catalogue, so this only
		// fills keys the values do not carry; it must not restate server literals.
		defaults?: ComposerSettings;
		outputProfile?: string;
		text?: string;
		attachmentCount?: number;
		savedPreview?: TextCardResult;
		onChange: (key: string, value: ComposerSettingValue) => void;
	} = $props();
	const mode = $derived(String(values.text_card ?? 'text_only'));
	const background = $derived(String(values.text_card_background ?? 'gradient'));
	const request = $derived(
		mode === 'off'
			? null
			: {
					social_account_id: account.id,
					text: text || m.text_card_sample(),
					output_profile: outputProfile,
					attachment_count: attachmentCount,
					settings: textCardSettings(values)
				}
	);
</script>

<section class="space-y-3" aria-labelledby="text-card-heading">
	<h3 id="text-card-heading" class="text-sm font-semibold">{m.text_card_title()}</h3>
	<AppSelect
		value={mode}
		ariaLabel={m.text_card_title()}
		class="h-11"
		options={[
			{ value: 'text_only', label: m.text_card_only_text() },
			{ value: 'always', label: m.text_card_with_media() },
			{ value: 'off', label: m.text_card_off() }
		]}
		onValueChange={(value) => onChange('text_card', value)}
	/>
	{#if mode !== 'off'}
		<p class="text-xs text-muted-foreground">
			{mode === 'always' ? m.text_card_carousel_hint() : m.text_card_auto_hint()}
		</p>
		<TextCardPreview
			{request}
			{savedPreview}
			{defaults}
			identity={textCardIdentityForAccount(account)}
		/>
		<Disclosure summary={m.text_card_customize()}>
			<div class="grid gap-4 pt-2 sm:grid-cols-2">
				<div class="space-y-2">
					<Label for="text-card-appearance">{m.text_card_appearance()}</Label>
					<AppSelect
						id="text-card-appearance"
						value={String(values.text_card_appearance ?? 'light')}
						ariaLabel={m.text_card_appearance()}
						options={[
							{ value: 'light', label: m.text_card_light() },
							{ value: 'dark', label: m.text_card_dark() }
						]}
						onValueChange={(value) => onChange('text_card_appearance', value)}
					/>
				</div>
				<div class="space-y-2">
					<Label for="text-card-background">{m.text_card_background()}</Label>
					<AppSelect
						id="text-card-background"
						value={background}
						ariaLabel={m.text_card_background()}
						options={[
							{ value: 'solid', label: m.image_editor_solid_color() },
							{ value: 'gradient', label: m.image_editor_gradient() },
							{ value: 'mesh', label: m.text_card_mesh() }
						]}
						onValueChange={(value) => onChange('text_card_background', value)}
					/>
				</div>
				<ColorPicker
					label={m.image_editor_background_color()}
					value={String(values.text_card_color ?? defaults.text_card_color ?? '')}
					onChange={(value) => onChange('text_card_color', value)}
				/>
				{#if background !== 'solid'}<ColorPicker
						label={m.image_editor_gradient_end_color()}
						value={String(values.text_card_color_end ?? defaults.text_card_color_end ?? '')}
						onChange={(value) => onChange('text_card_color_end', value)}
					/>{/if}
				<div class="flex min-h-11 items-center gap-2">
					<Checkbox
						id="text-card-rounded"
						checked={values.text_card_rounded !== false}
						onCheckedChange={(value) => onChange('text_card_rounded', value === true)}
					/><Label for="text-card-rounded">{m.text_card_rounded()}</Label>
				</div>
				<div class="flex min-h-11 items-center gap-2">
					<Checkbox
						id="text-card-shadow"
						checked={values.text_card_shadow !== false}
						onCheckedChange={(value) => onChange('text_card_shadow', value === true)}
					/><Label for="text-card-shadow">{m.image_editor_drop_shadow()}</Label>
				</div>
			</div>
		</Disclosure>
	{/if}
</section>
