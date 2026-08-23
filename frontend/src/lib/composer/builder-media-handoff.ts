export type BuilderMediaHandoffKind = 'meme' | 'image' | 'video';

export interface BuilderMediaHandoff {
	kind: BuilderMediaHandoffKind;
	brief: string;
	accountId?: string;
	sourceMediaId: string;
	sourceLabel: string;
}

const handoffParameters = [
	'builder_media',
	'builder_media_brief',
	'builder_media_account',
	'builder_media_source',
	'builder_media_source_label'
] as const;

export function createBuilderMediaHandoffSearch(
	handoff: Omit<BuilderMediaHandoff, 'sourceMediaId' | 'sourceLabel'> &
		Partial<Pick<BuilderMediaHandoff, 'sourceMediaId' | 'sourceLabel'>>
): URLSearchParams {
	const search = new URLSearchParams({
		builder_media: handoff.kind,
		builder_media_brief: handoff.brief.trim().slice(0, 1000)
	});
	if (handoff.sourceMediaId?.trim()) {
		search.set('builder_media_source', handoff.sourceMediaId.trim().slice(0, 200));
	}
	if (handoff.accountId?.trim()) {
		search.set('builder_media_account', handoff.accountId.trim().slice(0, 200));
	}
	if (handoff.sourceLabel?.trim()) {
		search.set('builder_media_source_label', handoff.sourceLabel.trim().slice(0, 240));
	}
	return search;
}

export function parseBuilderMediaHandoff(url: URL): BuilderMediaHandoff | null {
	const kind = url.searchParams.get('builder_media');
	if (kind !== 'meme' && kind !== 'image' && kind !== 'video') return null;
	return {
		kind,
		brief: (url.searchParams.get('builder_media_brief') ?? '').trim().slice(0, 1000),
		accountId:
			(url.searchParams.get('builder_media_account') ?? '').trim().slice(0, 200) || undefined,
		sourceMediaId: (url.searchParams.get('builder_media_source') ?? '').trim().slice(0, 200),
		sourceLabel: (url.searchParams.get('builder_media_source_label') ?? '').trim().slice(0, 240)
	};
}

export function clearBuilderMediaHandoff(url: URL): URL {
	const clean = new URL(url);
	for (const parameter of handoffParameters) clean.searchParams.delete(parameter);
	return clean;
}
