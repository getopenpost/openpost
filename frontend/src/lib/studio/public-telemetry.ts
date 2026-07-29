export type PublicStudioEvent =
	| 'studio_public_view'
	| 'studio_design_started'
	| 'studio_meaningful_edit'
	| 'studio_export_completed'
	| 'studio_signup_clicked'
	| 'studio_signup_completed'
	| 'studio_workspace_import_completed';

type UmamiWindow = Window & {
	umami?: {
		track(name: string, data?: Record<string, string | number | boolean>): void;
	};
};

export function trackPublicStudioEvent(
	name: PublicStudioEvent,
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
		new CustomEvent('openpost:public-studio-event', { detail: { name, data: safeData } })
	);
}

export function publicStudioPageCountBucket(count: number): string {
	if (count <= 1) return '1';
	if (count <= 5) return '2-5';
	if (count <= 10) return '6-10';
	return '11+';
}
