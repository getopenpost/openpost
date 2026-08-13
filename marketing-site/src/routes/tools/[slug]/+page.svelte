<script lang="ts">
	import { page } from '$app/state';
	import { error } from '@sveltejs/kit';
	import CharacterCounter from '../../_components/tools/CharacterCounter.svelte';
	import HandleChecker from '../../_components/tools/HandleChecker.svelte';
	import LinkedInFormatter from '../../_components/tools/LinkedInFormatter.svelte';
	import PostingPlanner from '../../_components/tools/PostingPlanner.svelte';
	import PreviewGenerator from '../../_components/tools/PreviewGenerator.svelte';
	import ImageEditorLauncher from '../../_components/tools/ImageEditorLauncher.svelte';
	import ThreadSplitter from '../../_components/tools/ThreadSplitter.svelte';
	import ToolPageShell from '../../_components/tools/ToolPageShell.svelte';
	import VideoEditorLauncher from '../../_components/tools/VideoEditorLauncher.svelte';
	import { getTool } from '../../_marketing';

	const seoBySlug: Record<
		string,
		{
			heading: string;
			description: string;
			audience: string;
			inputs: readonly string[];
			outputs: readonly string[];
			limits: readonly string[];
			privacyBehavior: string;
			nextStep: string;
		}
	> = {
		'social-media-video-editor': {
			heading: 'Edit social videos without an account',
			description:
				'Record or import footage, edit one shared timeline for portrait, feed, square, and landscape video, then export without a watermark.',
			audience:
				'Creators who need to cut, caption, record, or reframe a social video before publishing.',
			inputs: [
				'Video files, camera, screen, or microphone recordings',
				'Cut ranges, captions, overlays, effects, and one of four output frames'
			],
			outputs: [
				'MP4 or WebM video exports',
				'A reusable local project that can be moved into an OpenPost workspace'
			],
			limits: [
				'The editor requires a current browser with WebCodecs, private file storage, and WebGL2.',
				'Quick Cut can copy compatible source streams without transcoding; Full Editor export support varies by browser and device.',
				'Each destination still applies its own codec, duration, file-size, and aspect-ratio rules.'
			],
			privacyBehavior:
				'Projects, recordings, transcripts, and analysis stay in this browser unless you explicitly save them to OpenPost or use them in a post.',
			nextStep:
				'This page describes the editor. Open the guest editor to work without an account, then save the result to OpenPost only if you want to schedule it.'
		},
		'social-media-image-editor': {
			heading: 'Create social media images without an account',
			description:
				'Design posts, carousel pages, Story slides, and thumbnails in your browser. Export PNG, JPEG, or WebP files without a watermark.',
			audience:
				'Creators who need a social image, carousel, Story slide, or video thumbnail without starting a Workspace.',
			inputs: [
				'Images, text, shapes, and blank pages',
				'Canvas size, layers, colors, type, and image adjustments'
			],
			outputs: [
				'PNG, JPEG, or WebP files without a watermark',
				'A reusable local multi-page design'
			],
			limits: [
				'The editor works with still images; it is not a video, animation, print-color, or arbitrary remote-asset editor.',
				'Export size and performance depend on the browser, device memory, and document dimensions.',
				'Social destinations can still crop, recompress, or reject an exported file.'
			],
			privacyBehavior:
				'Designs and imported images stay in local browser storage unless you explicitly save them to OpenPost.',
			nextStep:
				'This page describes the editor. Open the guest editor to create and export without an account, or save the design to OpenPost when you want to use it in a Publication.'
		},
		'multi-platform-character-counter': {
			heading: 'Count every visible character before you publish',
			description:
				'Check one draft against ten social network limits. Emoji stay intact, with an X-style count for characters and links.',
			audience: 'Writers adapting one draft for several social destinations.',
			inputs: ['One text draft'],
			outputs: [
				'Visible character, word, and line counts',
				'A count and remaining limit for each of ten supported social networks'
			],
			limits: [
				'The counts model known text rules, including composed emoji and X-style link length.',
				'Provider rules can change, and a valid count does not prove media, account, or publishing eligibility.'
			],
			privacyBehavior: 'The draft and all counts stay in this browser. No text is uploaded.',
			nextStep:
				'Adapt any over-limit destination version, then open OpenPost when you want to review accounts and schedule the Publication.'
		},
		'post-preview-generator': {
			heading: 'Preview each platform before you publish',
			description:
				'Check text, images, video, polls, links, content warnings, and supported formats across all ten OpenPost platforms.',
			audience: 'Creators who want to inspect how a draft may appear before scheduling it.',
			inputs: [
				'Post text and a selected social network',
				'Optional identity, format, local or public media, poll, link, title, alt text, and content warning'
			],
			outputs: [
				'A browser-rendered post, thread, Story, video, document, poll, or link-card preview'
			],
			limits: [
				'The preview is an approximation, not a provider rendering or publishing guarantee.',
				'Available formats and options vary by destination.',
				'Public media URLs are displayed by the browser; local files remain local.'
			],
			privacyBehavior:
				'Draft text and local files stay in this browser. A public media URL may be requested by the browser to display it.',
			nextStep:
				'Adjust the destination version, then use the OpenPost composer to validate the connected account and schedule it.'
		},
		'thread-splitter': {
			heading: 'Turn long drafts into clean social threads',
			description:
				'Split at paragraphs, sentences, and words for X, Bluesky, Mastodon, Threads, or LinkedIn. Add numbers and copy one part or the full thread.',
			audience: 'Writers turning one long draft into a reviewable social thread.',
			inputs: ['One long text draft', 'A destination and an optional part-number setting'],
			outputs: [
				'Ordered thread parts that can be copied separately or together',
				'Character counts for the source and each part'
			],
			limits: [
				'The splitter preserves paragraph and sentence boundaries when they fit.',
				'Long words are carried into a part rather than discarded.',
				'Numbering counts against each destination limit.'
			],
			privacyBehavior: 'The draft and generated parts stay in this browser. Nothing is uploaded.',
			nextStep:
				'Review every part in order, then paste the thread into OpenPost to tailor it for an account and schedule it.'
		},
		'fediverse-handle-checker': {
			heading: 'Validate a Fediverse or Bluesky handle',
			description:
				'Check the handle format, open the right profile or lookup page, and choose whether to run a live account check.',
			audience:
				'People checking a Fediverse or Bluesky identity before adding it to a launch or contact plan.',
			inputs: [
				'A Mastodon-style or Bluesky-style handle',
				'An explicit choice to run an optional live lookup'
			],
			outputs: [
				'A normalized handle, syntax result, and likely profile link',
				'For a live check, the resolved account identity or a clear failure result'
			],
			limits: [
				'A syntax result does not prove that an account exists.',
				'Live checks time out after eight seconds and can fail when a server blocks browser requests.',
				'The tool validates identities; it does not connect an account to OpenPost.'
			],
			privacyBehavior:
				'Syntax checks stay local. A live check contacts the account server or Bluesky API only after you request it.',
			nextStep:
				'Copy the normalized handle or open the profile. Connect only your own publishing account from OpenPost Social accounts.'
		},
		'linkedin-text-formatter': {
			heading: 'Make LinkedIn posts easier to scan',
			description:
				'Clean up spacing, shorten paragraphs, use one bullet style, and check the length while keeping the text easy to read and search.',
			audience: 'Writers preparing readable plain-text LinkedIn posts.',
			inputs: [
				'One LinkedIn draft',
				'A paragraph-length choice and optional consistent bullet style'
			],
			outputs: [
				'Accessible, searchable plain text ready to copy',
				'Character, word, paragraph, opening-block, and longest-block counts'
			],
			limits: [
				'The formatter changes spacing, paragraph breaks, and bullet markers; it does not rewrite the draft.',
				'LinkedIn posts are checked against a 3,000-character limit.',
				'It does not create fake Unicode bold or italic text.'
			],
			privacyBehavior:
				'The original and formatted drafts stay in this browser. Nothing is uploaded.',
			nextStep:
				'Read the formatted copy once, then paste it into an OpenPost LinkedIn rendition for account-specific review and scheduling.'
		},
		'best-time-to-post-calculator': {
			heading: 'Build posting times your team can actually use',
			description:
				'Choose the days and hours your audience is active, set your timezone, then copy or download a weekly plan.',
			audience:
				'Creators and teams converting known audience hours into a repeatable weekly test plan.',
			inputs: [
				'Audience days, hours, and timezone',
				'Your timezone and a target of one to fourteen posts per week'
			],
			outputs: [
				'A timezone-converted schedule using dates in the next week',
				'A copyable or downloadable CSV plan'
			],
			limits: [
				'The planner distributes times evenly inside the chosen window; it does not predict audience behavior.',
				'Example dates use the next week so daylight-saving rules apply.',
				'A plan is not scheduled until you add it to OpenPost or another publishing system.'
			],
			privacyBehavior:
				'Schedule choices and timezone conversion stay in this browser. Nothing is uploaded.',
			nextStep:
				'Test the plan, then add the chosen times to OpenPost posting schedules or schedule each Publication directly.'
		}
	};

	const slug = $derived(page.params.slug ?? '');
	const seo = $derived.by(() => {
		if (!getTool(slug)) error(404, 'Tool not found');
		const found = seoBySlug[slug];
		if (!found) error(404, 'Tool explanation not found');
		return found;
	});
</script>

<ToolPageShell
	title={seo.heading}
	description={seo.description}
	audience={seo.audience}
	inputs={seo.inputs}
	outputs={seo.outputs}
	limits={seo.limits}
	privacyBehavior={seo.privacyBehavior}
	nextStep={seo.nextStep}
>
	{#if slug === 'social-media-video-editor'}
		<VideoEditorLauncher />
	{:else if slug === 'social-media-image-editor'}
		<ImageEditorLauncher />
	{:else if slug === 'multi-platform-character-counter'}
		<CharacterCounter />
	{:else if slug === 'post-preview-generator'}
		<PreviewGenerator />
	{:else if slug === 'thread-splitter'}
		<ThreadSplitter />
	{:else if slug === 'fediverse-handle-checker'}
		<HandleChecker />
	{:else if slug === 'linkedin-text-formatter'}
		<LinkedInFormatter />
	{:else if slug === 'best-time-to-post-calculator'}
		<PostingPlanner />
	{/if}
</ToolPageShell>
