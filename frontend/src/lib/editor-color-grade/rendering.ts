export type EditorColorEffectParam = number | string | boolean;
export type EditorColorEffectParams = Record<string, EditorColorEffectParam>;

/** Renderer-neutral effect contract shared by still and timeline output paths. */
export interface EditorColorRenderEffect {
	effectId: string;
	params: EditorColorEffectParams;
}

/** Minimal compositor boundary required by the shared color-grade renderer. */
export interface EditorColorCompositor {
	render(
		source: TexImageSource,
		width: number,
		height: number,
		effects: readonly EditorColorRenderEffect[]
	): boolean;
	dispose(): void;
}

export type EditorColorCompositorFactory = (
	canvas: HTMLCanvasElement
) => EditorColorCompositor | null;
