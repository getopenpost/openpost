import { expect, it } from 'vitest';
import '../../routes/layout.css';
import { render } from 'vitest-browser-svelte';
import PropertiesPanel from './components/properties-panel.fixture.svelte';
import fontURL from '../../../../../assets/brand/fonts/Geist-Regular.ttf?url';
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
		const face = [...document.fonts].find((candidate) => candidate.family === family);
		expect(face?.status).toBe('loaded');
		if (face) document.fonts.delete(face);
		releaseLocalImageEditorMedia(imported.id);
		await loadGuestImageEditorDesign(local.id);
		expect(
			[...document.fonts].some(
				(candidate) => candidate.family === family && candidate.status === 'loaded'
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
			expect(pixels(family)).toEqual(pixels(referenceFamily));
			expect(pixels(family)).not.toEqual(pixels('monospace'));
		} finally {
			document.fonts.delete(reference);
		}
	} finally {
		for (const face of document.fonts) {
			if (face.family === family) document.fonts.delete(face);
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
