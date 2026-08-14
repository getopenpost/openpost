import { planCatalog, purchaseTerms } from '@openpost/plan-catalog';
import { PLATFORM_LIMITS } from '../../../frontend/src/lib/platform-limits';
import publicClaimManifest from '../../../provider-certification/public-claims.json';
import { attachComparisonEvidence } from './_comparison-evidence';

type PublicProviderClaim = {
	subject: {
		provider: string;
		output_profile: string;
	};
};

export const appUrl = 'https://app.openpost.social';
export const managedSignupUrl = `${appUrl}/register?plan=founder&billing_period=monthly`;
export const billingSettingsUrl = `${appUrl}/settings?tab=billing#billing`;
export const userDocsUrl = 'https://docs.openpost.social/usage/';
export const selfHostingDocsUrl = 'https://docs.openpost.social/self-hosting/';
export const developerDocsUrl = 'https://docs.openpost.social/development/';
export const docsUrl = userDocsUrl;
export const githubUrl = 'https://github.com/getopenpost/openpost';
export const siteUrl = 'https://openpost.social';
export const discordCommunityUrl = 'https://discord.gg/u2QwukmY4W';
export const supportEmail = 'openpost@rgo.pt';
export const supportMailUrl = `mailto:${supportEmail}`;
export const demoVideoUrl = 'https://youtu.be/_mZf3HzQaN8';
export const demoVideoEmbedUrl =
	'https://www.youtube-nocookie.com/embed/_mZf3HzQaN8?autoplay=1&rel=0';

export const navItems = [
	{ label: 'Features', href: '/features' },
	{ label: 'Platforms', href: '/platforms' },
	{ label: 'Pricing', href: '/pricing' },
	{ label: 'Free tools', href: '/tools' }
] as const;

export const resourceItems = [
	{ label: 'Platforms', href: '/platforms' },
	{ label: 'Compare', href: '/compare' },
	{ label: 'FAQ', href: '/faq' },
	{ label: 'Security', href: '/security' },
	{ label: 'Trust register', href: '/trust' },
	{ label: 'Changelog', href: '/changelog' },
	{ label: 'Developers', href: developerDocsUrl }
] as const;

const dueToday = `$${purchaseTerms.due_today_usd.toLocaleString('en-US')}`;
export const managedCardRequirement = purchaseTerms.card_required
	? 'A card is required'
	: 'No card is required';
export const managedPaymentExpectation = purchaseTerms.card_required
	? `${dueToday} is due today. A card is required at checkout.`
	: `${dueToday} is due today. No card is required at checkout.`;
export const managedAccessSummary = `Start with a ${purchaseTerms.trial_days}-day free trial. ${managedCardRequirement}, and you can cancel before the first charge.`;

export const publicProviderCertification = {
	currentClaimCount: publicClaimManifest.claims.length,
	summary:
		publicClaimManifest.claims.length === 0
			? 'No exact managed provider-format certification claim is current.'
			: `${publicClaimManifest.claims.length} exact managed provider-format certification claim${publicClaimManifest.claims.length === 1 ? ' is' : 's are'} current.`
} as const;

const formatUSD = (value: number) => `$${value.toLocaleString('en-US')}`;
const formatLimit = (count: number, singular: string, plural = `${singular}s`) =>
	`${count.toLocaleString('en-US')} ${count === 1 ? singular : plural}`;

export const plans = planCatalog.plans.map((plan) => ({
	id: plan.id,
	name: plan.name,
	price: formatUSD(plan.monthly_price_usd),
	annualPrice: formatUSD(plan.annual_price_usd),
	description: plan.description,
	bestFor: plan.best_for,
	workspaces: plan.limits.workspaces.toLocaleString('en-US'),
	accounts: plan.limits.social_accounts.toLocaleString('en-US'),
	posts: plan.limits.scheduled_posts_monthly.toLocaleString('en-US'),
	storage: `${plan.limits.media_bytes_stored / 1_000_000_000} GB`,
	seats: plan.limits.team_members.toLocaleString('en-US'),
	limits: [
		formatLimit(plan.limits.workspaces, 'workspace'),
		formatLimit(plan.limits.social_accounts, 'social account'),
		`${plan.limits.scheduled_posts_monthly.toLocaleString('en-US')} scheduled posts/month`,
		`${plan.limits.media_bytes_stored / 1_000_000_000} GB media`,
		plan.limits.team_members === 1
			? '1 seat'
			: `${plan.limits.team_members.toLocaleString('en-US')} included seats`
	],
	featured: plan.featured
}));

