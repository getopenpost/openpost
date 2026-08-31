export const EDIT_INSPECTOR_TABS = ['properties', 'motion', 'effects', 'transcript'] as const;

export type EditInspectorTab = (typeof EDIT_INSPECTOR_TABS)[number];

export function resolveEditInspectorTabs({
	hasSelection,
	supportsMotion,
	supportsEffects,
	isMedia
}: {
	hasSelection: boolean;
	supportsMotion: boolean;
	supportsEffects: boolean;
	isMedia: boolean;
}): EditInspectorTab[] {
	if (!hasSelection) return [];

	const tabs: EditInspectorTab[] = ['properties'];
	if (supportsMotion) tabs.push('motion');
	if (supportsEffects) tabs.push('effects');
	if (isMedia) tabs.push('transcript');
	return tabs;
}
