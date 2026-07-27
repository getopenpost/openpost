import {
	Activity,
	CalendarClock,
	CheckCircle2,
	Clock3,
	Code2,
	FileText,
	GitBranch,
	KeyRound,
	Library,
	LockKeyhole,
	MessageSquareText,
	PanelTop,
	ShieldCheck,
	UsersRound,
	Workflow
} from 'lucide-svelte';
import { PLATFORM_LIMITS, publicPlatformLimits } from '$lib/platform-limits';

export const appUrl = 'https://app.openpost.social';
export const managedSignupUrl = `${appUrl}/register?plan=starter`;
export const userDocsUrl = 'https://docs.openpost.social/usage/';
export const selfHostingDocsUrl = 'https://docs.openpost.social/self-hosting/';
export const developerDocsUrl = 'https://docs.openpost.social/development/';
export const docsUrl = userDocsUrl;
export const githubUrl = 'https://github.com/rodrgds/openpost';
export const siteUrl = 'https://openpost.social';
export const demoVideoUrl = 'https://youtu.be/_mZf3HzQaN8';
export const demoVideoEmbedUrl =
	'https://www.youtube-nocookie.com/embed/_mZf3HzQaN8?autoplay=1&rel=0';
export const demoVideoThumbnailUrl = '/assets/screenshots/main-dark.png';

export const navItems = [
	{ label: 'Pricing', href: '/pricing' },
	{ label: 'Platforms', href: '/platforms' },
	{ label: 'Compare', href: '/compare' },
	{ label: 'Tools', href: '/tools' },
	{ label: 'Security', href: '/security' },
	{ label: 'Docs', href: docsUrl }
] as const;
export const planIDs = ['starter', 'creator', 'pro', 'team', 'agency'] as const;

export const managedAccessSummary =
	'Create an account and one workspace before checkout. Connecting social accounts and publishing on the managed app require an active plan, starting at €6/month. There is no hosted free plan.';

export const plans = [
	{
		id: 'starter',
		name: 'Starter',
		price: '€6',
		description: 'A managed publishing workspace for one small project.',
		workspaces: '1',
		accounts: '3',
		posts: '100',
		storage: '1 GB',
		seats: '1',
		limits: [
			'1 workspace',
			'3 social accounts',
			'100 scheduled posts/month',
			'1 GB media',
			'1 seat'
		],
		featured: false
	},
	{
		id: 'creator',
		name: 'Creator',
		price: '€12',
		description: 'For creators and small brands that publish every week.',
		workspaces: '3',
		accounts: '6',
		posts: '500',
		storage: '5 GB',
		seats: '1',
		limits: [
			'3 workspaces',
			'6 social accounts',
			'500 scheduled posts/month',
			'5 GB media',
			'1 seat'
		],
		featured: true
	},
	{
		id: 'pro',
		name: 'Pro',
		price: '€24',
		description: 'More accounts, media, and monthly posts for one operator.',
		workspaces: '10',
		accounts: '15',
		posts: '2,500',
		storage: '25 GB',
		seats: '1',
		limits: [
			'10 workspaces',
			'15 social accounts',
			'2,500 scheduled posts/month',
			'25 GB media',
			'1 seat'
		],
		featured: false
	},
	{
		id: 'team',
		name: 'Team',
		price: '€49',
		description: 'Shared access for a small publishing team.',
		workspaces: '10',
		accounts: '25',
		posts: '5,000',
		storage: '50 GB',
		seats: '3',
		limits: [
			'10 workspaces',
			'25 social accounts',
			'5,000 scheduled posts/month',
			'50 GB media',
			'3 included seats'
		],
		featured: false
	},
	{
		id: 'agency',
		name: 'Agency',
		price: '€99',
		description: 'Higher workspace and account limits for client work.',
		workspaces: '50',
		accounts: '150',
		posts: '25,000',
		storage: '250 GB',
		seats: '5',
		limits: [
			'50 workspaces',
			'150 social accounts',
			'25,000 scheduled posts/month',
			'250 GB media',
			'5 included seats'
		],
		featured: false
	}
] as const;

