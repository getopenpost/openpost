import { captureTelemetryEvent, type TelemetryEventName } from '@openpost/telemetry';

export type PublicImageEditorEvent =
	| 'image_editor_public_view'
	| 'image_editor_design_started'
	| 'image_editor_meaningful_edit'
	| 'image_editor_export_completed'
	| 'image_editor_signup_clicked'
	| 'image_editor_signup_completed'
	| 'image_editor_workspace_import_completed';

const postHogEventNames = {
	image_editor_public_view: 'public image editor viewed',
	image_editor_design_started: 'public image design started',
	image_editor_meaningful_edit: 'public image editor meaningful edit',
	image_editor_export_completed: 'public image export completed',
	image_editor_signup_clicked: 'public image editor signup clicked',
	image_editor_signup_completed: 'public image editor signup completed',
	image_editor_workspace_import_completed: 'public image workspace import completed'
} as const satisfies Record<PublicImageEditorEvent, TelemetryEventName>;

export function trackPublicImageEditorEvent(
	name: PublicImageEditorEvent,
	data: Record<string, string | number | boolean> = {}
): void {
	if (typeof window === 'undefined') return;
	const safeData = Object.fromEntries(
		Object.entries(data).filter(([, value]) =>
			['string', 'number', 'boolean'].includes(typeof value)
		)
	);
	captureTelemetryEvent(postHogEventNames[name], safeData);
	window.dispatchEvent(
		new CustomEvent('openpost:public-image-editor-event', { detail: { name, data: safeData } })
	);
}

export function publicImageEditorPageCountBucket(count: number): string {
	if (count <= 1) return '1';
	if (count <= 5) return '2-5';
	if (count <= 10) return '6-10';
	return '11+';
}
