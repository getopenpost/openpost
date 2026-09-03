<script lang="ts">
	import { Input } from '$lib/components/ui/input';
	import * as Select from '$lib/components/ui/select';
	import { m } from '$lib/paraglide/messages';
	import { getLocale, type Locale } from '$lib/paraglide/runtime';
	import {
		BUNDLED_THEME_FONTS,
		BUNDLED_THEME_FONT_IDS,
		THEME_BORDER_STYLES,
		THEME_CANVAS_TREATMENTS,
		THEME_COMPONENT_RECIPE_OPTIONS,
		THEME_DENSITIES,
		THEME_ICON_PACK_IDS,
		THEME_MOTION_RECIPE_KEYS,
		THEME_TYPOGRAPHY_ROLE_KEYS,
		type ThemeIconPackId,
		type ThemeManifest,
		type ThemeSchemeManifest,
		type ThemeShellTokens,
		type ThemeSpacingTokens,
		type ThemeTypographyRole
	} from '$lib/themes';
	import { themeColorGroups, themeComponentGroups } from './theme-editor-fields';
	import {
		themeEditorIconPackLabel,
		themeEditorTokenLabel,
		themeEditorValueLabel
	} from './theme-editor-presenter';
	import type { ThemeEditorSection } from './theme-editor-model';
	import type {
		ThemeMotionUpdater,
		ThemeTypographyUpdater,
		ThemeValueUpdater
	} from './theme-editor-types';

	interface Props {
		panel: ThemeEditorSection | 'icons';
		theme: ThemeManifest;
		manifest: ThemeSchemeManifest;
		onUpdateValue: ThemeValueUpdater;
		onUpdateTypography: ThemeTypographyUpdater;
		onUpdateFontFamily: (role: ThemeTypographyRole, family: string) => void;
		onUpdateMotion: ThemeMotionUpdater;
		onUpdateIconPack: (pack: ThemeIconPackId) => void;
		locale?: Locale;
	}

	let {
		panel,
		theme,
		manifest,
		onUpdateValue,
		onUpdateTypography,
		onUpdateFontFamily,
		onUpdateMotion,
		onUpdateIconPack,
		locale = getLocale()
	}: Props = $props();
	const colorGroups = $derived(themeColorGroups(locale));
	const componentGroups = $derived(themeComponentGroups(locale));

	const typographyFields = [
		['size', () => m.theme_editor_size()],
		['lineHeight', () => m.theme_editor_line_height()],
		['tracking', () => m.theme_editor_tracking()]
	] as const;
	const spacingFields = [
		['base', () => m.theme_editor_base_unit()],
		['controlHeight', () => m.theme_editor_control_height()],
		['compactControlHeight', () => m.theme_editor_compact_control_height()],
		['touchTarget', () => m.theme_editor_touch_target()],
		['pageGutter', () => m.theme_editor_page_gutter()],
		['sectionGap', () => m.theme_editor_section_gap()],
		['componentGap', () => m.theme_editor_component_gap()]
	] as const;
	const cornerFields = [
		['radius', () => m.theme_editor_base_radius()],
		['radiusSm', () => m.theme_editor_small_controls()],
		['radiusMd', () => m.theme_editor_controls()],
		['radiusLg', () => m.theme_editor_containers()],
		['radiusMedia', () => m.theme_editor_media()],
		['radiusPill', () => m.theme_editor_pills()],
		['borderWidth', () => m.theme_editor_border_width()]
	] as const;
	const elevationFields = [
		['card', () => m.theme_editor_resting_card()],
		['popover', () => m.theme_editor_popover()],
		['dialog', () => m.theme_editor_dialog()],
		['focalAction', () => m.theme_editor_focal_action()]
	] as const;
	const motionFields = [
		['duration', () => m.theme_editor_duration()],
		['easing', () => m.theme_editor_easing()],
		['distance', () => m.theme_editor_distance()]
	] as const;
	const shellFields = [
		['contentMaxWidth', () => m.theme_editor_content_width()],
		['sidebarWidth', () => m.theme_editor_sidebar_width()],
		['headerHeight', () => m.theme_editor_header_height()],
		['mobileNavigationHeight', () => m.theme_editor_mobile_navigation()]
	] as const;