export const platforms = [
	{
		slug: 'x',
		name: 'X',
		short: 'x',
		tag: 'Posts, threads, media',
		status: 'Available',
		statusDetail: 'Publishing path implemented',
		description:
			'Draft, preview, and schedule X posts, media posts, links, and reply threads with limits resolved for each connected account.',
		heroTitle: 'Build an X reply chain with the right limit for each account.',
		preview: {
			label: 'Reply chain',
			headline: 'Three connected posts',
			body: 'Each part is reviewed and scheduled as its own X post.',
			detail: '280 standard · up to 25,000 subscribed',
			chips: ['Post 1', 'Reply 2', 'Reply 3']
		},
		accountRequirement: 'An X developer app with OAuth 1.0a user authentication enabled.',
		auth: 'OAuth 1.0a',
		setup: [
			'Configure the X client ID, secret, and the exact OpenPost callback URL.',
			'Enable OAuth 1.0a user authentication in the X developer portal.',
			'Connect the X account from Social accounts, then publish a small test post.'
		],
		formats: [
			{
				name: 'Post, thread, or link',
				text: '280 standard · up to 25,000 subscribed',
				media: 'Text only'
			},
			{
				name: 'Image post',
				text: '280 standard · up to 25,000 subscribed',
				media: '1-4 JPEG, PNG, WebP, or GIF images'
			},
			{
				name: 'Video',
				text: '280 standard · up to 25,000 subscribed',
				media: '1 MP4 or QuickTime video'
			}
		],
		limits: [
			`${PLATFORM_LIMITS.x.charLimit} weighted characters for standard accounts`,
			'Up to 25,000 weighted characters for verified Basic, Premium, or Premium+ accounts',
			'Video: 140 seconds and 512 MiB standard; up to 4 hours and 16 GiB subscribed',
			PLATFORM_LIMITS.x.media,
			'Your X API tier and quota still apply'
		],
		limitations: [
			'OpenPost uses standard limits when X cannot verify a connected account subscription tier.',
			'Media publishing needs OAuth 1.0a access-token and secret pairs.',
			'Polls, quote posts, and other format settings remain subject to the account API tier.'
		],
		verification:
			'Verify OAuth, account quota, and the formats you plan to use with the connected account.',
		docsUrl: `${siteUrl.replace('openpost.social', 'docs.openpost.social')}/providers/x/`
	},
	{
		slug: 'mastodon',
		name: 'Mastodon',
		short: 'mastodon',
		tag: 'Custom servers, posts, threads',
		status: 'Available',
		statusDetail: 'Publishing path implemented',
		description:
			'Connect a public Mastodon server, then schedule posts, media, links, and reply threads.',
		heroTitle: 'Publish to the Mastodon server your community already uses.',
		preview: {
			label: 'mastodon.social',
			headline: 'Public post with a content warning option',
			body: 'Visibility, language, sensitive media, and instance rules stay attached to the destination.',
			detail: '500 characters by default',
			chips: ['Public', 'English', 'Instance-aware']
		},
		accountRequirement: 'An account on a public HTTPS Mastodon instance that allows app access.',
		auth: 'OAuth 2.0 per instance',
		setup: [
			'Choose Mastodon in Social accounts and enter the public server address.',
			'Approve the dynamically registered or operator-configured app on that server.',
			'Confirm the instance-specific text and media rules before scheduling.'
		],
		formats: [
			{
				name: 'Post, thread, or link',
				text: '500 characters by default',
				media: 'Text only'
			},
			{
				name: 'Media post',
				text: '500 characters by default',
				media: 'Up to 4 images, GIFs, or MP4 attachments'
			}
		],
		limits: [
			`${PLATFORM_LIMITS.mastodon.charLimit} characters by default`,
			PLATFORM_LIMITS.mastodon.media,
			'Reply threads and native scheduling metadata',
			'Instance rules can override the defaults'
		],
		limitations: [
			'Character, attachment, and video limits can differ by server.',
			'Custom instances must be public HTTPS and allow app registration.',
			'One adapter registration is maintained per Mastodon instance.'
		],
		verification:
			'Check the destination instance rules and publish one media test before relying on a new server.',
		docsUrl: `${siteUrl.replace('openpost.social', 'docs.openpost.social')}/providers/mastodon/`
	},
	{
		slug: 'bluesky',
		name: 'Bluesky',
		short: 'bluesky',
		tag: 'Posts, threads, images, video',
		status: 'Available',
		statusDetail: 'Publishing path implemented',
		description:
			'Connect with a handle and app password, then schedule posts, links, media, and reply threads.',
		heroTitle: 'Keep a Bluesky post concise while preserving links and rich text.',
		preview: {
			label: '@openpost.social',
			headline: 'A short post with a rich link card',
			body: 'Facets, link metadata, replies, labels, and media are built for AT Protocol records.',
			detail: '300 characters',
			chips: ['Rich text', 'Link card', 'AT Protocol']
		},
		accountRequirement: 'A Bluesky handle and a dedicated app password.',
		auth: 'Handle and app password',
		setup: [
			'Create an app password in Bluesky account settings.',
			'Connect with your handle and that app password, not your main password.',
			'Publish a test if you plan to use video or rich links.'
		],
		formats: [
			{
				name: 'Post, thread, or link',
				text: '300 characters',
				media: 'Text or a rich link card'
			},
			{
				name: 'Image post',
				text: '300 characters',
				media: '1-4 JPEG, PNG, or WebP images'
			},
			{
				name: 'Video',
				text: '300 characters',
				media: '1 MP4 video, up to 100 MB'
			}
		],
		limits: [
			`${PLATFORM_LIMITS.bluesky.charLimit} characters`,
			PLATFORM_LIMITS.bluesky.media,
			'AT Protocol replies',
			'Video cannot be mixed with images'
		],
		limitations: [
			'Video is MP4-only in the current capability profile and cannot be combined with images.',
			'App passwords can be revoked independently from the main account password.',
			'Provider-side processing can delay video availability after upload.'
		],
		verification:
			'The text and image paths are implemented; test video with the account before a scheduled campaign.',
		docsUrl: `${siteUrl.replace('openpost.social', 'docs.openpost.social')}/providers/bluesky/`
	},
	{
		slug: 'linkedin',
		name: 'LinkedIn',
		short: 'linkedin',
		tag: 'Posts, documents, video',
		status: 'Available',
		statusDetail: 'Publishing path implemented',
		description:
			'Schedule LinkedIn posts, links, images, documents, videos, and comment-style thread continuations.',
		heroTitle: 'Turn a LinkedIn update into a document post or comment thread.',
		preview: {
			label: 'Professional update',
			headline: 'Quarterly field guide.pdf',
			body: 'The document title, post text, and follow-up comments use separate provider limits.',
			detail: '3,000 post · 1,250 comment',
			chips: ['PDF document', 'Comment child', 'Organization-ready']
		},
		accountRequirement:
			'A LinkedIn developer app with the publishing products and scopes your account needs.',
		auth: 'OAuth 2.0',
		setup: [
			'Configure the LinkedIn client ID, secret, and callback URL.',
			'Confirm the app has the publishing products and permissions you need.',
			'Connect the member or organization account and test each approved media type.'
		],
		formats: [
			{
				name: 'Post or link',
				text: '3,000 characters',
				media: 'Text or link metadata'
			},
			{
				name: 'Comment thread',
				text: '1,250 characters per child',
				media: 'Text only'
			},
			{
				name: 'Image, document, or video',
				text: '3,000 characters',
				media: 'One image, PDF document, or video per rendition'
			}
		],
		limits: [
			`${PLATFORM_LIMITS.linkedin.charLimit} characters for posts`,
			'1,250 characters for thread comments',
			PLATFORM_LIMITS.linkedin.media,
			'Thread children publish as comments'
		],
		limitations: [
			'Publishing and comment permissions depend on LinkedIn products, scopes, and app review.',
			'Documents use the LinkedIn Documents API and require a title.',
			'Organization posting depends on the connected member role and granted access.'
		],
		verification:
			'OAuth success alone does not prove every publishing permission; test the formats your team will schedule.',
		docsUrl: `${siteUrl.replace('openpost.social', 'docs.openpost.social')}/providers/linkedin/`
	},
	{
		slug: 'threads',
		name: 'Threads',
		short: 'threads',
		tag: 'Posts, replies, carousels',
		status: 'Available',
		statusDetail: 'Publishing path implemented',
		description:
			'Schedule text, image, video, carousel, and reply-thread publications for connected Threads accounts.',
		heroTitle: 'Arrange a Threads carousel and the replies that follow it.',
		preview: {
			label: 'Carousel',
			headline: 'Four media items, one Threads post',
			body: 'Public image and video URLs are checked before Meta fetches the carousel.',
			detail: '2-10 public media items',
			chips: ['Image', 'Video', 'Reply chain']
		},
		accountRequirement: 'An approved Meta app and public HTTPS media hosting for media posts.',
		auth: 'Meta OAuth 2.0',
		setup: [
			'Configure the Threads app credentials and exact OAuth redirect URI.',
			'Make stored media reachable through a public HTTPS URL that Meta can fetch.',
			'Connect the account and test image, video, or carousel publishing from production-like hosting.'
		],
		formats: [
			{
				name: 'Post or reply thread',
				text: '500 characters',
				media: 'Text only'
			},
			{
				name: 'Image or video',
				text: '500 characters',
				media: 'One public HTTPS media item'
			},
			{
				name: 'Carousel',
				text: '500 characters',
				media: '2-10 public HTTPS images or videos'
			}
		],
		limits: [
			`${PLATFORM_LIMITS.threads.charLimit} characters`,
			PLATFORM_LIMITS.threads.media,
			'Reply chains',
			'Public media URL and approved Meta app access required'
		],
		limitations: [
			'Meta fetches media server-side; localhost, private URLs, and inaccessible object storage will fail.',
			'Video processing and account permissions can still fail after a successful OAuth connection.',
			'Local development needs a public tunnel for callbacks and media.'
		],
		verification:
			'Verify that Meta can fetch the exact production media URL before scheduling media-heavy work.',
		docsUrl: `${siteUrl.replace('openpost.social', 'docs.openpost.social')}/providers/threads/`
	},
	{
		slug: 'facebook',
		name: 'Facebook Pages',
		short: 'facebook',
		tag: 'Pages, media, Stories',
		status: 'Supported',
		statusDetail: 'Meta review and Page permissions still apply',
		description:
			'OpenPost has publishing paths for selected Facebook Pages, including text, photos, video, and Stories.',
		heroTitle: 'Prepare a Facebook Page post and its media placement together.',
		preview: {
			label: 'Selected Page',
			headline: 'Feed post or Story',
			body: 'Page selection, placement, and public media access are verified as separate requirements.',
			detail: 'Pages only',
			chips: ['Feed', 'Multi-photo', 'Story']
		},
		accountRequirement:
			'A Facebook Page, eligible Meta user, configured Meta app, and the required reviewed permissions.',
		auth: 'Meta OAuth 2.0 with Page selection',
		setup: [
			'Configure the Facebook provider app, scopes, and callback URI.',
			'Connect through Meta and choose the Page OpenPost should publish to.',
			'Complete provider review and run a live Page audit before production scheduling.'
		],
		formats: [
			{
				name: 'Page post or link',
				text: '63,206 characters',
				media: 'Text or link metadata'
			},
			{
				name: 'Photo or multi-photo',
				text: '63,206 characters',
				media: '1 image or 2-10 public HTTPS photos'
			},
			{
				name: 'Video or Story',
				text: '63,206 characters for video',
				media: 'One public HTTPS video; Story accepts one image or video'
			}
		],
		limits: [
			`${PLATFORM_LIMITS.facebook.charLimit.toLocaleString()} characters`,
			PLATFORM_LIMITS.facebook.media,
			'Multi-photo, Story, and video profiles',
			'Provider permissions and live-account verification required'
		],
		limitations: [
			'Provider review and Page permissions determine whether a specific Page and format are usable.',
			'Media must be available at a public HTTPS URL that Meta can fetch.',
			'This integration publishes to Pages, not personal Facebook profiles.'
		],
		verification:
			'Do not plan a launch around this integration until Page selection and every required format pass a live audit.',
		docsUrl: `${siteUrl.replace('openpost.social', 'docs.openpost.social')}/providers/facebook/`
	},
	{
		slug: 'instagram',
		name: 'Instagram',
		short: 'instagram',
		tag: 'Feed, carousel, Story, Reel',
		status: 'Supported',
		statusDetail: 'Business or Creator account and Meta review required',
		description:
			'OpenPost has media-first publishing paths for Instagram feed posts, carousels, Stories, and Reels.',
		heroTitle: 'Choose the Instagram placement before you shape the caption.',
		preview: {
			label: 'Media-first',
			headline: 'Feed, carousel, Story, or Reel',
			body: 'The selected placement determines its media count, caption, and provider checks.',
			detail: 'No text-only posts',
			chips: ['1:1 Feed', '9:16 Story', '9:16 Reel']
		},
		accountRequirement: 'An Instagram Business or Creator account connected to a Facebook Page.',
		auth: 'Meta OAuth 2.0 with account selection',
		setup: [
			'Connect an eligible Instagram Business or Creator account to a Facebook Page.',
			'Configure the Instagram provider app, scopes, callback URI, and public media host.',
			'Choose the Instagram account during OAuth and complete a live format audit.'
		],
		formats: [
			{
				name: 'Feed image',
				text: '2,200 caption characters',
				media: 'One public HTTPS image'
			},
			{
				name: 'Carousel',
				text: '2,200 caption characters',
				media: '2-10 public HTTPS images or videos'
			},
			{
				name: 'Story or Reel',
				text: 'No Story caption; 2,200 for Reel',
				media: 'Public HTTPS media required'
			}
		],
		limits: [
			`${PLATFORM_LIMITS.instagram.charLimit.toLocaleString()} caption characters`,
			PLATFORM_LIMITS.instagram.media,
			'Feed, carousel, Story, and Reel profiles',
			'Business or Creator accounts connected to a Facebook Page',
			'No text-only posts'
		],
		limitations: [
			'Instagram has no text-only publication profile in OpenPost.',
			'Media must be public HTTPS and meet Meta format rules.',
			'Provider access and each planned placement still need a live-account audit.'
		],
		verification:
			'Test each planned placement—feed, carousel, Story, and Reel—because one successful format does not prove the others.',
		docsUrl: `${siteUrl.replace('openpost.social', 'docs.openpost.social')}/providers/instagram/`
	},
	{
		slug: 'tiktok',
		name: 'TikTok',
		short: 'tiktok',
		tag: 'Video and photo posts',
		status: 'Supported',
		statusDetail: 'App review and provider audit required',
		description:
			'OpenPost implements TikTok video and photo-post flows, with profile-specific caption limits.',
		heroTitle: 'Build a TikTok video or photo post with the correct caption limit.',
		preview: {
			label: 'Two publishing profiles',
			headline: 'Video or 1-35 photos',
			body: 'Video and photo posts keep different captions, media rules, and app-review checks.',
			detail: '2,200 video · 4,000 photo',
			chips: ['9:16 video', 'Photo post', 'Provider audit']
		},
		accountRequirement:
			'A TikTok developer app with Content Posting API access and approved Direct Post permissions.',
		auth: 'OAuth 2.0',
		setup: [
			'Configure the TikTok provider app, redirect URI, scopes, and content-posting access.',
			'Verify the public media URL prefix or domain in the TikTok developer console.',
			'Complete app review and audit both video and photo publishing with the real account.'
		],
		formats: [
			{
				name: 'Video',
				text: '2,200 caption characters',
				media: 'One public HTTPS MP4 or QuickTime video'
			},
			{
				name: 'Photo post',
				text: '4,000 caption characters',
				media: '1-35 public HTTPS JPEG or WebP images'
			}
		],
		limits: [
			`${PLATFORM_LIMITS.tiktok.charLimit.toLocaleString()} characters for video captions`,
			'4,000 characters for photo-post captions',
			PLATFORM_LIMITS.tiktok.media,
			'Photo posts support 1-35 JPEG or WebP images',
			'Provider review and live audit required'
		],
		limitations: [
			'TikTok publishing is blocked until app-review and provider-audit requirements are satisfied.',
			'Pull-from-URL media must use a verified public HTTPS prefix or domain.',
			'Video and photo posts use different caption and media constraints.'
		],
		verification:
			'Treat the integration as unavailable for production until both provider review and the intended publishing flow pass.',
		docsUrl: `${siteUrl.replace('openpost.social', 'docs.openpost.social')}/providers/tiktok/`
	},
	{
		slug: 'youtube',
		name: 'YouTube',
		short: 'youtube',
		tag: 'Shorts and long video',
		status: 'Supported',
		statusDetail: 'Provider audit required',
		description:
			'OpenPost implements resumable Shorts and video uploads to a selected YouTube channel.',
		heroTitle: 'Schedule the YouTube video with its title, privacy, and channel metadata.',
		preview: {
			label: 'Resumable upload',
			headline: 'Release walkthrough · 08:42',
			body: 'Title, description, privacy, thumbnail, playlist, and processing state stay with the upload.',
			detail: 'One video per rendition',
			chips: ['Private by default', 'Thumbnail', 'Playlist']
		},
		accountRequirement:
			'A Google Cloud OAuth app with YouTube Data API v3 and an eligible YouTube channel.',
		auth: 'Google OAuth 2.0 with channel selection',
		setup: [
			'Enable YouTube Data API v3 and configure the Google OAuth app and callback URI.',
			'Request the required profile, channel-read, and upload scopes.',
			'Choose a channel during connection and complete a resumable upload audit.'
		],
		formats: [
			{
				name: 'Short',
				text: 'Required title; up to 5,000 description characters',
				media: 'Exactly one short video'
			},
			{
				name: 'Video',
				text: 'Required title; up to 5,000 description characters',
				media: 'Exactly one video, up to the long-video profile limit'
			}
		],
		limits: [
			`${PLATFORM_LIMITS.youtube.charLimit.toLocaleString()} description characters`,
			PLATFORM_LIMITS.youtube.media,
			'Title required',
			'Unaudited Google projects can force uploads private'
		],
		limitations: [
			'The Google project and live channel must pass a provider audit before production use.',
			'Unaudited Google projects can force uploads to private visibility.',
			'Exactly one video is accepted per rendition; text-only YouTube posts are not supported.'
		],
		verification:
			'Confirm upload, processing completion, thumbnail, playlist, and final privacy on the production channel.',
		docsUrl: `${siteUrl.replace('openpost.social', 'docs.openpost.social')}/providers/youtube/`
	}
] as const;

