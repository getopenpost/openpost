import { expect, it } from 'vitest';
import { OpenPostFabricAdapter } from './fabric-adapter';
import '../../routes/layout.css';
import { render } from 'vitest-browser-svelte';
import PropertiesPanel from './components/properties-panel.fixture.svelte';
import fontURL from '../../../../../assets/brand/fonts/Geist-Regular.ttf?url';
import manropeURL from '../../../../../assets/brand/fonts/Manrope-SemiBold.ttf?url';
import { renderImageEditorPage } from './static-renderer';
import { imageEditorTextFontFamily } from './fonts';
import { ImageEditorController } from './editor.svelte';
import { blankImageEditorDocument } from './document';
import {
	createImageEditorProjectArchive,
	parseImageEditorProjectArchive
} from './portable-project';
import {
	createGuestImageEditorDesignFromDocument,
	deleteGuestImageEditorDesign,
	storeGuestImageEditorProjectMedia,
	storeGuestImageEditorMedia,
	saveGuestImageEditorDesign,
	loadGuestImageEditorDesign,
	replaceGuestImageEditorMediaIDs,
	getGuestImageEditorMediaForMigration,
	listGuestImageEditorMedia
} from './local-persistence';
import { releaseLocalImageEditorMedia } from './local-media-url';

it('imports an embedded TrueType font, restores its saved face, and preserves migration bytes', async () => {
	const sourceFont = await (await fetch(fontURL)).arrayBuffer();
	const authored = new ImageEditorController();
	const base = blankImageEditorDocument({
		key: 'custom',
		name: 'Test',
		default_format: 'png',
		profiles: [],
		width_px: 640,
		height_px: 480
	});
	const local = await createGuestImageEditorDesignFromDocument(base);
	const family = `AuditFont_${crypto.randomUUID()}`;
	try {
		authored.load(local);
		authored.addText();
		const layer = authored.selectedLayers[0];
		authored.updateLayer(layer.id, {
			text: {
				...layer.text!,
				text: 'Portable font 123',
				font_family: family,
				font_asset_id: 'embedded-font',
				font_weight: 400
			}
		});
		// Existing exports can name TTF bytes .woff2; declared MIME and actual bytes identify the format.
		const archive = await createImageEditorProjectArchive(authored.document!, async () => ({
			name: 'embedded.woff2',
			mimeType: 'font/ttf',
			blob: new Blob([sourceFont], { type: 'font/ttf' })
		}));
		const parsed = await parseImageEditorProjectArchive(new File([archive], 'font.openpost-image'));
		await expect(storeGuestImageEditorMedia(local.id, parsed.media[0].file)).rejects.toThrow(
			'Choose a PNG, JPEG, or WebP image.'
		);
		const imported = await storeGuestImageEditorProjectMedia(
			local.id,
			parsed.document,
			parsed.media[0]
		);
		const saved = replaceGuestImageEditorMediaIDs(
			parsed.document,
			new Map([['embedded-font', imported.id]])
		);
		await saveGuestImageEditorDesign(local.id, saved);
		releaseLocalImageEditorMedia(imported.id);
		const reopened = await loadGuestImageEditorDesign(local.id);
		expect(reopened.missing_local_media_ids).toEqual([]);
		expect(reopened.document.pages[0].layers[0].text).toMatchObject({
			text: 'Portable font 123',
			font_asset_id: imported.id,
			font_family: family
		});
		const runtimeFamily = imageEditorTextFontFamily(reopened.document.pages[0].layers[0].text!);
		const face = [...document.fonts].find((candidate) => candidate.family === runtimeFamily);
		expect(face?.status).toBe('loaded');
		if (face) document.fonts.delete(face);
		releaseLocalImageEditorMedia(imported.id);
		await loadGuestImageEditorDesign(local.id);
		expect(
			[...document.fonts].some(
				(candidate) => candidate.family === runtimeFamily && candidate.status === 'loaded'
			)
		).toBe(true);
		const migration = await getGuestImageEditorMediaForMigration(imported.id);
		expect(migration.mimeType).toBe('font/ttf');
		expect(migration.name).toBe('embedded.ttf');
		expect(migration.assetKind).toBe('brand_font');
		expect(new Uint8Array(await migration.blob.arrayBuffer())).toEqual(new Uint8Array(sourceFont));
		expect(await listGuestImageEditorMedia(local.id)).toEqual([]);
		const reloaded = new ImageEditorController();
		reloaded.load(reopened);
		reloaded.selectLayer(reopened.document.pages[0].layers[0].id);
		const screen = await render(PropertiesPanel, { editor: reloaded });
		await expect
			.element(screen.getByLabelText('Text', { exact: true }))
			.toHaveValue('Portable font 123');
		await expect.element(screen.getByRole('alert')).not.toBeInTheDocument();
		const referenceFamily = `Reference_${crypto.randomUUID()}`;
		const reference = await new FontFace(referenceFamily, sourceFont).load();
		document.fonts.add(reference);
		try {
			const pixels = (font: string) => {
				const canvas = document.createElement('canvas');
				canvas.width = 500;
				canvas.height = 100;
				const context = canvas.getContext('2d')!;
				context.fillStyle = '#ffffff';
				context.fillRect(0, 0, 500, 100);
				context.fillStyle = '#000000';
				context.font = `32px "${font}"`;
				context.fillText('Portable font 123', 20, 60);
				return context.getImageData(0, 0, 500, 100).data;
			};
			expect(pixels(runtimeFamily)).toEqual(pixels(referenceFamily));
			expect(pixels(runtimeFamily)).not.toEqual(pixels('monospace'));
		} finally {
			document.fonts.delete(reference);
		}
	} finally {
		for (const face of document.fonts) {
			if (face.family.includes(family)) document.fonts.delete(face);
		}
		await deleteGuestImageEditorDesign(local.id);
	}
});

