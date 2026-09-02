import type { ThemeColorToken, ThemeComponentRecipe } from '$lib/themes';

export interface ThemeEditorFieldGroup<Field extends string> {
	id: string;
	label: string;
	description: string;
	fields: readonly Field[];
}

export const THEME_COLOR_GROUPS: readonly ThemeEditorFieldGroup<ThemeColorToken>[] = [
	{
		id: 'foundation',
		label: 'Foundation',
		description: 'Canvas, text, surfaces, borders, focus, and selection.',
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
		label: 'Identity',
		description: 'Organization expression and protected workspace recognition.',
		fields: ['brand', 'brandInk', 'workspace', 'workspaceInk']
	},
	{
		id: 'feedback',
		label: 'Feedback',
		description: 'Meaning stays consistent across success, warning, error, and information.',
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
		label: 'Actions',
		description: 'Focal, primary, ordinary, quiet, destructive, and link treatments.',
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
		label: 'Controls',
		description: 'Fields, disabled content, card hover, and their interactive states.',
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
		label: 'Navigation and chrome',
		description: 'Navigation, sidebar, app chrome, and browser surfaces.',
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
		label: 'Charts',
		description: 'Ordered data-series colors. They do not replace status colors.',
		fields: ['chart1', 'chart2', 'chart3', 'chart4', 'chart5']
	}
];

export const THEME_COMPONENT_GROUPS: readonly ThemeEditorFieldGroup<ThemeComponentRecipe>[] = [
	{
		id: 'actions-navigation',
		label: 'Actions and navigation',
		description: 'Buttons, links, tabs, and navigation.',
		fields: ['button', 'link', 'tabs', 'navigation']
	},
	{
		id: 'form-controls',
		label: 'Form controls',
		description: 'Inputs, selects, switches, checkboxes, and radios.',
		fields: ['input', 'select', 'switch', 'checkbox', 'radio']
	},
	{
		id: 'content',
		label: 'Content',
		description: 'Cards, containers, tables, lists, badges, chips, and pagination.',
		fields: ['card', 'container', 'table', 'list', 'badge', 'chip', 'pagination']
	},
	{
		id: 'temporary-layers',
		label: 'Temporary layers',
		description: 'Dialogs, popovers, toasts, and toolbars.',
		fields: ['dialog', 'popover', 'toast', 'toolbar']
	},
	{
		id: 'states-decoration',
		label: 'States and decoration',
		description: 'Empty, loading, editor chrome, and bounded decoration recipes.',
		fields: ['emptyState', 'loadingState', 'editorChrome', 'decoration']
	}
];