export const platformLimitSummaries = publicPlatformLimits();

export const launchProviderMatrix = [
	{
		slug: 'x',
		name: 'X',
		short: 'x',
		state: 'Available',
		text: 'Posts and links · 280 standard, up to 25,000 subscribed',
		media: '1-4 images or 1 account-tier-aware video',
		threads: 'Reply chains',
		schedule: 'Supported',
		verify: 'OAuth 1.0a, API tier, quota, and each planned format'
	},
	{
		slug: 'linkedin',
		name: 'LinkedIn',
		short: 'linkedin',
		state: 'Available',
		text: 'Posts and links · 3,000 characters',
		media: '1 image, PDF, or video',
		threads: 'Comment continuations',
		schedule: 'Supported',
		verify: 'App products, scopes, account role, and each planned format'
	},
	{
		slug: 'bluesky',
		name: 'Bluesky',
		short: 'bluesky',
		state: 'Available',
		text: 'Posts and links · 300 characters',
		media: '1-4 images or 1 MP4 video',
		threads: 'AT Protocol replies',
		schedule: 'Supported',
		verify: 'App password and a real-account video test when video is planned'
	},
	{
		slug: 'mastodon',
		name: 'Mastodon',
		short: 'mastodon',
		state: 'Available',
		text: 'Posts and links · 500 characters by default',
		media: 'Up to 4 attachments by default',
		threads: 'Reply chains',
		schedule: 'Supported',
		verify: 'Destination instance rules and a media test on that server'
	},
	{
		slug: 'threads',
		name: 'Threads',
		short: 'threads',
		state: 'Available',
		text: 'Posts and replies · 500 characters',
		media: '1 item or a 2-10 item carousel',
		threads: 'Reply chains',
		schedule: 'Supported',
		verify: 'Approved Meta access and fetchable production HTTPS media URLs'
	}
] as const;

