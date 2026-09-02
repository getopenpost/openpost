import { m } from '$lib/paraglide/messages';
import { getLocale, type Locale } from '$lib/paraglide/runtime';
import type { ThemeIconRole } from '$lib/themes';
import type { ThemePreviewScene } from './theme-preview-types.js';

interface NavigationItem {
	label: string;
	role: ThemeIconRole;
}

interface PreviewCard {
	title: string;
	status: string;
	color: string;
}

interface PreviewNotice {
	tone: 'success' | 'warning' | 'danger' | 'info';
	title: string;
	description: string;
}

export interface ThemePreviewCopy {
	scenes: Record<ThemePreviewScene, { eyebrow: string; title: string }>;
	desktopNavigation: NavigationItem[];
	mobileNavigation: NavigationItem[];
	previewNavigation: string;
	previewMobileNavigation: string;
	workspaceName: string;
	scheduledToday: string;
	allSystemsReady: string;
	date: string;
	createPost: string;
	draft: string;
	composerBody: string;
	composerDestinations: string;
	review: string;
	shellStatement: string;
	shellDescription: string;
	shellLayers: string[];
	cards: PreviewCard[];
	channels: string;
	tableHeaders: { publication: string; status: string; reach: string };
	tableRows: Array<{ publication: string; status: string; reach: string }>;
	settings: string[];
	workspaceDefault: string;
	enabled: string;
	workspaceNameLabel: string;
	defaultTimezone: string;
	cancel: string;
	saveChanges: string;
	deleteDraftLabel: string;
	deleteDraftTitle: string;
	deleteDraftDescription: string;
	keepDraft: string;
	delete: string;
	notices: PreviewNotice[];
	emptyTitle: string;
	emptyDescription: string;
	loadingWorkspace: string;
	loadingPublications: string;
	thisWeek: string;
	postCount: string;
	onTrack: string;
	readyToPublish: string;
	readyItems: string[];
}

function localizedDate(locale: Locale): string {
	return new Intl.DateTimeFormat(locale, {
		day: 'numeric',
		month: 'short',
		timeZone: 'UTC'
	}).format(new Date(Date.UTC(2026, 8, 12)));
}

function localizedCompactNumber(locale: Locale, value: number): string {
	return new Intl.NumberFormat(locale, {
		maximumFractionDigits: 1,
		notation: 'compact'
	}).format(value);
}

