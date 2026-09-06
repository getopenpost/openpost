export function editorFontAssetFamily(family: string, assetID: string): string {
	const safeAssetID = assetID.replace(/[^a-z0-9_-]/gi, '_');
	const safeFamily = family.replace(/[^a-z0-9_-]/gi, '_');
	return `OpenPostProject_${safeAssetID}_${safeFamily}`;
}