export const featureGroups = [
	{
		id: 'compose',
		label: 'Compose and adapt',
		title: 'Keep one source idea and make each destination version fit.',
		outcome:
			'Write the shared publication once, then change text, media, schedule, and provider settings for each selected account before it leaves OpenPost.',
		scope: [
			'Posts, threads, Stories, short videos, and videos use focused authoring paths.',
			'Previews and validation stay tied to the selected destination and account.',
			'Reusable Social Sets can start a draft with the right group of accounts.'
		],
		limit:
			'Available formats, text rules, media rules, and settings still depend on the connected account and provider.',
		proof: {
			kind: 'image',
			src: '/assets/screenshots/main-dark.png',
			alt: 'OpenPost publication composer with destination-specific versions'
		},
		docsUrl: 'https://docs.openpost.social/usage/composing-posts',
		next: { label: 'See destination guides', href: '/platforms' }
	},
	{
		id: 'schedule',
		label: 'Plan and publish',
		title: 'See what is drafted, scheduled, running, published, or failed.',
		outcome:
			'Choose an exact time or a saved weekly slot, then follow the publication and every account result from the calendar and activity views.',
		scope: [
			'Durable background jobs keep scheduled work across server restarts.',
			'Each destination keeps its own status, result, and actionable error.',
			'Safe failures can be retried without re-publishing successful destinations.'
		],
		limit:
			'Managed plans set monthly scheduled-post limits. Provider outages, review rules, and account access can still block a destination.',
		proof: {
			kind: 'docs',
			label: 'Scheduling and publication status guide',
			href: 'https://docs.openpost.social/usage/scheduling'
		},
		docsUrl: 'https://docs.openpost.social/usage/scheduling',
		next: { label: 'Compare plan limits', href: '/pricing#limits' }
	},
	{
		id: 'media-editing',
		label: 'Media and editing',
		title: 'Keep reusable assets beside the tools that prepare them.',
		outcome:
			'Store media with alt text and metadata, create still designs in OpenPost Image Editor, or prepare clips in OpenPost Video Editor before returning the result to a draft.',
		scope: [
			'The media library keeps originals, previews, tags, collections, and editor exports together.',
			'OpenPost Image Editor supports multi-page social designs and mobile editing.',
			'OpenPost Video Editor supports local projects, timeline edits, captions, recovery, and export.'
		],
		limit:
			'Video editing needs a compatible browser, and every publishing destination still enforces its own size, duration, codec, and aspect-ratio rules.',
		proof: {
			kind: 'image',
			src: '/assets/screenshots/media-dark.png',
			alt: 'OpenPost media library with reusable assets'
		},
		docsUrl: 'https://docs.openpost.social/usage/studio',
		next: { label: 'Open the free editors', href: '/tools' }
	},
	{
		id: 'analytics-inbox',
		label: 'Analytics and conversations',
		title: 'Review available results and replies without calling providers on page load.',
		outcome:
			'Inspect stored account and post snapshots, then handle supported comments, replies, alerts, and opted-in inbox messages from the same workspace.',
		scope: [
			'Analytics separates views, impressions, reach, engagement, and follower counts when providers expose them.',
			'Comments, reply actions, and inbox collection appear only for accounts that support them.',
			'Permission and rate-limit errors keep the last successful counters visible.'
		],
		limit:
			'Coverage depends on provider permissions and the connected account. OpenPost does not provide social listening or cross-industry benchmarks.',
		proof: {
			kind: 'docs',
			label: 'Analytics and communications guides',
			href: 'https://docs.openpost.social/usage/analytics'
		},
		docsUrl: 'https://docs.openpost.social/usage/communications',
		next: { label: 'Check provider scope', href: '/platforms' }
	},
	{
		id: 'teams',
		label: 'Workspaces and teams',
		title: 'Separate brands and clients without separating the publishing system.',
		outcome:
			'Keep accounts, media, schedules, automation, and member access inside an explicit workspace boundary, with plan usage enforced for its organization.',
		scope: [
			'Workspace roles control who can view, edit, publish, manage members, or administer the workspace.',
			'Invitations and membership changes stay tied to the invited email and active workspace.',
			'Team includes three seats and Agency includes five. Each managed plan sets its own workspace limit.'
		],
		limit:
			'Team roles are included on Team and Agency managed plans. Included seats and workspace counts vary by plan.',
		proof: {
			kind: 'image',
			src: '/assets/screenshots/settings-dark.png',
			alt: 'OpenPost workspace and account settings'
		},
		docsUrl: 'https://docs.openpost.social/usage/workspaces',
		next: { label: 'Compare seats and workspaces', href: '/pricing#limits' }
	},
	{
		id: 'automation',
		label: 'Automation and self-hosting',
		title: 'Use the same workspace rules from HTTP, the CLI, or an AI tool.',
		outcome:
			'Create scoped tokens for scripts and MCP clients, inspect operations before executing them, or run the complete service on infrastructure you control.',
		scope: [
			'The typed HTTP API, CLI, and MCP server use the same authorization and workspace boundaries.',
			'Read-only and state-changing MCP operations stay separate.',
			'Self-hosting uses one Go service, SQLite by default, and configurable database, media, and provider settings.'
		],
		limit:
			'Automation still follows plan quotas, token scopes, workspace roles, provider readiness, and destination validation.',
		proof: {
			kind: 'docs',
			label: 'Agent-assisted publishing guide',
			href: 'https://docs.openpost.social/usage/agent-assisted-publishing'
		},
		docsUrl: developerDocsUrl,
		next: { label: 'Review self-hosting', href: selfHostingDocsUrl }
	}
] as const;

