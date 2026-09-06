import { m } from '$lib/paraglide/messages';
import { getLocale, type Locale } from '$lib/paraglide/runtime';
import { ThemeEditorValidationError } from './theme-editor-model';

type LabelMessage = (inputs?: Record<string, never>, options?: { locale?: Locale }) => string;

const tokenMessages = {
	canvas: m.theme_token_canvas,
	ink: m.theme_token_ink,
	surface: m.theme_token_surface,
	surfaceRaised: m.theme_token_surface_raised,
	surfaceSunken: m.theme_token_surface_sunken,
	mutedInk: m.theme_token_muted_ink,
	border: m.theme_token_border,
	input: m.theme_token_input,
	focus: m.theme_token_focus,
	selection: m.theme_token_selection,
	selectionInk: m.theme_token_selection_ink,
	caret: m.theme_token_caret,
	link: m.theme_token_link,
	brand: m.theme_token_brand,
	brandInk: m.theme_token_brand_ink,
	workspace: m.theme_token_workspace,
	workspaceInk: m.theme_token_workspace_ink,
	overlay: m.theme_token_overlay,
	scrim: m.theme_token_scrim,
	danger: m.theme_token_danger,
	dangerInk: m.theme_token_danger_ink,
	success: m.theme_token_success,
	successInk: m.theme_token_success_ink,
	warning: m.theme_token_warning,
	warningInk: m.theme_token_warning_ink,
	info: m.theme_token_info,
	infoInk: m.theme_token_info_ink,
	actionFocal: m.theme_token_action_focal,
	actionFocalInk: m.theme_token_action_focal_ink,
	actionFocalHover: m.theme_token_action_focal_hover,
	actionFocalActive: m.theme_token_action_focal_active,
	actionPrimary: m.theme_token_action_primary,
	actionPrimaryInk: m.theme_token_action_primary_ink,
	actionPrimaryHover: m.theme_token_action_primary_hover,
	actionPrimaryActive: m.theme_token_action_primary_active,
	actionOrdinary: m.theme_token_action_ordinary,
	actionOrdinaryInk: m.theme_token_action_ordinary_ink,
	actionOrdinaryBorder: m.theme_token_action_ordinary_border,
	actionOrdinaryHover: m.theme_token_action_ordinary_hover,
	actionOrdinaryActive: m.theme_token_action_ordinary_active,
	actionQuiet: m.theme_token_action_quiet,
	actionQuietInk: m.theme_token_action_quiet_ink,
	actionQuietHover: m.theme_token_action_quiet_hover,
	actionQuietActive: m.theme_token_action_quiet_active,
	actionDestructive: m.theme_token_action_destructive,
	actionDestructiveInk: m.theme_token_action_destructive_ink,
	actionDestructiveHover: m.theme_token_action_destructive_hover,
	actionDestructiveActive: m.theme_token_action_destructive_active,
	actionLink: m.theme_token_action_link,
	actionLinkHover: m.theme_token_action_link_hover,
	disabled: m.theme_token_disabled,
	disabledInk: m.theme_token_disabled_ink,
	field: m.theme_token_field,
	fieldInk: m.theme_token_field_ink,
	fieldBorder: m.theme_token_field_border,
	fieldHover: m.theme_token_field_hover,
	fieldFocus: m.theme_token_field_focus,
	fieldDisabled: m.theme_token_field_disabled,
	fieldDisabledInk: m.theme_token_field_disabled_ink,
	cardHover: m.theme_token_card_hover,
	navigationHover: m.theme_token_navigation_hover,
	navigationActive: m.theme_token_navigation_active,
	navigationActiveInk: m.theme_token_navigation_active_ink,
	sidebar: m.theme_token_sidebar,
	sidebarInk: m.theme_token_sidebar_ink,
	sidebarActive: m.theme_token_sidebar_active,
	sidebarActiveInk: m.theme_token_sidebar_active_ink,
	sidebarBorder: m.theme_token_sidebar_border,
	chrome: m.theme_token_chrome,
	chromeInk: m.theme_token_chrome_ink,
	browserSurface: m.theme_token_browser_surface,
	browserChrome: m.theme_token_browser_chrome,
	chart1: m.theme_token_chart_1,
	chart2: m.theme_token_chart_2,
	chart3: m.theme_token_chart_3,
	chart4: m.theme_token_chart_4,
	chart5: m.theme_token_chart_5,
	display: m.theme_token_type_display,
	title: m.theme_token_type_title,
	body: m.theme_token_type_body,
	label: m.theme_token_type_label,
	metadata: m.theme_token_type_metadata,
	code: m.theme_token_type_code,
	press: m.theme_token_motion_press,
	hover: m.theme_token_motion_hover,
	entry: m.theme_token_motion_entry,
	exit: m.theme_token_motion_exit,
	loading: m.theme_token_motion_loading,
	pageTransition: m.theme_token_motion_page_transition,
	button: m.theme_token_component_button,
	tabs: m.theme_token_component_tabs,
	navigation: m.theme_token_component_navigation,
	select: m.theme_token_component_select,
	switch: m.theme_token_component_switch,
	checkbox: m.theme_token_component_checkbox,
	radio: m.theme_token_component_radio,
	card: m.theme_token_component_card,
	container: m.theme_token_component_container,
	table: m.theme_token_component_table,
	list: m.theme_token_component_list,
	badge: m.theme_token_component_badge,
	chip: m.theme_token_component_chip,
	dialog: m.theme_token_component_dialog,
	popover: m.theme_token_component_popover,
	toast: m.theme_token_component_toast,
	toolbar: m.theme_token_component_toolbar,
	pagination: m.theme_token_component_pagination,
	emptyState: m.theme_token_component_empty_state,
	loadingState: m.theme_token_component_loading_state,
	editorChrome: m.theme_token_component_editor_chrome,
	decoration: m.theme_token_component_decoration,
	'background-texture': m.theme_token_asset_background_texture,
	'sidebar-decoration': m.theme_token_asset_sidebar_decoration,
	'header-decoration': m.theme_token_asset_header_decoration,
	'empty-state-illustration': m.theme_token_asset_empty_state_illustration,
	'loading-illustration': m.theme_token_asset_loading_illustration
} satisfies Record<string, LabelMessage>;

