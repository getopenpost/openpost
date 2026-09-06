import type { StackLayerSource } from '../media/canvas-stack-compositor';

export type PreviewSourceProvider = () => StackLayerSource | null;
export type RegisterPreviewSource = (
	itemId: string,
	provider: PreviewSourceProvider | null
) => void;