it.each(['wrong declared type', 'wrong bytes', 'truncated font'])(
	'rejects %s without saving a local asset',
	async (invalid) => {
		const base = blankImageEditorDocument({
			key: 'custom',
			name: 'Test',
			default_format: 'png',
			profiles: [],
			width_px: 640,
			height_px: 480
		});
		const local = await createGuestImageEditorDesignFromDocument(base);
		try {
			const authored = new ImageEditorController();
			authored.load(local);
			authored.addText();
			const layer = authored.selectedLayers[0];
			authored.updateLayer(layer.id, { text: { ...layer.text!, font_asset_id: 'invalid-font' } });
			const valid = await (await fetch(fontURL)).arrayBuffer();
			const bytes =
				invalid === 'wrong bytes'
					? new TextEncoder().encode('<html>Not a font</html>')
					: invalid === 'truncated font'
						? valid.slice(0, 16)
						: valid;
			const type = invalid === 'wrong declared type' ? 'image/png' : 'font/ttf';
			const archive = await createImageEditorProjectArchive(authored.document!, async () => ({
				name: 'font.ttf',
				mimeType: type,
				blob: new Blob([bytes], { type })
			}));
			const parsed = await parseImageEditorProjectArchive(
				new File([archive], 'invalid.openpost-image')
			);
			await expect(
				storeGuestImageEditorProjectMedia(local.id, parsed.document, parsed.media[0])
			).rejects.toThrow();
			expect(await listGuestImageEditorMedia(local.id)).toEqual([]);
		} finally {
			await deleteGuestImageEditorDesign(local.id);
		}
	}
);