export const illustrativeLaunchRenditions = [
	{
		slug: 'x',
		name: 'X',
		short: 'x',
		purpose: 'Compact technical hook',
		content:
			'AI can draft the campaign. It still should not publish blind. OpenPost keeps provider credentials inside the workspace, shows every destination, and schedules through one visible queue.'
	},
	{
		slug: 'linkedin',
		name: 'LinkedIn',
		short: 'linkedin',
		purpose: 'Context for a professional audience',
		content:
			'The useful boundary is not AI versus no AI. It is whether an agent receives a social account credential or works through a revocable, workspace-bound publishing system. We built OpenPost for the second model.'
	},
	{
		slug: 'bluesky',
		name: 'Bluesky',
		short: 'bluesky',
		purpose: 'Short open-source update',
		content:
			'An agent prepared this campaign without seeing a provider token. I reviewed each destination in OpenPost, then chose what entered the queue. Open source, hosted or self-hosted.'
	},
	{
		slug: 'mastodon',
		name: 'Mastodon',
		short: 'mastodon',
		purpose: 'Self-hosting detail',
		content:
			'OpenPost is a publishing workspace for humans and agents. Run the managed app or self-host one Go service with SQLite and local media by default. Redis is not required.'
	},
	{
		slug: 'threads',
		name: 'Threads',
		short: 'threads',
		purpose: 'Conversational summary',
		content:
			'The agent prepared the draft. I checked the copy, media, and timing for every destination. OpenPost kept the credentials and the publishing queue in one place.'
	}
] as const;