const valueMessages = {
	compact: m.theme_value_compact,
	comfortable: m.theme_value_comfortable,
	spacious: m.theme_value_spacious,
	solid: m.theme_value_solid,
	dashed: m.theme_value_dashed,
	plain: m.theme_value_plain,
	paper: m.theme_value_paper,
	playful: m.theme_value_playful,
	garden: m.theme_value_garden,
	study: m.theme_value_study,
	tactile: m.theme_value_tactile,
	precision: m.theme_value_precision,
	instant: m.theme_value_instant,
	crossfade: m.theme_value_crossfade,
	tonal: m.theme_value_tonal,
	outlined: m.theme_value_outlined,
	precise: m.theme_value_precise,
	underlined: m.theme_value_underlined,
	subtle: m.theme_value_subtle,
	underline: m.theme_value_underline,
	pill: m.theme_value_pill,
	segmented: m.theme_value_segmented,
	quiet: m.theme_value_quiet,
	filled: m.theme_value_filled,
	flat: m.theme_value_flat,
	lifted: m.theme_value_lifted,
	tinted: m.theme_value_tinted,
	ruled: m.theme_value_ruled,
	striped: m.theme_value_striped,
	divided: m.theme_value_divided,
	spaced: m.theme_value_spaced,
	elevated: m.theme_value_elevated,
	floating: m.theme_value_floating,
	illustrated: m.theme_value_illustrated,
	framed: m.theme_value_framed,
	spinner: m.theme_value_spinner,
	pulse: m.theme_value_pulse,
	skeleton: m.theme_value_skeleton,
	neutral: m.theme_value_neutral,
	none: m.theme_value_none,
	editorial: m.theme_value_editorial,
	botanical: m.theme_value_botanical,
	normal: m.theme_value_normal,
	italic: m.theme_value_italic,
	swap: m.theme_value_swap,
	fallback: m.theme_value_fallback,
	optional: m.theme_value_optional
} satisfies Record<string, LabelMessage>;

const iconPackMessages = {
	lucide: m.theme_icon_pack_lucide,
	'heroicons-outline': m.theme_icon_pack_heroicons_outline,
	'heroicons-solid': m.theme_icon_pack_heroicons_solid,
	phosphor: m.theme_icon_pack_phosphor,
	tabler: m.theme_icon_pack_tabler
} satisfies Record<string, LabelMessage>;

const builtInDescriptionMessages = {
	workshop: m.theme_builtin_workshop_description,
	studio: m.theme_builtin_studio_description,
	notebook: m.theme_builtin_notebook_description,
	playroom: m.theme_builtin_playroom_description,
	'cloud-garden': m.theme_builtin_cloud_garden_description,
	'study-hall': m.theme_builtin_study_hall_description,
	corkboard: m.theme_builtin_corkboard_description,
	midnight: m.theme_builtin_midnight_description
} satisfies Record<string, LabelMessage>;

function labelFor(labels: Record<string, LabelMessage>, value: string, locale: Locale): string {
	const message = labels[value];
	return message ? message({}, { locale }) : value;
}

export function themeEditorTokenLabel(value: string, locale: Locale = getLocale()): string {
	return labelFor(tokenMessages, value, locale);
}

export function themeEditorValueLabel(value: string, locale: Locale = getLocale()): string {
	return labelFor(valueMessages, value, locale);
}

export function themeEditorIconPackLabel(value: string, locale: Locale = getLocale()): string {
	return labelFor(iconPackMessages, value, locale);
}

export function themeBuiltInDescription(id: string, locale: Locale = getLocale()): string {
	return labelFor(builtInDescriptionMessages, id, locale);
}

