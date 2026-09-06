import { m } from '$lib/paraglide/messages';
import { getLocale, type Locale } from '$lib/paraglide/runtime';
import type { ThemeColorToken, ThemeComponentRecipe } from '$lib/themes';

export interface ThemeEditorFieldGroup<Field extends string> {
	id: string;
	label: string;
	description: string;
	fields: readonly Field[];
}

interface ThemeEditorFieldGroupDefinition<Field extends string> {
	id: string;
	label: (locale: Locale) => string;
	description: (locale: Locale) => string;
	fields: readonly Field[];
}

const colorGroupDefinitions: readonly ThemeEditorFieldGroupDefinition<ThemeColorToken>[] = [
	{
		id: 'foundation',
		label: (locale) => m.theme_editor_group_foundation({}, { locale }),
		description: (locale) => m.theme_editor_group_foundation_description({}, { locale }),
		fields: [
			'canvas',
			'ink',
			'surface',
			'surfaceRaised',
			'surfaceSunken',
			'mutedInk',
			'border',
			'input',
			'focus',
			'selection',
			'selectionInk',
			'caret',
			'link'
		]
	},
	{
		id: 'identity',
		label: (locale) => m.theme_editor_group_identity({}, { locale }),
		description: (locale) => m.theme_editor_group_identity_description({}, { locale }),
		fields: ['brand', 'brandInk', 'workspace', 'workspaceInk']
	},
	{
		id: 'feedback',
		label: (locale) => m.theme_editor_group_feedback({}, { locale }),
		description: (locale) => m.theme_editor_group_feedback_description({}, { locale }),
		fields: [
			'danger',
			'dangerInk',
			'success',
			'successInk',
			'warning',
			'warningInk',
			'info',
			'infoInk'
		]
	},
	{
		id: 'actions',
		label: (locale) => m.theme_editor_group_actions({}, { locale }),
		description: (locale) => m.theme_editor_group_actions_description({}, { locale }),
		fields: [
			'actionFocal',
			'actionFocalInk',
			'actionFocalHover',
			'actionFocalActive',
			'actionPrimary',
			'actionPrimaryInk',
			'actionPrimaryHover',
			'actionPrimaryActive',
			'actionOrdinary',
			'actionOrdinaryInk',
			'actionOrdinaryBorder',
			'actionOrdinaryHover',
			'actionOrdinaryActive',
			'actionQuiet',
			'actionQuietInk',
			'actionQuietHover',
			'actionQuietActive',
			'actionDestructive',
			'actionDestructiveInk',
			'actionDestructiveHover',
			'actionDestructiveActive',
			'actionLink',
			'actionLinkHover'
		]
	},
	{
		id: 'controls',
		label: (locale) => m.theme_editor_group_controls({}, { locale }),
		description: (locale) => m.theme_editor_group_controls_description({}, { locale }),
		fields: [
			'disabled',
			'disabledInk',
			'field',
			'fieldInk',
			'fieldBorder',
			'fieldHover',
			'fieldFocus',
			'fieldDisabled',
			'fieldDisabledInk',
			'cardHover'
		]
	},
	{
		id: 'chrome',
		label: (locale) => m.theme_editor_group_chrome({}, { locale }),
		description: (locale) => m.theme_editor_group_chrome_description({}, { locale }),
		fields: [
			'navigationHover',
			'navigationActive',
			'navigationActiveInk',
			'sidebar',
			'sidebarInk',
			'sidebarActive',
			'sidebarActiveInk',
			'sidebarBorder',
			'chrome',
			'chromeInk',
			'browserSurface',
			'browserChrome',
			'overlay',
			'scrim'
		]
	},
	{
		id: 'charts',
		label: (locale) => m.theme_editor_group_charts({}, { locale }),
		description: (locale) => m.theme_editor_group_charts_description({}, { locale }),
		fields: ['chart1', 'chart2', 'chart3', 'chart4', 'chart5']
	}
];

const componentGroupDefinitions: readonly ThemeEditorFieldGroupDefinition<ThemeComponentRecipe>[] =
	[
		{
			id: 'actions-navigation',
			label: (locale) => m.theme_editor_group_actions_navigation({}, { locale }),
			description: (locale) => m.theme_editor_group_actions_navigation_description({}, { locale }),
			fields: ['button', 'link', 'tabs', 'navigation']
		},
		{
			id: 'form-controls',
			label: (locale) => m.theme_editor_group_form_controls({}, { locale }),
			description: (locale) => m.theme_editor_group_form_controls_description({}, { locale }),
			fields: ['input', 'select', 'switch', 'checkbox', 'radio']
		},
		{
			id: 'content',
			label: (locale) => m.theme_editor_group_content({}, { locale }),
			description: (locale) => m.theme_editor_group_content_description({}, { locale }),
			fields: ['card', 'container', 'table', 'list', 'badge', 'chip', 'pagination']
		},
		{
			id: 'temporary-layers',
			label: (locale) => m.theme_editor_group_layers({}, { locale }),
			description: (locale) => m.theme_editor_group_layers_description({}, { locale }),
			fields: ['dialog', 'popover', 'toast', 'toolbar']
		},
		{
			id: 'states-decoration',
			label: (locale) => m.theme_editor_group_states({}, { locale }),
			description: (locale) => m.theme_editor_group_states_description({}, { locale }),
			fields: ['emptyState', 'loadingState', 'editorChrome', 'decoration']
		}
	];

function localizeGroups<Field extends string>(
	definitions: readonly ThemeEditorFieldGroupDefinition<Field>[],
	locale: Locale
): readonly ThemeEditorFieldGroup<Field>[] {
	return definitions.map((group) => ({
		id: group.id,
		label: group.label(locale),
		description: group.description(locale),
		fields: group.fields
	}));
}

export function themeColorGroups(locale: Locale = getLocale()) {
	return localizeGroups(colorGroupDefinitions, locale);
}

export function themeComponentGroups(locale: Locale = getLocale()) {
	return localizeGroups(componentGroupDefinitions, locale);
}