export const productFeatures = [
	{
		eyebrow: 'Composer',
		title: 'Review the shared draft and every destination rendition together.',
		description:
			'An agent or a person can prepare the campaign. The web composer keeps the base content, account-specific copy, media, formats, and schedule available for human review.',
		icon: MessageSquareText,
		image: '/assets/screenshots/main-dark.png',
		alt: 'OpenPost composer and schedule calendar'
	},
	{
		eyebrow: 'Social accounts',
		title: 'Keep provider credentials behind the OpenPost boundary.',
		description:
			'Agents and scripts authenticate to OpenPost with revocable tokens. Connected provider credentials stay encrypted in OpenPost and are not handed to the client.',
		icon: PanelTop,
		image: '/assets/screenshots/accounts-dark.png',
		alt: 'OpenPost Social accounts page with connected account and provider readiness cards'
	},
	{
		eyebrow: 'Media',
		title: 'Give the campaign one governed media library.',
		description:
			'People and automation can work from the same workspace assets while OpenPost preserves usage, alt text, destination links, and deletion guards.',
		icon: Library,
		image: '/assets/screenshots/media-dark.png',
		alt: 'OpenPost media library'
	},
	{
		eyebrow: 'Workspace settings',
		title: 'See who or what can act in each workspace.',
		description:
			'Review workspace members, sessions, dedicated API and MCP tokens, recent tool activity, posting slots, billing, and security controls from one settings area.',
		icon: Activity,
		image: '/assets/screenshots/settings-dark.png',
		alt: 'OpenPost workspace settings with schedule, security, team, billing, and developer sections'
	}
] as const;

export const workflowBlocks = [
	{
		title: 'Workspace-bound access',
		description:
			'Use workspace-scoped mcp:read for inspection or mcp:full for mutations, then revoke access without rotating provider credentials.',
		icon: UsersRound
	},
	{
		title: 'Read and mutation split',
		description:
			'MCP exposes guaranteed read-only queries separately from operations that change state or act externally.',
		icon: GitBranch
	},
	{
		title: 'Destination review',
		description:
			'Compare account-specific copy, media, formats, limits, and timing in the web app before scheduling.',
		icon: Workflow
	},
	{
		title: 'Visible queue and failures',
		description:
			'Scheduled work uses a durable database queue, with publishing outcomes and provider failures kept visible.',
		icon: CalendarClock
	}
] as const;

export const securityItems = [
	{
		title: 'Encrypted provider tokens',
		description:
			'Social access and refresh tokens use AES-256-GCM authenticated encryption at rest.',
		icon: LockKeyhole
	},
	{
		title: 'TOTP, passkeys, and sessions',
		description:
			'Users can add a second sign-in factor and review or revoke active browser sessions.',
		icon: ShieldCheck
	},
	{
		title: 'Revocable automation tokens',
		description:
			'CLI, CI, cron, and MCP clients use dedicated tokens that can be limited to one workspace; MCP offers enforced read-only and full scopes.',
		icon: KeyRound
	},
	{
		title: 'Source you can inspect',
		description:
			'The API, queue, credential storage, and provider adapter implementations are public.',
		icon: Code2
	}
] as const;

export const tools = [
	{
		slug: 'multi-platform-character-counter',
		name: 'Multi-platform character counter',
		description:
			'Paste once and compare one draft against the limits and counting rules for nine platforms.',
		icon: FileText
	},
	{
		slug: 'post-preview-generator',
		name: 'Post preview generator',
		description:
			'Preview how a post and media could render across selected destinations before you schedule.',
		icon: PanelTop
	},
	{
		slug: 'thread-splitter',
		name: 'Thread splitter',
		description:
			'Turn long copy into platform-aware thread slices that are easier to review and schedule.',
		icon: GitBranch
	},
	{
		slug: 'fediverse-handle-checker',
		name: 'Fediverse handle checker',
		description:
			'Check Mastodon-style and Bluesky-style handles before adding them to launch plans.',
		icon: CheckCircle2
	},
	{
		slug: 'linkedin-text-formatter',
		name: 'LinkedIn text formatter',
		description: 'Prepare readable LinkedIn copy with lightweight formatting and length awareness.',
		icon: MessageSquareText
	},
	{
		slug: 'best-time-to-post-calculator',
		name: 'Timezone posting planner',
		description: 'Translate timezone and cadence preferences into reusable posting slots.',
		icon: Clock3
	}
] as const;

