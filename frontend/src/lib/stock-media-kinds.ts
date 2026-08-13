export type StockMediaKind = 'photo' | 'video';
export type StockMediaAccept = StockMediaKind | 'both';

export function stockMediaKindsForProvider(
	provider: { photos: boolean; videos: boolean } | undefined,
	accept: StockMediaAccept
): StockMediaKind[] {
	if (!provider) return [];
	return [
		...(accept !== 'video' && provider.photos ? (['photo'] as const) : []),
		...(accept !== 'photo' && provider.videos ? (['video'] as const) : [])
	];
}

export function stockMediaKindsForProviders(
	providers: readonly { photos: boolean; videos: boolean }[],
	accept: StockMediaAccept
): StockMediaKind[] {
	const available = new Set<StockMediaKind>();
	for (const provider of providers) {
		for (const kind of stockMediaKindsForProvider(provider, accept)) available.add(kind);
	}
	return (['photo', 'video'] as StockMediaKind[]).filter((kind) => available.has(kind));
}
