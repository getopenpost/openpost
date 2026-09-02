import type { ThemeColorToken, ThemeComponentRecipe } from '$lib/themes';
import { m } from '$lib/paraglide/messages';

export interface ThemeEditorFieldGroup<Field extends string> {
	id: string;
	label: string;
	description: string;
	fields: readonly Field[];
}

export const THEME_COLOR_GROUPS: readonly ThemeEditorFieldGroup<ThemeColorToken>[] = [
	{
		id: 'foundation',
		label: m.theme_editor_group_foundation(),
		description: m.theme_editor_group_foundation_description(),
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
		label: m.theme_editor_group_identity(),
		description: m.theme_editor_group_identity_description(),
		fields: ['brand', 'brandInk', 'workspace', 'workspaceInk']
	},
	{
		id: 'feedback',
		label: m.theme_editor_group_feedback(),
		description: m.theme_editor_group_feedback_description(),
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
		label: m.theme_editor_group_actions(),
		description: m.theme_editor_group_actions_description(),
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
		label: m.theme_editor_group_controls(),
		description: m.theme_editor_group_controls_description(),
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
		label: m.theme_editor_group_chrome(),
		description: m.theme_editor_group_chrome_description(),
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
		label: m.theme_editor_group_charts(),
		description: m.theme_editor_group_charts_description(),
		fields: ['chart1', 'chart2', 'chart3', 'chart4', 'chart5']
	}
];

export const THEME_COMPONENT_GROUPS: readonly ThemeEditorFieldGroup<ThemeComponentRecipe>[] = [
	{
		id: 'actions-navigation',
		label: m.theme_editor_group_actions_navigation(),
		description: m.theme_editor_group_actions_navigation_description(),
		fields: ['button', 'link', 'tabs', 'navigation']
	},
	{
		id: 'form-controls',
		label: m.theme_editor_group_form_controls(),
		description: m.theme_editor_group_form_controls_description(),
		fields: ['input', 'select', 'switch', 'checkbox', 'radio']
	},
	{
		id: 'content',
		label: m.theme_editor_group_content(),
		description: m.theme_editor_group_content_description(),
		fields: ['card', 'container', 'table', 'list', 'badge', 'chip', 'pagination']
	},
	{
		id: 'temporary-layers',
		label: m.theme_editor_group_layers(),
		description: m.theme_editor_group_layers_description(),
		fields: ['dialog', 'popover', 'toast', 'toolbar']
	},
	{
		id: 'states-decoration',
		label: m.theme_editor_group_states(),
		description: m.theme_editor_group_states_description(),
		fields: ['emptyState', 'loadingState', 'editorChrome', 'decoration']
	}
];