export const comparisons = [
	{
		slug: 'buffer',
		name: 'Buffer',
		category: 'Established hosted scheduler',
		bestFor:
			'Creators and teams that want a polished hosted scheduler with analytics and community workflows.',
		openPostAngle:
			'Buffer is an established hosted scheduler. OpenPost is the publishing layer for human and agent workflows, with workspace-bound automation, provider credentials kept inside the service, and a compact self-hosted option.',
		verdict:
			'Choose Buffer for its established hosted workflow and analytics. Choose OpenPost when source access, self-hosting, explicit publishing state, or a smaller operational model matters more.',
		pricing:
			'Buffer offers Free, Essentials, and Team plans and prices paid use by channel. OpenPost prices managed plans by workspace, account, post, media, and seat limits.',
		chooseOpenPost: [
			'You want agents to work through revocable workspace access instead of receiving provider credentials.',
			'You want an AGPL-licensed implementation and a supported self-host path.',
			'You want drafts, renditions, jobs, and failures visible as publishing state.',
			'You prefer workspace-based managed plans to per-channel pricing.'
		],
		chooseThem: [
			'You need mature analytics, ideas, and community engagement today.',
			'You want a long-established hosted product with a larger support ecosystem.'
		],
		rows: [
			{
				area: 'Publishing',
				openpost:
					'Base posts, account renditions, reusable media, queues, and visible job outcomes.',
				competitor:
					'Multi-channel planning, queueing, ideas, and publishing in a mature hosted workflow.'
			},
			{
				area: 'Analytics and engagement',
				openpost:
					'Provider-reported analytics, stored engagement, and supported-account inboxes; no listening or enterprise benchmarks.',
				competitor: 'Analytics and community workflows are part of Buffer’s product.'
			},
			{
				area: 'Automation',
				openpost: 'HTTP API, CLI, MCP, scoped tokens, and assistant-facing operations.',
				competitor:
					'Public GraphQL API, CLI, and MCP are available, including on the Free plan with plan-specific limits.'
			},
			{
				area: 'Hosting and source',
				openpost: 'AGPL-3.0-only source, managed app, or self-hosted deployment.',
				competitor: 'Hosted proprietary service.'
			}
		],
		sources: [
			{ label: 'Buffer pricing', href: 'https://buffer.com/pricing' },
			{ label: 'Buffer API', href: 'https://buffer.com/api' },
			{
				label: 'Buffer MCP guide',
				href: 'https://developers.buffer.com/guides/integrations/mcp.html'
			}
		],
		reviewedAt: '2026-07-22'
	},
	{
		slug: 'hootsuite',
		name: 'Hootsuite',
		category: 'Full social management suite',
		bestFor:
			'Organizations that need publishing, inbox, analytics, listening, governance, and enterprise services together.',
		openPostAngle:
			'OpenPost is a focused publishing layer for people and automation. Hootsuite is a much broader social management system with inbox, listening, analytics, ads, and enterprise controls.',
		verdict:
			'Hootsuite is the stronger fit for social teams that need to monitor, engage, report, and govern at enterprise scale. OpenPost fits teams that mainly need publishing and automation without that suite footprint.',
		pricing:
			'Hootsuite sells Standard, Professional, and Advanced plans per user, plus custom Enterprise plans. OpenPost publishes fixed monthly managed-app prices and explicit usage limits.',
		chooseOpenPost: [
			'You want destination drafts and queue outcomes to remain reviewable around agent-assisted work.',
			'Your core job is drafting, adapting, scheduling, and monitoring outbound posts.',
			'You want open source, self-hosting, and a small service without Redis.',
			'Your scope is outbound publishing rather than social listening, an engagement inbox, or enterprise governance.'
		],
		chooseThem: [
			'You need a unified inbox, listening, competitive intelligence, and advanced reporting.',
			'You need enterprise permissions, SSO, compliance integrations, or services.'
		],
		rows: [
			{
				area: 'Publishing',
				openpost:
					'Focused composer, account renditions, posting slots, queues, media, and job visibility.',
				competitor:
					'Unlimited scheduling on current plans, calendar, content library, bulk tools, and recommended times.'
			},
			{
				area: 'Beyond publishing',
				openpost:
					'Stored engagement, personal alerts, and supported-account inboxes; no advanced listening or advertising.',
				competitor:
					'Inbox, analytics, listening, ads, benchmarking, and AI insights are core parts of the suite.'
			},
			{
				area: 'Automation',
				openpost: 'HTTP API, CLI, MCP, and workspace-bound tokens.',
				competitor:
					'Hootsuite now publishes MCP connectors for publishing, inbox, and listening workflows.'
			},
			{
				area: 'Operations',
				openpost: 'Managed app or compact self-hosted deployment.',
				competitor:
					'Hosted service with enterprise plans, procurement, support, and compliance options.'
			}
		],
		sources: [
			{ label: 'Hootsuite plans', href: 'https://www.hootsuite.com/plans' },
			{
				label: 'Hootsuite MCP connectors',
				href: 'https://www.hootsuite.com/integrations/mcp'
			}
		],
		reviewedAt: '2026-07-22'
	},
	{
		slug: 'typefully',
		name: 'Typefully',
		category: 'Writing-first social workspace',
		bestFor:
			'Creators and teams that want a highly polished writing, review, queue, and cross-platform publishing workflow.',
		openPostAngle:
			'Typefully is a mature writing-led workspace with agent integrations. OpenPost emphasizes the boundary between agents and connected accounts: scoped access, destination renditions, human review, and visible queue state.',
		verdict:
			'Typefully is the stronger writing-first product. OpenPost is the better fit when self-hosting, inspectable provider adapters, reusable operational primitives, or a Go single-service deployment are requirements.',
		pricing:
			'Typefully sells hosted creator and team plans. OpenPost sells managed plans and also provides the complete server under AGPL-3.0-only.',
		chooseOpenPost: [
			'You want provider credentials kept behind a revocable workspace-bound automation layer.',
			'You require source access or want to run the publishing service yourself.',
			'You want provider capability, queue-job, failure, and storage behavior to be inspectable.',
			'You prefer an operations-focused publishing workspace over a writing-led product.'
		],
		chooseThem: [
			'Writing, editing, collaboration, and content refinement are the center of your workflow.',
			'You want Typefully’s mature queue, API v2, MCP, webhooks, and agent-skill ecosystem.'
		],
		rows: [
			{
				area: 'Platforms and variants',
				openpost:
					'Account-specific renditions across supported adapters with explicit provider gates.',
				competitor:
					'API v2 supports X, LinkedIn, Mastodon, Threads, and Bluesky with different content per platform.'
			},
			{
				area: 'Writing workflow',
				openpost: 'Focused composer with prompts, previews, formats, and media reuse.',
				competitor:
					'Writing, thread editing, review, sharing, queueing, and collaboration are core strengths.'
			},
			{
				area: 'Automation',
				openpost: 'HTTP API, CLI, compact MCP catalog, and scoped automation tokens.',
				competitor:
					'Public API v2, MCP, webhooks, Zapier, and an agent skill; next-free-slot scheduling is supported.'
			},
			{
				area: 'Hosting and source',
				openpost: 'AGPL-licensed source plus managed and self-hosted options.',
				competitor: 'Hosted proprietary service.'
			}
		],
		sources: [
			{ label: 'Typefully pricing', href: 'https://typefully.com/pricing' },
			{ label: 'Typefully API v2', href: 'https://typefully.com/docs/api' },
			{
				label: 'API, MCP, and webhooks release',
				href: 'https://typefully.com/changelog/all-new-api-zapier-integration-mcp-and-126'
			},
			{
				label: 'Typefully help center',
				href: 'https://support.typefully.com/'
			}
		],
		reviewedAt: '2026-07-22'
	},
	{
		slug: 'postiz',
		name: 'Postiz',
		category: 'Broad open-source automation suite',
		bestFor:
			'Builders and teams that want many networks, AI generation, analytics, and agent-first automation.',
		openPostAngle:
			'Postiz is a broad open-source automation suite. OpenPost takes the narrower position: a human-reviewable publishing layer between agents and social accounts, packaged as one Go service with no Redis queue.',
		verdict:
			'Choose Postiz for network breadth and AI-heavy automation. Choose OpenPost for a quieter publishing product, explicit provider caveats, and a more compact runtime.',
		pricing:
			'Both offer cloud and self-hosted paths. Compare current hosted limits, subscription prices, and the operational cost of each self-hosted stack.',
		chooseOpenPost: [
			'You want the agent handoff, destination review, queue state, and provider failures to stay central.',
			'You want a focused composer, queue, reusable media, and transparent publishing failures.',
			'You prefer Go/SvelteKit, one service, and a database-backed queue without Redis.',
			'You want provider requirements and live-audit status documented per network.'
		],
		chooseThem: [
			'You need 30-plus integrations or channels beyond OpenPost’s current catalog.',
			'You want built-in AI image/video generation, analytics, and agent distribution tooling.'
		],
		rows: [
			{
				area: 'Network breadth',
				openpost:
					'Ten implemented provider adapters are documented, with runtime readiness and live verification reported separately.',
				competitor: 'Postiz advertises 30-plus platforms and integrations.'
			},
			{
				area: 'Automation',
				openpost: 'HTTP API, CLI, MCP, and workspace-bound tokens.',
				competitor: 'REST API, CLI, MCP, and agent skills are first-class product paths.'
			},
			{
				area: 'Product scope',
				openpost: 'Publishing, workspaces, media, schedules, and visible job outcomes.',
				competitor: 'Broader AI generation, analytics, and distribution suite.'
			},
			{
				area: 'Self-hosting',
				openpost: 'Single Go binary or container; SQLite by default; no Redis required.',
				competitor:
					'Open-source self-hosting and a managed cloud option with a larger service stack.'
			}
		],
		sources: [
			{ label: 'Postiz product', href: 'https://postiz.com/' },
			{ label: 'Postiz pricing', href: 'https://postiz.com/pricing' },
			{
				label: 'Postiz public API',
				href: 'https://docs.postiz.com/public-api'
			},
			{
				label: 'Postiz source',
				href: 'https://github.com/gitroomhq/postiz-app'
			}
		],
		reviewedAt: '2026-07-22'
	},
	{
		slug: 'post-bridge',
		name: 'Post Bridge',
		category: 'Straightforward hosted cross-poster',
		bestFor:
			'Creators and small teams that want simple hosted cross-platform scheduling and account-specific content overrides.',
		openPostAngle:
			'Post Bridge is a straightforward hosted cross-poster. OpenPost adds a workspace-bound agent layer, destination review, visible publishing state, open source, and self-hosting.',
		verdict:
			'Choose Post Bridge for a simple hosted path across its supported network list. Choose OpenPost when you need source access, self-hosting, threads, or deeper queue and failure visibility.',
		pricing:
			'Post Bridge requires a paid subscription and currently prices API access as a separate monthly add-on. OpenPost includes API, CLI, and MCP access across its managed plans.',
		chooseOpenPost: [
			'You want agent and script access to remain revocable and separate from provider credentials.',
			'You want an inspectable AGPL implementation and a self-host option.',
			'You need X or Threads reply-thread scheduling on implemented providers.',
			'You want CLI and MCP paths in addition to HTTP API access.'
		],
		chooseThem: [
			'You want a hosted cross-poster with a wide current platform list and minimal setup.',
			'You are comfortable with its separate API add-on and do not need self-hosting.'
		],
		rows: [
			{
				area: 'Publishing',
				openpost:
					'Base content, account renditions, formats, posting slots, and reply threads on core providers.',
				competitor:
					'Cross-platform scheduling with platform- and account-specific content overrides.'
			},
			{
				area: 'Scheduling horizon',
				openpost: 'Future scheduling and recurring workspace posting slots.',
				competitor: 'Official help documents scheduling up to two months ahead.'
			},
			{
				area: 'Automation',
				openpost: 'HTTP API, CLI, and MCP included in the product surface.',
				competitor:
					'Public HTTP API is available as a paid add-on; current docs show posting, media, accounts, results, and some analytics.'
			},
			{
				area: 'Threads and hosting',
				openpost: 'Reply threads on implemented providers; managed or self-hosted.',
				competitor:
					'Official help says X and Threads thread scheduling is not currently supported; hosted service only.'
			}
		],
		sources: [
			{
				label: 'Post Bridge API overview',
				href: 'https://support.post-bridge.com/api/post-bridge-api-overview-access-and-pricing'
			},
			{
				label: 'Post Bridge API reference',
				href: 'https://api.post-bridge.com/reference'
			},
			{
				label: 'Thread scheduling limits',
				href: 'https://support.post-bridge.com/social-media-scheduling/thread-scheduling-on-x-twitter-and-instagram-threads-current-limitations'
			}
		],
		reviewedAt: '2026-07-22'
	},
	{
		slug: 'mixpost',
		name: 'Mixpost',
		category: 'Self-host-first social suite',
		bestFor:
			'Laravel teams that want a larger self-hosted product, one-time paid editions, analytics, and unlimited team access.',
		openPostAngle:
			'Mixpost is the stronger self-host-first suite. OpenPost is a smaller publishing layer for humans and agents, available as a managed app or one Go binary or container with no Redis requirement.',
		verdict:
			'Choose Mixpost when Laravel, self-hosting, analytics, and its wider Pro feature set fit your team. Choose OpenPost when you want a managed default, a smaller runtime, and one open-source edition.',
		pricing:
			'Mixpost offers a free Lite edition and one-time Pro and Enterprise licences. OpenPost offers the full AGPL server at no software charge plus monthly managed-app plans.',
		chooseOpenPost: [
			'You want agent access, destination review, and queue outcomes in the same focused workflow.',
			'You want the hosted app to be the default path with self-hosting still available.',
			'You prefer Go/SvelteKit and one binary or container without Redis.',
			'You want one AGPL-licensed codebase rather than separate product editions.'
		],
		chooseThem: [
			'You run Laravel/PHP and want a self-host-first social management product.',
			'You need Mixpost Pro’s analytics, approval, API, MCP, webhooks, or broader suite features.'
		],
		rows: [
			{
				area: 'Product model',
				openpost: 'One AGPL edition, available as a managed app or self-hosted server.',
				competitor: 'Free open-source Lite plus one-time paid Pro and Enterprise editions.'
			},
			{
				area: 'Publishing suite',
				openpost: 'Focused composer, renditions, media, schedules, and job outcomes.',
				competitor:
					'Broader self-hosted suite with analytics, approval, AI features, and unlimited team members in paid editions.'
			},
			{
				area: 'Automation',
				openpost: 'HTTP API, CLI, MCP, and workspace-bound tokens.',
				competitor:
					'Mixpost’s current pricing page lists API, MCP, and webhooks for its paid product.'
			},
			{
				area: 'Runtime',
				openpost: 'Go/SvelteKit, SQLite by default, one binary or container, no Redis required.',
				competitor:
					'Laravel/PHP deployment intended for operators already comfortable with that stack.'
			}
		],
		sources: [
			{
				label: 'Mixpost pricing and editions',
				href: 'https://mixpost.app/pricing'
			},
			{ label: 'Mixpost source', href: 'https://github.com/inovector/mixpost' }
		],
		reviewedAt: '2026-07-22'
	}
] as const;