const platformImplementations = [
	{
		slug: 'x',
		name: 'X',
		short: 'x',
		tag: 'Posts, threads, media',
		requiresProviderApproval: false,
		implementationDetail: 'Publishing is implemented',
		description:
			'Draft, preview, and schedule X posts, links, media, and reply threads. OpenPost checks the limit for each connected account.',
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
			'Your X API plan and limits still apply'
		],
		limitations: [
			'OpenPost uses standard limits when X cannot verify a connected account subscription tier.',
			'Media publishing needs OAuth 1.0a access-token and secret pairs.',
			'Polls, quote posts, and other format settings remain subject to the account API tier.'
		],
		verification: 'Check OAuth, account limits, and each post type you plan to use.',
		docsUrl: `${siteUrl.replace('openpost.social', 'docs.openpost.social')}/providers/x/`
	},
	{
		slug: 'mastodon',
		name: 'Mastodon',
		short: 'mastodon',
		tag: 'Custom servers, posts, threads',
		requiresProviderApproval: false,
		implementationDetail: 'Publishing is implemented',
		description:
			'Connect a public Mastodon server, then schedule posts, media, links, and reply threads.',
		heroTitle: 'Publish to the Mastodon server your community already uses.',
		preview: {
			label: 'mastodon.social',
			headline: 'Public post with a content warning option',
			body: 'Each account keeps its visibility, language, sensitive media, and server rules.',
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
			'Reply threads and OpenPost scheduling',
			'Instance rules can override the defaults'
		],
		limitations: [
			'Character, attachment, and video limits can differ by server.',
			'Custom instances must be public HTTPS and allow app registration.',
			'One adapter registration is maintained per Mastodon instance.'
		],
		verification:
			'Check the server rules and publish one media test before you rely on a new server.',
		docsUrl: `${siteUrl.replace('openpost.social', 'docs.openpost.social')}/providers/mastodon/`
	},
	{
		slug: 'bluesky',
		name: 'Bluesky',
		short: 'bluesky',
		tag: 'Posts, threads, images, video',
		requiresProviderApproval: false,
		implementationDetail: 'Publishing is implemented',
		description:
			'Connect with a handle and app password, then schedule posts, links, media, and reply threads.',
		heroTitle: 'Keep a Bluesky post concise while preserving links and rich text.',
		preview: {
			label: '@openpost.social',
			headline: 'A short post with a rich link card',
			body: "Rich text, link cards, replies, labels, and media use Bluesky's AT Protocol format.",
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
			'Video must be MP4 and cannot be combined with images.',
			'App passwords can be revoked independently from the main account password.',
			'Bluesky may need time to process a video after upload.'
		],
		verification:
			'Text and image posts work in OpenPost. Test video with the account before a scheduled campaign.',
		docsUrl: `${siteUrl.replace('openpost.social', 'docs.openpost.social')}/providers/bluesky/`
	},
	{
		slug: 'linkedin',
		name: 'LinkedIn',
		short: 'linkedin',
		tag: 'Posts, documents, video',
		requiresProviderApproval: false,
		implementationDetail: 'Publishing is implemented',
		description:
			'Schedule LinkedIn posts, links, images, documents, videos, and comment-style thread continuations.',
		heroTitle: 'Turn a LinkedIn update into a document post or comment thread.',
		preview: {
			label: 'Professional update',
			headline: 'Quarterly field guide.pdf',
			body: 'The document title, post text, and follow-up comments each have their own limit.',
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
				media: 'Text or a link card'
			},
			{
				name: 'Comment thread',
				text: '1,250 characters per child',
				media: 'Text only'
			},
			{
				name: 'Image, document, or video',
				text: '3,000 characters',
				media: 'One image, PDF document, or video per account version'
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
		requiresProviderApproval: false,
		implementationDetail: 'Publishing is implemented',
		description:
			'Schedule text, image, video, carousel, and reply-thread posts for connected Threads accounts.',
		heroTitle: 'Arrange a Threads carousel and the replies that follow it.',
		preview: {
			label: 'Carousel',
			headline: 'Four media items, one Threads post',
			body: 'Public image and video URLs are checked before Meta fetches the carousel.',
			detail: '2-20 public media items',
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
				media: '2-20 public HTTPS images or videos'
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
		requiresProviderApproval: true,
		implementationDetail: 'Meta review and Page permissions still apply',
		description: 'OpenPost publishes text, photos, video, and Stories to selected Facebook Pages.',
		heroTitle: 'Prepare a Facebook Page post and its media together.',
		preview: {
			label: 'Selected Page',
			headline: 'Feed post or Story',
			body: 'OpenPost checks the selected Page, post type, and public media link separately.',
			detail: 'Pages only',
			chips: ['Feed', 'Multi-photo', 'Story']
		},
		accountRequirement:
			'A Facebook Page, eligible Meta user, configured Meta app, and the required reviewed permissions.',
		auth: 'Meta OAuth 2.0 with Page selection',
		setup: [
			'Set up the Facebook app, permissions, and callback address.',
			'Connect through Meta and choose the Page OpenPost should publish to.',
			'Complete Meta review and test a live Page before you schedule real posts.'
		],
		formats: [
			{
				name: 'Page post or link',
				text: '63,206 characters',
				media: 'Text or a link card'
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
			'App permissions and a live account test are required'
		],
		limitations: [
			'App review and Page permissions determine whether a Page and format work.',
			'Media must be available at a public HTTPS URL that Meta can fetch.',
			'This integration publishes to Pages, not personal Facebook profiles.'
		],
		verification:
			'Do not plan a launch around this integration until Page selection and every required format pass a live test.',
		docsUrl: `${siteUrl.replace('openpost.social', 'docs.openpost.social')}/providers/facebook/`
	},
	{
		slug: 'instagram',
		name: 'Instagram',
		short: 'instagram',
		tag: 'Feed, carousel, Story, Reel',
		requiresProviderApproval: true,
		implementationDetail: 'Business or Creator account and Meta review required',
		description: 'OpenPost publishes Instagram feed images, carousels, Stories, and Reels.',
		heroTitle: 'Choose the Instagram post type before you write the caption.',
		preview: {
			label: 'Media-first',
			headline: 'Feed, carousel, Story, or Reel',
			body: 'The format you choose sets the media count, caption, and checks.',
			detail: 'No text-only posts',
			chips: ['1:1 Feed', '9:16 Story', '9:16 Reel']
		},
		accountRequirement: 'An Instagram Business or Creator account connected to a Facebook Page.',
		auth: 'Meta OAuth 2.0 with account selection',
		setup: [
			'Connect an eligible Instagram Business or Creator account to a Facebook Page.',
			'Set up the Instagram app, permissions, callback address, and public media address.',
			'Choose the Instagram account during sign-in and test each format with it.'
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
			'OpenPost does not support text-only Instagram posts.',
			'Media must be public HTTPS and meet Meta format rules.',
			'App access and each planned format still need a live account test.'
		],
		verification:
			'Test each planned format—feed, carousel, Story, and Reel—because one successful format does not prove the others.',
		docsUrl: `${siteUrl.replace('openpost.social', 'docs.openpost.social')}/providers/instagram/`
	},
	{
		slug: 'tiktok',
		name: 'TikTok',
		short: 'tiktok',
		tag: 'Video and photo posts',
		requiresProviderApproval: true,
		implementationDetail: 'App review and live test required',
		description: 'OpenPost supports TikTok video and photo posts, each with its own caption limit.',
		heroTitle: 'Build a TikTok video or photo post with the correct caption limit.',
		preview: {
			label: 'Two post types',
			headline: 'Video or 1-35 photos',
			body: 'Video and photo posts keep different captions, media rules, and app-review checks.',
			detail: '2,200 video · 4,000 photo',
			chips: ['9:16 video', 'Photo post', 'App review']
		},
		accountRequirement:
			'A TikTok developer app with Content Posting API access and approved Direct Post permissions.',
		auth: 'OAuth 2.0',
		setup: [
			'Set up the TikTok app, callback address, permissions, and posting access.',
			'Verify the public media URL prefix or domain in the TikTok developer console.',
			'Complete app review and test both video and photo posts with the real account.'
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
			'App review and a live test are required'
		],
		limitations: [
			'TikTok blocks publishing until the app passes review and a live post test.',
			'Pull-from-URL media must use a verified public HTTPS prefix or domain.',
			'Video and photo posts use different caption and media rules.'
		],
		verification:
			'Do not use it for real posts until TikTok approves the app and your posting test works.',
		docsUrl: `${siteUrl.replace('openpost.social', 'docs.openpost.social')}/providers/tiktok/`
	},
	{
		slug: 'youtube',
		name: 'YouTube',
		short: 'youtube',
		tag: 'Shorts and long video',
		requiresProviderApproval: true,
		implementationDetail: 'App review required',
		description: 'OpenPost uploads Shorts and videos to a selected YouTube channel.',
		heroTitle: 'Schedule the YouTube video with its title, privacy, and channel details.',
		preview: {
			label: 'Video upload',
			headline: 'Release walkthrough · 08:42',
			body: 'Title, description, privacy, thumbnail, playlist, and processing state stay with the upload.',
			detail: 'One video per account version',
			chips: ['Private by default', 'Thumbnail', 'Playlist']
		},
		accountRequirement:
			'A Google Cloud OAuth app with YouTube Data API v3 and an eligible YouTube channel.',
		auth: 'Google OAuth 2.0 with channel selection',
		setup: [
			'Enable YouTube Data API v3 and configure the Google OAuth app and callback URI.',
			'Request the required profile, channel-read, and upload scopes.',
			'Choose a channel during connection and test a real video upload.'
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
			'Test the Google project with a live channel before you use it for real posts.',
			'Unaudited Google projects can force uploads to private visibility.',
			'Each account version accepts one video. OpenPost does not support text-only YouTube posts.'
		],
		verification:
			'Confirm upload, processing completion, thumbnail, playlist, and final privacy on the production channel.',
		docsUrl: `${siteUrl.replace('openpost.social', 'docs.openpost.social')}/providers/youtube/`
	},
	{
		slug: 'discord',
		name: 'Discord',
		short: 'discord',
		tag: 'Messages and files',
		requiresProviderApproval: false,
		implementationDetail: 'Built-in webhook connection',
		description:
			'Connect a Discord channel webhook, then schedule text and up to 10 file attachments.',
		heroTitle: 'Schedule a message and its files for a Discord channel.',
		preview: {
			label: 'Discord channel',
			headline: 'A scheduled channel update',
			body: 'Text, files, alt text, and reply links are sent through the channel webhook.',
			detail: '2,000 characters',
			chips: ['Webhook', 'Up to 10 files', 'Reply links']
		},
		accountRequirement:
			'An incoming webhook URL for a Discord channel where you can manage integrations.',
		auth: 'Incoming webhook URL',
		setup: [
			'Create an incoming webhook in the Discord channel settings.',
			'Copy the webhook URL and connect it from Social accounts in OpenPost.',
			'Publish a small test message and file, then keep the webhook URL private.'
		],
		formats: [
			{
				name: 'Message',
				text: '2,000 characters',
				media: 'Text only'
			},
			{
				name: 'Message with files',
				text: '2,000 characters',
				media: 'Up to 10 images or one video in the current post formats'
			}
		],
		limits: [
			`${PLATFORM_LIMITS.discord.charLimit.toLocaleString()} characters`,
			PLATFORM_LIMITS.discord.media,
			'OpenPost uses a safe 10 MiB limit for each file',
			'Scheduled messages do not notify users or roles by default'
		],
		limitations: [
			'A webhook can publish and delete its own messages, but it cannot read the channel inbox.',
			'The webhook URL acts like a password. Anyone who has it can post to the channel.',
			'The Discord server or account may enforce a different upload limit.'
		],
		verification:
			'Test the exact webhook and file type before you rely on it for scheduled messages.',
		docsUrl: `${siteUrl.replace('openpost.social', 'docs.openpost.social')}/providers/discord/`
	}
] as const;

const publicProviderClaims = publicClaimManifest.claims as PublicProviderClaim[];

export const platforms = platformImplementations.map((platform) => {
	const certifiedOutputProfiles = publicProviderClaims
		.filter((claim) => claim.subject.provider === platform.slug)
		.map((claim) => claim.subject.output_profile)
		.sort();
	return {
		...platform,
		implementationState: 'implemented' as const,
		certifiedOutputProfiles,
		managedCertificationState:
			certifiedOutputProfiles.length > 0
				? ('exact_claims_current' as const)
				: ('no_current_claim' as const),
		managedCertificationDetail:
			certifiedOutputProfiles.length > 0
				? `${certifiedOutputProfiles.length} exact provider-format certification claim${certifiedOutputProfiles.length === 1 ? ' is' : 's are'} current.`
				: 'No managed provider-format certification claim is current.'
	};
});

export const tools = [
	{
		slug: 'social-media-video-editor',
		name: 'Social media video editor',
		description:
			'Stream-copy combined or per-section cuts without transcoding, or use the complete desktop or touch editor for four social formats, captions, effects, and recording.'
	},
	{
		slug: 'social-media-image-editor',
		name: 'Social media image editor',
		description:
			'Create posts, carousel pages, Story slides, and thumbnails in a full browser editor with clean exports.'
	},
	{
		slug: 'multi-platform-character-counter',
		name: 'Multi-platform character counter',
		description:
			'Paste once and compare one draft against the limits and counting rules for ten social networks.'
	},
	{
		slug: 'post-preview-generator',
		name: 'Post preview generator',
		description:
			'Preview a post and its media on each selected social network before you schedule it.'
	},
	{
		slug: 'thread-splitter',
		name: 'Thread splitter',
		description: 'Split long copy into a thread that fits the platform and is easy to review.'
	},
	{
		slug: 'fediverse-handle-checker',
		name: 'Fediverse handle checker',
		description:
			'Check Mastodon-style and Bluesky-style handles before adding them to launch plans.'
	},
	{
		slug: 'linkedin-text-formatter',
		name: 'LinkedIn text formatter',
		description: 'Prepare readable LinkedIn copy with lightweight formatting and length awareness.'
	},
	{
		slug: 'best-time-to-post-calculator',
		name: 'Timezone posting planner',
		description: 'Turn your timezone and weekly plan into posting times you can reuse.'
	}
] as const;

const comparisonDrafts = [
	{
		slug: 'buffer',
		name: 'Buffer',
		category: 'Established hosted scheduler',
		bestFor:
			'Creators and teams that want a polished hosted scheduler with analytics and tools for comments and replies.',
		openPostAngle:
			'Buffer is a well-known hosted scheduler. OpenPost adds self-hosting, access that you can limit to one workspace, and clear status for each account.',
		verdict:
			'Choose Buffer for its long-running hosted service, analytics, and community tools. Choose OpenPost for source access, self-hosting, or simpler control over each post.',
		pricing:
			'Buffer offers Free, Essentials, and Team plans and prices paid use by channel. OpenPost prices managed plans by workspace, account, post, media, and seat limits.',
		chooseOpenPost: [
			'You want AI tools to use access that you can limit and remove instead of social account keys.',
			'You want AGPL source code and a supported self-host option.',
			'You want drafts, account versions, post status, and errors in one place.',
			'You prefer workspace-based managed plans to per-channel pricing.'
		],
		chooseThem: [
			'You need mature analytics, ideas, and community engagement today.',
			'You want a long-running hosted product with more support options.'
		],
		rows: [
			{
				area: 'Publishing',
				openpost: 'Shared drafts, account versions, reusable media, schedules, and clear results.',
				competitor: 'Planning, ideas, scheduling, and publishing in a mature hosted service.'
			},
			{
				area: 'Analytics and engagement',
				openpost:
					'Platform analytics, comments, replies, and inboxes for supported accounts. No social listening or large-company benchmarks.',
				competitor: 'Buffer includes analytics and tools for comments and replies.'
			},
			{
				area: 'Automation',
				openpost: 'HTTP API, CLI, MCP, and tokens that can be limited to one workspace.',
				competitor:
					'A public GraphQL API and MCP are available, including on the Free plan with plan limits.'
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
		reviewedAt: '2026-08-09'
	},
	{
		slug: 'hootsuite',
		name: 'Hootsuite',
		category: 'Full social management suite',
		bestFor:
			'Organizations that need publishing, inbox, analytics, listening, governance, and enterprise services together.',
		openPostAngle:
			'OpenPost focuses on creating, scheduling, and checking posts. Hootsuite also covers social listening, ads, reports, and large-company controls.',
		verdict:
			'Choose Hootsuite if a large team needs social listening, reports, and strict company controls. Choose OpenPost if you mainly need publishing, comments, inboxes, and automation.',
		pricing:
			'Hootsuite sells Standard, Professional, and Advanced plans per user, plus custom Enterprise plans. OpenPost publishes fixed monthly managed-app prices and explicit usage limits.',
		chooseOpenPost: [
			'You want to review account versions and results when an AI tool helps with a post.',
			'Your main work is writing, adapting, scheduling, and checking posts.',
			'You want open source, self-hosting, and a small service without Redis.',
			'You do not need social listening, ad tools, or large-company controls.'
		],
		chooseThem: [
			'You need a unified inbox, listening, competitive intelligence, and advanced reporting.',
			'You need enterprise permissions, SSO, compliance integrations, or services.'
		],
		rows: [
			{
				area: 'Publishing',
				openpost: 'A focused editor, account versions, posting times, media, and clear results.',
				competitor:
					'Unlimited scheduling on current plans, calendar, content library, bulk tools, and recommended times.'
			},
			{
				area: 'Beyond publishing',
				openpost:
					'Saved comments, replies, alerts, and inboxes for supported accounts. No social listening or ad tools.',
				competitor:
					'Inbox, analytics, listening, ads, benchmarking, and AI insights are core parts of the suite.'
			},
			{
				area: 'Automation',
				openpost: 'HTTP API, CLI, MCP, and tokens limited to one workspace.',
				competitor:
					'Hootsuite now offers MCP connectors for publishing, inbox, and social listening.'
			},
			{
				area: 'Hosting',
				openpost: 'Managed app or a small self-hosted service.',
				competitor: 'Hosted service with large-company plans, support, and compliance options.'
			}
		],
		sources: [
			{ label: 'Hootsuite plans', href: 'https://www.hootsuite.com/plans' },
			{
				label: 'Hootsuite MCP connectors',
				href: 'https://www.hootsuite.com/integrations/mcp'
			}
		],
		reviewedAt: '2026-08-09'
	},
	{
		slug: 'typefully',
		name: 'Typefully',
		category: 'Writing-first social workspace',
		bestFor:
			'Creators and teams that want polished writing, review, scheduling, and cross-platform publishing.',
		openPostAngle:
			'Typefully puts writing and review first. OpenPost adds self-hosting, account versions, and access that keeps social account keys away from AI tools.',
		verdict:
			'Choose Typefully for its polished writing and review tools. Choose OpenPost for self-hosting, public source code, or a small Go service.',
		pricing:
			'Typefully sells hosted creator and team plans. OpenPost sells managed plans and also provides the complete server under AGPL-3.0-only.',
		chooseOpenPost: [
			'You want AI tools to use OpenPost access instead of your social account keys.',
			'You require source access or want to run the publishing service yourself.',
			'You want to see platform support, post status, errors, and file storage in the source.',
			'You care more about posting control than a writing-first product.'
		],
		chooseThem: [
			'Writing, editing, review, and teamwork matter most to you.',
			'You want Typefully’s mature schedule, API v2, MCP, webhooks, and agent tools.'
		],
		rows: [
			{
				area: 'Platforms and account versions',
				openpost: 'Different text and settings for each account, with clear platform setup needs.',
				competitor:
					'Cross-platform writing for its current networks, including newer formats such as Substack Notes and X Articles.'
			},
			{
				area: 'Writing and review',
				openpost: 'Focused composer with prompts, previews, formats, and media reuse.',
				competitor:
					'Writing, thread editing, review, sharing, scheduling, and teamwork are core strengths.'
			},
			{
				area: 'Automation',
				openpost: 'HTTP API, CLI, MCP, and tokens that can be limited to one workspace.',
				competitor: 'Public API v2, MCP, webhooks, Zapier, and an agent skill.'
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
		reviewedAt: '2026-08-09'
	},
	{
		slug: 'postiz',
		name: 'Postiz',
		category: 'Broad open-source automation suite',
		bestFor:
			'Builders and teams that want many networks, AI generation, analytics, and deep automation.',
		openPostAngle:
			'Postiz covers more networks and AI tools. OpenPost is a smaller product for reviewing and publishing posts, built as one Go service with no required Redis server.',
		verdict:
			'Choose Postiz for more networks and built-in AI creation. Choose OpenPost for a simpler posting product, clear platform limits, and a smaller server.',
		pricing:
			'Both offer hosted and self-hosted options. Compare the current plan limits, prices, and server work for each one.',
		chooseOpenPost: [
			'You want to review what an AI tool made, check each account version, and see the result.',
			'You want a focused editor, reusable media, and clear posting errors.',
			'You prefer Go and SvelteKit, one service, and scheduled jobs without Redis.',
			'You want setup and live-test needs listed for each network.'
		],
		chooseThem: [
			'You need 30-plus integrations or channels beyond OpenPost’s current catalog.',
			'You want built-in AI image/video generation, analytics, and agent distribution tooling.'
		],
		rows: [
			{
				area: 'Network breadth',
				openpost: 'Ten social networks, with setup and live-test needs listed for each one.',
				competitor: 'Postiz advertises 30-plus platforms and integrations.'
			},
			{
				area: 'Automation',
				openpost: 'HTTP API, CLI, MCP, and tokens limited to one workspace.',
				competitor: 'REST API, CLI, MCP, and agent tools are built in.'
			},
			{
				area: 'Product scope',
				openpost: 'Publishing, workspaces, media, schedules, analytics, comments, and inboxes.',
				competitor: 'Broader AI generation, analytics, and distribution suite.'
			},
			{
				area: 'Self-hosting',
				openpost: 'Single Go binary or container; SQLite by default; no Redis required.',
				competitor: 'Open-source self-hosting and a managed service with more required parts.'
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
		reviewedAt: '2026-08-09'
	},
	{
		slug: 'post-bridge',
		name: 'Post Bridge',
		category: 'Straightforward hosted cross-poster',
		bestFor:
			'Creators and small teams that want simple hosted cross-platform scheduling and account-specific content overrides.',
		openPostAngle:
			'Post Bridge is a simple hosted cross-poster. OpenPost adds self-hosting, account-by-account review, and clear posting status.',
		verdict:
			'Choose Post Bridge for simple hosted scheduling. Choose OpenPost for source access, self-hosting, reply threads, or clearer post results.',
		pricing:
			'Post Bridge requires a paid plan and lists API access as a $5 monthly add-on. OpenPost includes API, CLI, and MCP access on every managed plan.',
		chooseOpenPost: [
			'You want AI and script access that you can remove without sharing social account keys.',
			'You want public AGPL source code and a self-host option.',
			'You need X or Threads reply-thread scheduling.',
			'You want CLI and MCP paths in addition to HTTP API access.'
		],
		chooseThem: [
			'You want a hosted cross-poster with a wide current platform list and minimal setup.',
			'You are comfortable with its separate API add-on and do not need self-hosting.'
		],
		rows: [
			{
				area: 'Publishing',
				openpost: 'Shared content, account versions, formats, posting times, and reply threads.',
				competitor:
					'Cross-platform scheduling with platform- and account-specific content overrides.'
			},
			{
				area: 'Scheduling horizon',
				openpost: 'Schedule at any future time or use saved weekly posting times.',
				competitor: 'Official help documents scheduling up to two months ahead.'
			},
			{
				area: 'Automation',
				openpost: 'HTTP API, CLI, and MCP are included.',
				competitor:
					'Public HTTP API is available as a paid add-on; current docs show posting, media, accounts, results, and some analytics.'
			},
			{
				area: 'Threads and hosting',
				openpost: 'Reply threads on supported networks; managed or self-hosted.',
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
		reviewedAt: '2026-08-09'
	},
	{
		slug: 'mixpost',
		name: 'Mixpost',
		category: 'Self-host-first social suite',
		bestFor:
			'Laravel teams that want a larger self-hosted product, one-time paid editions, analytics, and unlimited team access.',
		openPostAngle:
			'Mixpost puts self-hosting first and offers a larger paid feature set. OpenPost is smaller and also offers a managed app, one Go binary, and no required Redis server.',
		verdict:
			'Choose Mixpost when Laravel, self-hosting, analytics, and its wider Pro feature set fit your team. Choose OpenPost when you want a managed app, a smaller server, and one open-source edition.',
		pricing:
			'Mixpost offers a free Lite edition and one-time Pro and Enterprise licences. OpenPost offers the full AGPL server at no software charge plus monthly managed-app plans.',
		chooseOpenPost: [
			'You want AI access, account review, and post results in one focused product.',
			'You want to start with the hosted app while keeping a self-host option.',
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
				openpost: 'Focused editor, account versions, media, schedules, and post results.',
				competitor:
					'Broader self-hosted suite with analytics, approval, AI features, and unlimited team members in paid editions.'
			},
			{
				area: 'Automation',
				openpost: 'HTTP API, CLI, MCP, and tokens limited to one workspace.',
				competitor:
					'Mixpost’s current pricing page lists API, MCP, and webhooks for its paid product.'
			},
			{
				area: 'Runtime',
				openpost: 'Go/SvelteKit, SQLite by default, one binary or container, no Redis required.',
				competitor: 'A Laravel and PHP server for teams that already use those tools.'
			}
		],
		sources: [
			{
				label: 'Mixpost pricing and editions',
				href: 'https://mixpost.app/pricing'
			},
			{ label: 'Mixpost source', href: 'https://github.com/inovector/mixpost' }
		],
		reviewedAt: '2026-08-09'
	}
] as const;

export const comparisons = comparisonDrafts.map(attachComparisonEvidence);

export const faqs = [
	{
		id: 'ai-credentials',
		category: 'privacy',
		question: 'Can an AI agent see my social account credentials?',
		answer:
			'No. The AI tool uses its own OpenPost token. Your social account keys stay encrypted inside OpenPost. Use mcp:read for read-only access. Use mcp:full only when the tool must create, change, schedule, or publish.',
		learnMore: { label: 'Review security controls', href: '/security' }
	},
	{
		id: 'free-trial',
		category: 'billing',
		question: 'How does the free trial work?',
		answer:
			'Every managed plan starts with 14 days free. A card is required. OpenPost shows the exact renewal price and date before you start, and you can cancel from billing settings before the first charge.',
		learnMore: { label: 'See plans and limits', href: '/pricing' }
	},
	{
		id: 'change-plans',
		category: 'billing',
		question: 'Can I change plans later?',
		answer:
			'Yes. Choose the limits you need now, then manage your subscription from OpenPost billing settings as your account count or team grows.',
		learnMore: { label: 'Read billing terms', href: '/terms' }
	},
	{
		id: 'analytics',
		category: 'providers',
		question: 'Does OpenPost include analytics?',
		answer:
			'Yes. OpenPost shows account growth and post results for 7, 30, or 90 days when the platform gives access. It also has comments, replies, and inboxes for supported accounts. It does not include social listening or large-company benchmarks.',
		learnMore: {
			label: 'Read the analytics guide',
			href: 'https://docs.openpost.social/usage/analytics'
		}
	},
	{
		id: 'video-publishing',
		category: 'providers',
		question: 'Does video publishing work everywhere?',
		answer:
			'No. Video support and limits differ by platform. Some platforms also require app review or a public media link.',
		learnMore: { label: 'Compare provider formats', href: '/platforms' }
	},
	{
		id: 'own-provider-keys',
		category: 'self-hosting',
		question: 'Can I use my own social app keys?',
		answer:
			'Yes. A self-hosted operator can configure provider applications through deployment settings or the encrypted instance-admin fallback. The exact credentials and approval requirements depend on the provider.',
		learnMore: {
			label: 'Configure provider applications',
			href: 'https://docs.openpost.social/configuration/provider-applications'
		}
	},
	{
		id: 'failed-post',
		category: 'setup',
		question: 'What happens if a post fails?',
		answer:
			'OpenPost keeps the error for each failed account. You can review it and retry only the accounts that can be retried.',
		learnMore: {
			label: 'Read the scheduling guide',
			href: 'https://docs.openpost.social/usage/scheduling'
		}
	}
] as const;

export const faqCategories = [
	{
		id: 'setup',
		label: 'Setup and publishing',
		description: 'What happens while you connect accounts, schedule work, and recover a failure.'
	},
	{
		id: 'providers',
		label: 'Providers and results',
		description: 'Where account permissions, formats, analytics, and media rules still differ.'
	},
	{
		id: 'billing',
		label: 'Plans and billing',
		description: 'What the trial includes, when payment starts, and how plan changes work.'
	},
	{
		id: 'privacy',
		label: 'Privacy and access',
		description: 'How tokens and connected-account credentials stay separate.'
	},
	{
		id: 'self-hosting',
		label: 'Self-hosting',
		description: 'How operators can use their own deployment and provider applications.'
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

export type MarketingPlatform = (typeof platforms)[number];