export function themeSchemeLabel(scheme: string, locale: Locale = getLocale()): string {
	const options = { locale } as const;
	if (scheme === 'light') return m.sidebar_appearance_light({}, options);
	if (scheme === 'dark') return m.sidebar_appearance_dark({}, options);
	return scheme;
}

export function parseThemeEditorValidationMessage(
	error: unknown,
	locale: Locale = getLocale()
): string {
	const options = { locale } as const;
	if (!(error instanceof ThemeEditorValidationError)) {
		return error instanceof Error
			? error.message
			: m.theme_validation_manifest_invalid({}, options);
	}
	const value = (key: string) => String(error.values[key] ?? '');
	const scheme = (key = 'scheme') => themeSchemeLabel(value(key), locale);
	switch (error.code) {
		case 'scheme_unsupported':
			return m.theme_validation_scheme_unsupported(
				{ scheme: scheme(), name: value('name') },
				options
			);
		case 'scheme_not_shared':
			return m.theme_validation_scheme_not_shared({ scheme: scheme() }, options);
		case 'theme_id':
			return m.theme_validation_theme_id({}, options);
		case 'theme_name':
			return m.theme_validation_theme_name({}, options);
		case 'manifest_size':
			return m.theme_validation_manifest_size({}, options);
		case 'invalid_json':
			return m.theme_validation_invalid_json({}, options);
		case 'manifest_object':
			return m.theme_validation_manifest_object({}, options);
		case 'schema_version':
			return m.theme_validation_schema_version({}, options);
		case 'id':
			return m.theme_validation_id({}, options);
		case 'revision':
			return m.theme_validation_revision({}, options);
		case 'name':
			return m.theme_validation_name({}, options);
		case 'description':
			return m.theme_validation_description({}, options);
		case 'icon_pack':
			return m.theme_validation_icon_pack({}, options);
		case 'supported_schemes_empty':
			return m.theme_validation_supported_schemes_empty({}, options);
		case 'unsupported_scheme':
			return m.theme_validation_unsupported_scheme({ scheme: scheme() }, options);
		case 'duplicate_scheme':
			return m.theme_validation_duplicate_scheme({ scheme: scheme() }, options);
		case 'incomplete_scheme':
			return m.theme_validation_incomplete_scheme({ scheme: scheme() }, options);
		case 'undeclared_scheme':
			return m.theme_validation_undeclared_scheme({ scheme: scheme() }, options);
		case 'scheme_order':
			return m.theme_validation_scheme_order({}, options);
		case 'resource_arrays':
			return m.theme_validation_resource_arrays({}, options);
		case 'character_limit':
			return m.theme_validation_character_limit({}, options);
		case 'unknown_fields':
			return m.theme_validation_unknown_fields({ fields: value('fields') }, options);
		case 'required_field':
			return m.theme_validation_required_field({ field: value('field') }, options);
		case 'resource_limit':
			return m.theme_validation_resource_limit({}, options);
		case 'invalid_font':
			return m.theme_validation_invalid_font({ index: value('index') }, options);
		case 'duplicate_font':
			return m.theme_validation_duplicate_font({}, options);
		case 'invalid_asset':
			return m.theme_validation_invalid_asset({ index: value('index') }, options);
		case 'duplicate_asset':
			return m.theme_validation_duplicate_asset({}, options);
		case 'missing_font_face':
			return m.theme_validation_missing_font_face(
				{ scheme: scheme(), role: themeEditorTokenLabel(value('role'), locale) },
				options
			);
		case 'random_seed':
			return m.theme_validation_random_seed({}, options);
	}
}

const externalErrorMessages = {
	'The draft changed on another device': m.theme_error_draft_changed,
	'The workspace changed on another device': m.theme_error_workspace_changed,
	'themes are unavailable': m.theme_error_unavailable,
	'invalid theme input': m.theme_error_invalid_input,
	'invalid theme manifest': m.theme_error_invalid_manifest,
	'theme not found': m.theme_error_not_found,
	'theme is inaccessible': m.theme_error_inaccessible,
	'theme conflicts with existing state': m.theme_error_conflict,
	'theme revision changed': m.theme_error_revision_changed,
	'workspace theme assignment is locked': m.theme_error_assignment_locked,
	'theme is assigned or is the organization default': m.theme_error_in_use,
	'built-in themes are immutable': m.theme_error_builtin_immutable,
	'theme does not support the requested color scheme': m.theme_error_scheme_unsupported,
	'invalid theme asset': m.theme_error_invalid_asset
} satisfies Record<string, LabelMessage>;

export function parseThemeExternalErrorMessage(
	error: unknown,
	fallback: string,
	locale: Locale = getLocale()
): string {
	if (!(error instanceof Error)) return fallback;
	const message = externalErrorMessages[error.message];
	return message ? message({}, { locale }) : fallback;
}

export function themeValidationIssueMessage(locale: Locale = getLocale()): string {
	return m.theme_validation_review_value({}, { locale });
}