export const faqs = [
	{
		question: 'Can an AI agent see my social account credentials?',
		answer:
			'No. The agent authenticates to OpenPost with a dedicated API or MCP token. Provider credentials stay encrypted inside OpenPost. Use workspace-scoped mcp:read for inspection and grant mcp:full only when the client must create, change, schedule, or publish.'
	},
	{
		question: 'Is there a hosted free plan or automatic trial?',
		answer:
			'No hosted free plan is implemented. You can create an account and one workspace before checkout, but connecting social accounts and publishing require an active paid plan, starting at €6 per month. A checkout may grant trialing status only when the billing offer explicitly provides it.'
	},
	{
		question: 'Is using OpenPost different from self-hosting?',
		answer:
			'The app at app.openpost.social is the managed version. The project is open source and self-hostable, while the landing page focuses on the ready-to-use workflow.'
	},
	{
		question: 'Does OpenPost include analytics?',
		answer:
			'Yes. OpenPost stores supported account growth and publication engagement counters for 7, 30, or 90 days. Metric coverage depends on provider permissions. It does not include a social inbox, listening, or enterprise benchmarking.'
	},
	{
		question: 'Does video publishing work everywhere?',
		answer:
			'Video support depends on the provider. Some adapters support it, but each provider has different rules, review requirements, media limits, and public URL needs.'
	},
	{
		question: 'Can I bring my own provider app credentials?',
		answer:
			'Yes. Operators can configure provider apps, and self-hosted users can use environment configuration or the provider app registry depending on the provider.'
	},
	{
		question: 'What happens if a post fails?',
		answer:
			'The post and its publishing job keep a failed state and provider reason so you can review the destination outcome before retrying.'
	}
] as const;

