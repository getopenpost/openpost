import type { ImageEditorDocument, ImageEditorPage } from './types';

export function imageEditorPageDimensions(
	document: Pick<ImageEditorDocument, 'width_px' | 'height_px'>,
	page: Pick<ImageEditorPage, 'width_px' | 'height_px'>
) {
	return {
		width: page.width_px ?? document.width_px,
		height: page.height_px ?? document.height_px
	};
}