export function themePreviewCopy(locale: Locale = getLocale()): ThemePreviewCopy {
	const options = { locale } as const;
	const workspaceName = 'Northstar';
	return {
		scenes: {
			shell: {
				eyebrow: m.theme_preview_shell_eyebrow({}, options),
				title: workspaceName
			},
			dashboard: {
				eyebrow: m.theme_preview_dashboard_eyebrow({}, options),
				title: m.theme_preview_dashboard_title({}, options)
			},
			cards: {
				eyebrow: m.theme_preview_cards_eyebrow({}, options),
				title: m.theme_preview_cards_title({}, options)
			},
			composer: {
				eyebrow: m.theme_preview_composer_eyebrow({}, options),
				title: m.theme_preview_composer_title({}, options)
			},
			calendar: {
				eyebrow: m.theme_preview_calendar_eyebrow({}, options),
				title: m.theme_preview_calendar_title({}, options)
			},
			tables: {
				eyebrow: m.theme_preview_tables_eyebrow({}, options),
				title: m.theme_preview_tables_title({}, options)
			},
			settings: {
				eyebrow: m.theme_preview_settings_eyebrow({}, options),
				title: workspaceName
			},
			forms: {
				eyebrow: m.theme_preview_forms_eyebrow({}, options),
				title: m.theme_preview_forms_title({}, options)
			},
			dialog: {
				eyebrow: m.theme_preview_dialog_eyebrow({}, options),
				title: m.theme_preview_dialog_title({}, options)
			},
			notices: {
				eyebrow: m.theme_preview_notices_eyebrow({}, options),
				title: m.theme_preview_notices_title({}, options)
			},
			empty: {
				eyebrow: m.theme_preview_empty_eyebrow({}, options),
				title: m.theme_preview_empty_title({}, options)
			},
			loading: {
				eyebrow: m.theme_preview_loading_eyebrow({}, options),
				title: m.theme_preview_loading_title({}, options)
			},
			'image-editor': {
				eyebrow: m.theme_preview_image_editor_eyebrow({}, options),
				title: m.theme_preview_protected_editor_title({}, options)
			},
			'video-editor': {
				eyebrow: m.theme_preview_video_editor_eyebrow({}, options),
				title: m.theme_preview_protected_editor_title({}, options)
			}
		},
		desktopNavigation: [
			{ label: m.theme_preview_navigation_home({}, options), role: 'home' },
			{ label: m.theme_preview_navigation_compose({}, options), role: 'compose' },
			{ label: m.theme_preview_navigation_calendar({}, options), role: 'calendar' },
			{ label: m.theme_preview_navigation_media({}, options), role: 'media' }
		],
		mobileNavigation: [
			{ label: m.theme_preview_navigation_home({}, options), role: 'home' },
			{ label: m.theme_preview_navigation_new({}, options), role: 'compose' },
			{ label: m.theme_preview_navigation_plan({}, options), role: 'calendar' },
			{ label: m.theme_preview_navigation_media({}, options), role: 'media' },
			{ label: m.theme_preview_navigation_more({}, options), role: 'menu' }
		],
		previewNavigation: m.theme_preview_navigation_label({}, options),
		previewMobileNavigation: m.theme_preview_mobile_navigation_label({}, options),
		workspaceName,
		scheduledToday: m.theme_preview_scheduled_today({ count: 3 }, options),
		allSystemsReady: m.theme_preview_all_systems_ready({}, options),
		date: localizedDate(locale),
		createPost: m.theme_preview_create_post({}, options),
		draft: m.theme_preview_draft({}, options),
		composerBody: m.theme_preview_composer_body({}, options),
		composerDestinations: 'LinkedIn · Bluesky · Threads',
		review: m.theme_preview_review({}, options),
		shellStatement: m.theme_preview_shell_statement({}, options),
		shellDescription: m.theme_preview_shell_description({}, options),
		shellLayers: [
			m.theme_preview_layer_navigation({}, options),
			m.theme_preview_layer_content({}, options),
			m.theme_preview_layer_actions({}, options)
		],
		cards: [
			{
				title: m.theme_preview_item_launch_notes({}, options),
				status: m.theme_preview_status_ready({}, options),
				color: 'var(--chart-1)'
			},
			{
				title: m.theme_preview_item_behind_build({}, options),
				status: m.theme_preview_status_draft({}, options),
				color: 'var(--chart-2)'
			},
			{
				title: m.theme_preview_item_customer_lesson({}, options),
				status: m.theme_preview_status_scheduled({}, options),
				color: 'var(--chart-3)'
			}
		],
		channels: m.theme_preview_channels({ count: 2 }, options),
		tableHeaders: {
			publication: m.theme_preview_table_publication({}, options),
			status: m.theme_preview_table_status({}, options),
			reach: m.theme_preview_table_reach({}, options)
		},
		tableRows: [
			{
				publication: m.theme_preview_item_launch_notes({}, options),
				status: m.theme_preview_status_published({}, options),
				reach: localizedCompactNumber(locale, 12_400)
			},
			{
				publication: m.theme_preview_item_build_log({}, options),
				status: m.theme_preview_status_scheduled({}, options),
				reach: '—'
			},
			{
				publication: m.theme_preview_item_customer_lesson({}, options),
				status: m.theme_preview_status_draft({}, options),
				reach: '—'
			}
		],
		settings: [
			m.theme_preview_setting_timezone({}, options),
			m.theme_preview_setting_safeguards({}, options),
			m.theme_preview_setting_approvals({}, options),
			m.theme_preview_setting_notifications({}, options)
		],
		workspaceDefault: m.theme_preview_workspace_default({}, options),
		enabled: m.theme_preview_enabled({}, options),
		workspaceNameLabel: m.theme_preview_workspace_name({}, options),
		defaultTimezone: m.theme_preview_default_timezone({}, options),
		cancel: m.common_cancel({}, options),
		saveChanges: m.theme_preview_save_changes({}, options),
		deleteDraftLabel: m.theme_preview_delete_draft_label({}, options),
		deleteDraftTitle: m.theme_preview_delete_draft_title({}, options),
		deleteDraftDescription: m.theme_preview_delete_draft_description({}, options),
		keepDraft: m.theme_preview_keep_draft({}, options),
		delete: m.common_delete({}, options),
		notices: [
			{
				tone: 'success',
				title: m.theme_preview_notice_published_title({}, options),
				description: m.theme_preview_notice_published_description({}, options)
			},
			{
				tone: 'warning',
				title: m.theme_preview_notice_review_title({}, options),
				description: m.theme_preview_notice_review_description({}, options)
			},
			{
				tone: 'danger',
				title: m.theme_preview_notice_failed_title({}, options),
				description: m.theme_preview_notice_failed_description({}, options)
			},
			{
				tone: 'info',
				title: m.theme_preview_notice_saved_title({}, options),
				description: m.theme_preview_notice_saved_description({}, options)
			}
		],
		emptyTitle: m.theme_preview_empty_state_title({}, options),
		emptyDescription: m.theme_preview_empty_state_description({}, options),
		loadingWorkspace: m.theme_preview_loading_workspace({}, options),
		loadingPublications: m.theme_preview_loading_publications({}, options),
		thisWeek: m.theme_preview_this_week({}, options),
		postCount: m.theme_preview_post_count({ count: 12 }, options),
		onTrack: m.theme_preview_on_track({}, options),
		readyToPublish: m.theme_preview_ready_to_publish({}, options),
		readyItems: [
			m.theme_preview_item_launch_notes({}, options),
			m.theme_preview_item_behind_build({}, options),
			m.theme_preview_item_customer_lesson({}, options)
		]
	};
}
