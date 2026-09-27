/** Use the Image Editor's import path, retaining local recovery if cloud upload fails. */
export async function createImageDesignFromFrame(file: File, workspaceId: string): Promise<string> {
	const { createGuestImageEditorDesignFromImage } =
		await import('$lib/image-editor/local-persistence');
	const local = await createGuestImageEditorDesignFromImage(
		file,
		file.name.replace(/\.[^.]+$/u, '')
	);
	if (!workspaceId) return local.id;
	const { migrateGuestImageEditorDesign } = await import('$lib/image-editor/guest-migration');
	const cloud = await migrateGuestImageEditorDesign(local.id, workspaceId);
	return cloud.id;
}