export const changelogEntries = [
	{
		date: '2026-07-22',
		category: 'Security and account control',
		title: 'Account recovery, export, deletion, and safer releases',
		detail:
			'OpenPost added password recovery and changes, account export and deletion, hosted legal acceptance, production dependency scans, and verified backup and restore tooling.',
		highlights: [
			'Enumeration-safe password recovery and session reset controls',
			'Account export and guarded permanent deletion',
			'Go and production JavaScript vulnerability scans in CI and release preflight'
		],
		href: `${githubUrl}/blob/main/CHANGELOG.md#unreleased`
	},
	{
		date: '2026-07-21',
		category: 'Composer and product tour',
		title: 'A clearer composer and a real product demo',
		detail:
			'Account selection and per-account content now share one composer menu, calendar previews are tighter, and the public product demo is available from the site, app, docs, and README.',
		highlights: [
			'One destination menu for account selection and custom content',
			'Compact calendar previews with destination icons',
			'Recorded walkthrough linked from every main entry point'
		],
		href: `${githubUrl}/commits/main/`
	},
	{
		date: '2026-07-18',
		category: 'Application experience',
		title: 'Responsive app states and faster settings',
		detail:
			'Authenticated pages now use shared headers, loading, empty, error, toast, and confirmation patterns. Settings loads each subsystem only when its section opens.',
		highlights: [
			'Consistent desktop and mobile page states',
			'Forty-four-pixel portrait touch targets',
			'Lazy-loaded security, developer, team, billing, and schedule settings'
		],
		href: `${githubUrl}/blob/main/CHANGELOG.md#unreleased`
	},
	{
		date: '2026-07-06',
		category: 'Publishing engine',
		title: 'Format-first publishing and provider-aware validation',
		detail:
			'OpenPost added publication renditions, capability-driven formats, provider readiness checks, richer media validation, resumable YouTube uploads, and provider-specific settings across the app, CLI, and MCP.',
		highlights: [
			'Explicit image, carousel, Story, short-video, long-video, and document profiles',
			'Account-specific renditions with provider validation before scheduling',
			'Provider comment and moderation operations for supported networks'
		],
		href: `${githubUrl}/releases/latest`
	}
] as const;

export function getPlatform(slug: string) {
	return platforms.find((platform) => platform.slug === slug);
}

export function getComparison(slug: string) {
	return comparisons.find((comparison) => comparison.slug === slug);
}

export function getTool(slug: string) {
	return tools.find((tool) => tool.slug === slug);
}

export type PlatformSlug = (typeof platforms)[number]['slug'];
export type MarketingPlatform = (typeof platforms)[number];
export type ComparisonSlug = (typeof comparisons)[number]['slug'];
export type ToolSlug = (typeof tools)[number]['slug'];
