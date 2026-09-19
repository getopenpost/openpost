<script lang="ts">
	import { untrack } from 'svelte';
	import { ImageEditorController, provideImageEditor } from '../editor.svelte';
	import type { ImageEditorDocumentResponse } from '../types';
	import TextContentProperties from './text-content-properties.svelte';

	let { fontWeight }: { fontWeight: number } = $props();
	const editor = new ImageEditorController();
	const response: ImageEditorDocumentResponse = {
		id: 'design',
		workspace_id: 'workspace',
		created_by_id: 'user',
		revision: 1,
		can_edit: true,
		created_at: '2026-09-19T00:00:00Z',
		updated_at: '2026-09-19T00:00:00Z',
		document: {
			schema_version: 1,
			title: 'Text properties',
			preset_key: 'custom',
			width_px: 1080,
			height_px: 1080,
			brand_kit_revision: 0,
			export_defaults: { format: 'png', quality: 0.92, matte_color: '#ffffff' },
			pages: [
				{
					id: 'page',
					name: 'Page 1',
					background_color: '#ffffff',
					layers: [
						{
							id: 'text',
							type: 'text',
							name: 'Headline',
							visible: true,
							locked: false,
							opacity: 1,
							transform: {
								x: 0,
								y: 0,
								width: 800,
								height: 400,
								rotation: 0,
								flip_x: false,
								flip_y: false
							},
							text: {
								text: 'NEXT IS NOW',
								font_family: 'Geist Variable',
								font_weight: untrack(() => fontWeight),
								font_style: 'normal',
								font_size: 180,
								color: '#ffffff',
								align: 'left',
								line_height: 1.05,
								letter_spacing: 0,
								stroke_width: 0,
								shadow: { color: '#00000000', blur: 0, offset_x: 0, offset_y: 0 }
							}
						}
					]
				}
			]
		}
	};

	editor.load(response);
	editor.selectLayer('text');
	provideImageEditor(untrack(() => editor));
</script>

<TextContentProperties />
