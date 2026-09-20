import {
	imageConversions,
	imageFormats,
	mediaTools,
	type MediaToolSlug
} from '@openpost/social-images';

const localPrivacy =
	'Your images are processed on your device, not uploaded. Download your result before leaving this page. Browser memory and format support still apply.';
const freeAnswer = {
	question: 'Is it free without an account?',
	answer:
		'Yes. There is no signup, watermark, or charge to download. Your browser does the processing.'
};
interface ToolGuide {
	steps: string[];
	sections: { title: string; paragraphs: string[] }[];
	questions?: { question: string; answer: string }[];
	privacy?: string;
}
interface ToolGuides {
	[slug: string]: ToolGuide;
}
const guides: ToolGuides = {
	'background-remover': {
		steps: [
			'Choose an image, drop it here, or paste one from your clipboard.',
			'Wait for the background-removal model to load and process the image.',
			'Review the cutout, then download a transparent PNG or copy it where supported.'
		],
		sections: [
			{
				title: 'A transparent image at the original dimensions',
				paragraphs: [
					'Use a cutout for a product photo, profile picture, thumbnail, or social post. The download keeps your image dimensions. The model estimates the edge on a processing copy, then applies the mask to the original image. It does not invent missing detail.',
					'Fine hair, glass, and low-contrast edges can need further editing. Review the result on both a light and dark background before using it. Large images need more device memory.'
				]
			}
		],
		privacy:
			'Your image stays on your device. The browser downloads the background-removal model on first use; this can take time and data. Processing runs locally, not on an upload server.',
		questions: [
			{
				question: 'Why does the first image take longer?',
				answer:
					'The browser needs to download the model before it can remove a background. Later runs can reuse cached model files. Keep the tab open while processing.'
			}
		]
	},
	'image-color-picker': {
		steps: [
			'Open or paste an image.',
			'Select a point in the image or enter pixel coordinates.',
			'Copy a color value or choose one of the extracted palette colors.'
		],
		sections: [
			{
				title: 'Find the color you actually need',
				paragraphs: [
					'Sample a product photo, screenshot, or brand image, then copy its HEX, RGB, or HSL value into your design. Sampling reads the image pixel, not the page background beneath it.',
					'A palette summarizes the image using a smaller analysis copy. It is useful for choosing a few related colors, but it is not a complete inventory of every pixel. Transparent pixels are handled separately from visible color.'
				]
			}
		],
		questions: [
			{
				question: 'Can I pick a color from my screen?',
				answer:
					'Where your browser supports the screen eyedropper, you can start it explicitly. Otherwise, take a screenshot and paste it into this tool.'
			}
		]
	},
	'paste-image': {
		steps: [
			'Copy an image or screenshot, then paste it on this page.',
			'The full-resolution PNG downloads automatically.',
			'Use the preview to download again or choose JPEG or WebP instead.'
		],
		sections: [
			{
				title: 'Turn your clipboard into an image file',
				paragraphs: [
					'Save a screenshot or copied image without opening a full editor. The tool keeps the dimensions provided by your clipboard. If another application reduced the image before copying it, those missing pixels cannot be recovered.',
					'PNG preserves transparency. JPEG uses a background color in place of transparent pixels. WebP supports transparency with adjustable quality. The result is a local file, not a public sharing link.'
				]
			}
		]
	},
	'logo-maker': {
		steps: [
			'Choose an icon or start from a preset.',
			'Adjust the icon and background while watching the preview.',
			'Download PNG for posts or SVG for a scalable version.'
		],
		sections: [
			{
				title: 'A simple mark for your next project',
				paragraphs: [
					'Make an icon-based logo for a project, avatar, or social account. Set the icon color, size, rotation, and outline, then choose a background and corner shape.',
					'PNG is ready to use in posts. SVG stays sharp when resized. Library icons are shared artwork, not exclusive trademarks. Check that your finished mark is suitable for your business before adopting it.'
				]
			}
		]
	},
	'quick-cut': {
		steps: [
			'Open Quick Cut and choose a local video.',
			'Mark the sections to keep and review the cut points.',
			'Export your cut without adding a watermark.'
		],
		privacy:
			'Quick Cut runs in the OpenPost app without requiring an account. Local projects and source files stay in browser storage. The tool explains browser and format limitations before export.',
		sections: [
			{
				title: 'Quick Cut or the full Video Editor?',
				paragraphs: [
					'Use Quick Cut when you need to trim footage or assemble compatible sections without recompressing the video. It focuses on source clips and cut ranges.',
					'Use the full Video Editor for captions, overlays, effects, and composed timelines. Stream-copy cuts depend on keyframes and format compatibility, so a lossless boundary may differ from the exact frame you selected. Review the exported result.'
				]
			}
		]
	},
	'image-converter': {
		steps: [
			'Choose, drop, or paste a PNG, JPEG, or WebP image.',
			'Select an output format and adjust its available settings.',
			'Download the converted file at the original dimensions.'
		],
		sections: [
			{
				title: 'Choose a format for the job',
				paragraphs: [
					'Use PNG for transparent graphics and screenshots. Use JPEG for photographs when transparency is not needed. WebP often produces smaller files and can keep transparency.',
					'Conversion does not improve an already-compressed source. JPEG and lossy WebP may change pixels; PNG preserves the decoded image but cannot undo damage from an earlier JPEG export. Animated files are outside this still-image tool.'
				]
			}
		]
	}
};

const articleEntries = mediaTools.map((tool) => {
	const conversion = imageConversions.find((item) => item.slug === tool.slug);
	const input = imageFormats.find((format) => format.id === conversion?.input);
	const output = imageFormats.find((format) => format.id === conversion?.output);
	const guide: (typeof guides)[string] =
		conversion && input && output
			? {
					steps: [
						`Choose, drop, or paste your ${input.name} image.`,
						`Check the ${output.name} preview and available output settings.`,
						`Download the ${output.name} file at its original dimensions.`
					],
					sections: [
						{
							title: `When to convert ${input.name} to ${output.name}`,
							paragraphs: [
								output.id === 'png'
									? `Choose PNG when you need a widely supported lossless image, a screenshot, or transparency. Converting ${input.name} to PNG keeps the decoded pixels, but can make the file larger and cannot restore detail already lost in the source.`
									: output.id === 'jpeg'
										? `Choose JPEG for a photo that needs broad compatibility. JPEG has no transparency: choose a matte color for transparent areas before downloading. Lower quality usually reduces file size but can add visible artifacts.`
										: `Choose WebP for web images that need a smaller file and optional transparency. Check the preview at your chosen quality. Some older applications may require PNG or JPEG instead.`,
								`The converter keeps the source width and height. It processes one still image locally; it does not preserve animation, camera metadata, or every embedded color profile. Keep your original file if you need those.`
							]
						}
					]
				}
			: guides[tool.slug];
	return [
		tool.slug,
		{
			title: tool.name,
			description: tool.description,
			privacy: guide.privacy ?? localPrivacy,
			steps: guide.steps,
			sections: guide.sections,
			questions: [freeAnswer, ...(guide.questions ?? [])]
		}
	];
});
export const mediaArticles =
	// SAFETY: mediaTools enumerates every MediaToolSlug and each entry retains its exact slug.
	Object.fromEntries(articleEntries) as Record<
		MediaToolSlug,
		{
			title: string;
			description: string;
			privacy: string;
			steps: string[];
			sections: { title: string; paragraphs: string[] }[];
			questions: { question: string; answer: string }[];
		}
	>;
