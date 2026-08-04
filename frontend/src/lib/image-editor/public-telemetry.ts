export type PublicImageEditorEvent =
	| 'image_editor_public_view'
	| 'image_editor_design_started'
	| 'image_editor_meaningful_edit'
	| 'image_editor_export_completed'
	| 'image_editor_signup_clicked'
	| 'image_editor_signup_completed'
	| 'image_editor_workspace_import_completed';

type UmamiWindow = Window & {
	umami?: {
		track(name: string, data?: Record<string, string | number | boolean>): void;
	};
};

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
	(window as UmamiWindow).umami?.track(name, safeData);
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