</script>

{#if panel === 'colors'}
	<div class="space-y-3">
		{#each colorGroups as group (group.id)}
			<details
				class="rounded-[var(--theme-radius-md,var(--radius))] border border-border bg-card p-3"
				open={group.id === 'foundation'}
			>
				<summary data-theme-disclosure class="cursor-pointer text-sm font-semibold"
					>{group.label}</summary
				>
				<p class="mt-1 text-xs leading-relaxed text-muted-foreground">{group.description}</p>
				<div class="mt-3 grid gap-3">
					{#each group.fields as field (field)}
						<label class="grid gap-1.5 text-xs font-medium" for={`theme-color-${field}`}>
							<span>{themeEditorTokenLabel(field, locale)}</span>
							<span class="flex items-center gap-2">
								<span
									class="size-8 shrink-0 rounded-[var(--theme-radius-sm,var(--radius))] border border-border"
									style:background={manifest.colors[field]}
								></span>
								<Input
									id={`theme-color-${field}`}
									value={manifest.colors[field]}
									oninput={(event) => onUpdateValue('colors', field, event.currentTarget.value)}
									class="font-mono"
								/>
							</span>
						</label>
					{/each}
				</div>
			</details>
		{/each}
	</div>
{:else if panel === 'typography'}
	<div class="space-y-3">
		{#each THEME_TYPOGRAPHY_ROLE_KEYS as role (role)}
			{@const uploadedWeights = theme.fonts
				.filter(
					(font) => font.family === manifest.typography[role].family && font.style === 'normal'
				)
				.map((font) => font.weight)
				.sort((left, right) => left - right)}
			<details
				class="rounded-[var(--theme-radius-md,var(--radius))] border border-border bg-card p-3"
				open={role === 'body'}
			>
				<summary data-theme-disclosure class="cursor-pointer text-sm font-semibold"
					>{themeEditorTokenLabel(role, locale)}</summary
				>
				<div class="mt-3 grid gap-3">
					<label class="grid gap-1.5 text-xs font-medium">
						{m.theme_editor_family()}
						<Select.Root
							value={manifest.typography[role].family}
							onValueChange={(value) => value && onUpdateFontFamily(role, value)}
						>
							<Select.Trigger class="w-full">{manifest.typography[role].family}</Select.Trigger>
							<Select.Content>
								{#each BUNDLED_THEME_FONT_IDS as fontID (fontID)}
									{@const bundledFont = BUNDLED_THEME_FONTS[fontID]}
									<Select.Item value={bundledFont.family}>{bundledFont.label}</Select.Item>
								{/each}
								{#each [...new Set(theme.fonts
											.filter((font) => font.style === 'normal')
											.map((font) => font.family))] as family (family)}
									<Select.Item value={family}
										>{m.theme_editor_uploaded_family({ family })}</Select.Item
									>
								{/each}
							</Select.Content>
						</Select.Root>
						<span class="font-normal text-muted-foreground"
							>{manifest.typography[role].fallbacks.join(', ')}</span
						>
					</label>
					<div class="grid grid-cols-2 gap-3">
						<label class="grid gap-1.5 text-xs font-medium">
							{m.theme_editor_weight()}
							{#if uploadedWeights.length > 0}
								<Select.Root
									value={String(manifest.typography[role].weight)}
									onValueChange={(value) =>
										value && onUpdateTypography(role, 'weight', Number(value))}
								>
									<Select.Trigger class="w-full">{manifest.typography[role].weight}</Select.Trigger>
									<Select.Content>
										{#each uploadedWeights as weight (weight)}
											<Select.Item value={String(weight)}>{weight}</Select.Item>
										{/each}
									</Select.Content>
								</Select.Root>
							{:else}
								<Input
									type="number"
									min="100"
									max="900"
									step="100"
									value={manifest.typography[role].weight}
									oninput={(event) =>
										onUpdateTypography(role, 'weight', Number(event.currentTarget.value))}
								/>
							{/if}
						</label>
						{#each typographyFields as field (field[0])}
							<label class="grid gap-1.5 text-xs font-medium">
								{field[1]()}
								<Input
									value={String(manifest.typography[role][field[0]])}
									oninput={(event) => onUpdateTypography(role, field[0], event.currentTarget.value)}
								/>
							</label>
						{/each}
					</div>
				</div>
			</details>
		{/each}
	</div>
{:else if panel === 'spacing'}
	<div class="space-y-4">
		<label class="grid gap-1.5 text-xs font-medium">
			{m.theme_editor_density()}
			<Select.Root
				value={manifest.spacing.density}
				onValueChange={(value) => value && onUpdateValue('spacing', 'density', value)}
			>
				<Select.Trigger class="w-full"
					>{themeEditorValueLabel(manifest.spacing.density, locale)}</Select.Trigger
				>
				<Select.Content>
					{#each THEME_DENSITIES as value (value)}<Select.Item {value}
							>{themeEditorValueLabel(value, locale)}</Select.Item
						>{/each}
				</Select.Content>
			</Select.Root>
		</label>
		{#each spacingFields as field (field[0])}
			<label class="grid gap-1.5 text-xs font-medium">
				{field[1]()}
				<Input
					value={String(manifest.spacing[field[0] as keyof ThemeSpacingTokens])}
					oninput={(event) => onUpdateValue('spacing', field[0], event.currentTarget.value)}
				/>
			</label>
		{/each}
	</div>
{:else if panel === 'shape'}
	<div class="space-y-4">
		{#each cornerFields as field (field[0])}
			<label class="grid gap-1.5 text-xs font-medium">
				{field[1]()}
				<Input
					value={String(manifest.shape[field[0]])}
					oninput={(event) => onUpdateValue('shape', field[0], event.currentTarget.value)}
				/>
			</label>
		{/each}
		<label class="grid gap-1.5 text-xs font-medium">
			{m.theme_editor_border_style()}
			<Select.Root
				value={manifest.shape.borderStyle}
				onValueChange={(value) => value && onUpdateValue('shape', 'borderStyle', value)}
			>
				<Select.Trigger class="w-full"
					>{themeEditorValueLabel(manifest.shape.borderStyle, locale)}</Select.Trigger
				>
				<Select.Content>
					{#each THEME_BORDER_STYLES as value (value)}<Select.Item {value}
							>{themeEditorValueLabel(value, locale)}</Select.Item
						>{/each}
				</Select.Content>
			</Select.Root>
		</label>
	</div>
{:else if panel === 'elevation'}
	<div class="space-y-4">
		{#each elevationFields as field (field[0])}
			<label class="grid gap-1.5 text-xs font-medium">
				{field[1]()}
				<Input
					value={String(manifest.elevation[field[0]])}
					oninput={(event) => onUpdateValue('elevation', field[0], event.currentTarget.value)}
				/>
			</label>
		{/each}
	</div>
{:else if panel === 'motion'}
	<div class="space-y-3">
		{#each THEME_MOTION_RECIPE_KEYS as recipe (recipe)}
			<details
				class="rounded-[var(--theme-radius-md,var(--radius))] border border-border bg-card p-3"
				open={recipe === 'press'}
			>
				<summary data-theme-disclosure class="cursor-pointer text-sm font-semibold"
					>{themeEditorTokenLabel(recipe, locale)}</summary
				>
				<div class="mt-3 grid grid-cols-2 gap-3">
					{#each motionFields as field (field[0])}
						<label class="grid gap-1.5 text-xs font-medium">
							{field[1]()}
							<Input
								value={String(manifest.motion[recipe][field[0]])}
								oninput={(event) => onUpdateMotion(recipe, field[0], event.currentTarget.value)}
							/>
						</label>
					{/each}
					<label class="grid gap-1.5 text-xs font-medium">
						{m.theme_editor_opacity()}
						<Input
							type="number"
							min="0"
							max="1"
							step="0.05"
							value={manifest.motion[recipe].opacity}
							oninput={(event) =>
								onUpdateMotion(recipe, 'opacity', Number(event.currentTarget.value))}
						/>
					</label>
				</div>
			</details>
		{/each}
		<p class="text-xs leading-relaxed text-muted-foreground">
			{m.theme_editor_reduced_motion({
				mode: themeEditorValueLabel(manifest.motion.reducedMotion, locale)
			})}
		</p>
	</div>
{:else if panel === 'shell'}
	<div class="space-y-4">
		{#each shellFields as field (field[0])}
			<label class="grid gap-1.5 text-xs font-medium">
				{field[1]()}
				<Input
					value={String(manifest.shell[field[0] as keyof ThemeShellTokens])}
					oninput={(event) => onUpdateValue('shell', field[0], event.currentTarget.value)}
				/>
			</label>
		{/each}
		<label class="grid gap-1.5 text-xs font-medium">
			{m.theme_editor_canvas_treatment()}
			<Select.Root
				value={manifest.shell.canvasTreatment}
				onValueChange={(value) => value && onUpdateValue('shell', 'canvasTreatment', value)}
			>
				<Select.Trigger class="w-full"
					>{themeEditorValueLabel(manifest.shell.canvasTreatment, locale)}</Select.Trigger
				>
				<Select.Content>
					{#each THEME_CANVAS_TREATMENTS as value (value)}<Select.Item {value}
							>{themeEditorValueLabel(value, locale)}</Select.Item
						>{/each}
				</Select.Content>
			</Select.Root>
		</label>
	</div>
{:else if panel === 'components'}
	<div class="space-y-3">
		{#each componentGroups as group (group.id)}
			<details
				class="rounded-[var(--theme-radius-md,var(--radius))] border border-border bg-card p-3"
				open={group.id === 'actions-navigation'}
			>
				<summary data-theme-disclosure class="cursor-pointer text-sm font-semibold"
					>{group.label}</summary
				>
				<p class="mt-1 text-xs leading-relaxed text-muted-foreground">{group.description}</p>
				<div class="mt-3 grid gap-3">
					{#each group.fields as field (field)}
						<label class="grid gap-1.5 text-xs font-medium">
							{themeEditorTokenLabel(field, locale)}
							<Select.Root
								value={String(manifest.components[field])}
								onValueChange={(value) => value && onUpdateValue('components', field, value)}
							>
								<Select.Trigger class="w-full"
									>{themeEditorValueLabel(manifest.components[field], locale)}</Select.Trigger
								>
								<Select.Content>
									{#each THEME_COMPONENT_RECIPE_OPTIONS[field] as value (value)}
										<Select.Item {value}>{themeEditorValueLabel(value, locale)}</Select.Item>
									{/each}
								</Select.Content>
							</Select.Root>
						</label>
					{/each}
				</div>
			</details>
		{/each}
	</div>
{:else}
	<div class="space-y-4">
		<p class="text-sm leading-relaxed text-muted-foreground">
			{m.theme_editor_icons_description()}
		</p>
		<div class="space-y-2" role="group" aria-label={m.theme_editor_icon_pack()}>
			{#each THEME_ICON_PACK_IDS as pack (pack)}
				<button
					type="button"
					aria-pressed={theme.iconPack === pack}
					class="flex min-h-11 w-full items-center justify-between rounded-[var(--theme-radius-md,var(--radius))] border border-border px-3 text-left text-sm font-medium focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none aria-pressed:border-ring aria-pressed:bg-accent"
					onclick={() => onUpdateIconPack(pack)}
				>
					<span>{themeEditorIconPackLabel(pack, locale)}</span>
					<span class="text-xs text-muted-foreground">{m.theme_editor_complete_pack()}</span>
				</button>
			{/each}
		</div>
	</div>
{/if}
