export function canAttachImageEditorPreview(
	requestedGeneration: number,
	currentGeneration: number,
	pageStillExists: boolean
): boolean {
	return requestedGeneration === currentGeneration && pageStillExists;
}