it.each([false, true])('preserves font asset identity (curved: %s)', async (curved) => {
	const family = `SharedFont_${crypto.randomUUID()}`;
	const ids: string[] = [];
	const sources = [fontURL, manropeURL];
	const documents: import('./types').ImageEditorDocument[] = [];
	const snapshots: import('./types').ImageEditorDocumentResponse[] = [];
	try {
		for (const source of sources) {
			const bytes = await (await fetch(source)).arrayBuffer();
			const base = blankImageEditorDocument({
				key: 'custom',
				name: 'Test',
				default_format: 'png',
				profiles: [],
				width_px: 640,
				height_px: 480
			});
			const local = await createGuestImageEditorDesignFromDocument(base);
			ids.push(local.id);
			const editor = new ImageEditorController();
			editor.load(local);
			editor.addText();
			const text = editor.selectedLayers[0];
			editor.updateLayer(text.id, {
				text: {
					...text.text!,
					text: 'MMMM iii Portable123',
					curve: curved ? { type: 'arc_up', strength: 0.65, offset: 0, reverse: false } : undefined,
					font_family: family,
					font_asset_id: 'font',
					font_weight: 400,
					font_style: 'normal'
				}
			});
			const archive = await createImageEditorProjectArchive(editor.document!, async () => ({
				name: 'font.ttf',
				mimeType: 'font/ttf',
				blob: new Blob([bytes], { type: 'font/ttf' })
			}));
			const parsed = await parseImageEditorProjectArchive(
				new File([archive], 'font.openpost-image')
			);
			const imported = await storeGuestImageEditorProjectMedia(
				local.id,
				parsed.document,
				parsed.media[0]
			);
			await saveGuestImageEditorDesign(
				local.id,
				replaceGuestImageEditorMediaIDs(parsed.document, new Map([['font', imported.id]]))
			);
			releaseLocalImageEditorMedia(imported.id);
			const loaded = await loadGuestImageEditorDesign(local.id);
			snapshots.push(loaded);
			documents.push(loaded.document);
		}
		const pixels = async (authored: import('./types').ImageEditorDocument) => {
			const output = await renderImageEditorPage(authored, authored.pages[0], 0);
			const bitmap = await createImageBitmap(output.blob);
			const canvas = document.createElement('canvas');
			canvas.width = bitmap.width;
			canvas.height = bitmap.height;
			const context = canvas.getContext('2d')!;
			context.drawImage(bitmap, 0, 0);
			bitmap.close();
			return context.getImageData(0, 0, canvas.width, canvas.height).data;
		};
		const first = await pixels(documents[0]);
		const second = await pixels(documents[1]);
		expect(second).not.toEqual(first);
		const firstFamily = imageEditorTextFontFamily(documents[0].pages[0].layers[0].text!);
		for (const face of document.fonts) if (face.family === firstFamily) document.fonts.delete(face);
		const inspector = new ImageEditorController();
		inspector.load(snapshots[0]);
		inspector.selectLayer(documents[0].pages[0].layers[0].id);
		const screen = await render(PropertiesPanel, { editor: inspector });
		await expect.element(screen.getByRole('alert')).toBeVisible();

		const canvas = document.createElement('canvas');
		document.body.append(canvas);
		const missing: string[] = [];
		const adapter = new OpenPostFabricAdapter({
			canvas,
			document: documents[0],
			page: documents[0].pages[0],
			readOnly: false,
			onSelection() {},
			onTransform() {},
			onTextChange() {},
			onMissingMedia(id) {
				missing.push(id);
			}
		});
		const livePixels = async () => {
			await new Promise<void>((resolve) =>
				requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
			);
			return canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
		};
		try {
			await adapter.mount();
			await expect.element(screen.getByRole('alert')).not.toBeInTheDocument();
			expect(await livePixels()).toEqual(first);
			await adapter.render(documents[1], documents[1].pages[0]);
			expect(await livePixels()).toEqual(second);
			await adapter.render(documents[0], documents[0].pages[0]);
			expect(await livePixels()).toEqual(first);
			const changed = structuredClone(documents[0]);
			changed.pages[0].layers[0].text!.font_asset_id =
				documents[1].pages[0].layers[0].text!.font_asset_id;
			await adapter.sync(changed, changed.pages[0]);
			expect(await livePixels()).toEqual(second);
			const missingID = `local_media_missing_${crypto.randomUUID()}`;
			const unavailable = structuredClone(changed);
			unavailable.pages[0].layers[0].text!.font_asset_id = missingID;
			await adapter.sync(unavailable, unavailable.pages[0]);
			expect(missing).toEqual([missingID]);
			expect((await livePixels()).some((value, index) => index % 4 !== 3 && value < 200)).toBe(
				true
			);
			await expect(renderImageEditorPage(unavailable, unavailable.pages[0], 0)).rejects.toThrow();
		} finally {
			adapter.dispose();
			canvas.remove();
		}

		for (const [index, id] of ids.entries()) {
			const fontID = documents[index].pages[0].layers[0].text!.font_asset_id!;
			releaseLocalImageEditorMedia(fontID);
			for (const face of document.fonts)
				if (face.family.includes(family)) document.fonts.delete(face);
			const reopened = await loadGuestImageEditorDesign(id);
			expect(reopened.document.pages[0].layers[0].text).toMatchObject({
				font_family: family,
				font_weight: 400,
				font_style: 'normal',
				font_asset_id: fontID
			});
			expect(await pixels(reopened.document)).toEqual(index === 0 ? first : second);
		}
	} finally {
		for (const face of document.fonts)
			if (face.family.includes(family)) document.fonts.delete(face);
		await Promise.all(ids.map(deleteGuestImageEditorDesign));
	}
});
