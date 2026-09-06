import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	assertImageEditorBatchMemory,
	assertImageEditorImportAdmission,
	assertImageEditorImportDimensions,
	assertSafeImageEditorSVG,
	availableImageEditorImportSlots,
	IMAGE_EDITOR_IMPORT_LIMITS,
	ImageEditorImportError,
	imageEditorImportMIME,
	prepareImageEditorImport
} from './image-import';

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('OpenPost Image Editor external image preflight', () => {
	it('accepts only explicit editor image types and extension fallbacks', () => {
		expect(imageEditorImportMIME(new File(['x'], 'photo.jpg', { type: '' }))).toBe('image/jpeg');
		expect(
			imageEditorImportMIME(new File(['x'], 'mark.svg', { type: 'application/octet-stream' }))
		).toBe('image/svg+xml');
		expect(imageEditorImportMIME(new File(['x'], 'fake.png', { type: 'text/plain' }))).toBeNull();
		expect(() => assertImageEditorImportAdmission(new File(['x'], 'notes.txt'))).toThrowError(
			new ImageEditorImportError('unsupported_type')
		);
	});

	it('rejects empty and oversized files before decoding', () => {
		expect(() =>
			assertImageEditorImportAdmission(new File([], 'empty.png', { type: 'image/png' }))
		).toThrow();
		expect(() =>
			assertImageEditorImportAdmission({
				name: 'huge.png',
				type: 'image/png',
				size: IMAGE_EDITOR_IMPORT_LIMITS.maxFileBytes + 1
			})
		).toThrowError(new ImageEditorImportError('file_too_large'));
	});

	it('rejects active or externally referenced SVG content', async () => {
		await expect(
			assertSafeImageEditorSVG(
				new Blob(['<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'])
			)
		).rejects.toMatchObject({ code: 'unsafe_svg' });
		await expect(
			assertSafeImageEditorSVG(
				new Blob([
					'<svg xmlns="http://www.w3.org/2000/svg"><image href="https://example.com/a.png"/></svg>'
				])
			)
		).rejects.toMatchObject({ code: 'unsafe_svg' });
		await expect(
			assertSafeImageEditorSVG(
				new Blob([
					'<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><use href="#shape"/><path id="shape" d="M0 0h10v10z"/></svg>'
				])
			)
		).resolves.toBeUndefined();
	});

	it('checks decoded dimensions, aggregate memory, and remaining layer capacity', () => {
		expect(() => assertImageEditorImportDimensions(4096, 4096)).not.toThrow();
		expect(() => assertImageEditorImportDimensions(8193, 1)).toThrowError(
			new ImageEditorImportError('dimensions_too_large')
		);
		expect(
			assertImageEditorBatchMemory(100, IMAGE_EDITOR_IMPORT_LIMITS.maxBatchDecodedBytes - 100)
		).toBe(IMAGE_EDITOR_IMPORT_LIMITS.maxBatchDecodedBytes);
		expect(() =>
			assertImageEditorBatchMemory(1, IMAGE_EDITOR_IMPORT_LIMITS.maxBatchDecodedBytes)
		).toThrowError(new ImageEditorImportError('batch_memory_limit'));
		expect(availableImageEditorImportSlots(498)).toBe(2);
		expect(availableImageEditorImportSlots(600)).toBe(0);
	});

	it('returns decoded dimensions while releasing the temporary bitmap', async () => {
		const close = vi.fn();
		vi.stubGlobal(
			'createImageBitmap',
			vi.fn().mockResolvedValue({ width: 640, height: 360, close })
		);
		const file = new File(['png'], 'launch.png', { type: 'image/png' });

		const prepared = await prepareImageEditorImport(file, { guestMode: false });

		expect(prepared).toMatchObject({ file, width: 640, height: 360, decodedBytes: 921_600 });
		expect(close).toHaveBeenCalledOnce();
	});
});
