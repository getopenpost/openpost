export type ChannelStory = {
	title: string;
	intro: string;
	angle: string;
	example: string;
	preview?: { image: string; alt: string; title?: string };
	visual: 'main' | 'image-editor' | 'video-editor' | 'calendar';
	sections: readonly { title: string; text: string }[];
	ideas: readonly string[];
	question: string;
	answer: string;
};

const studioPhoto = {
	image: '/assets/marketing/studio-cup.webp',
	alt: 'Illustrative green ceramic cup and saucer on a pottery studio workbench'
};

const channelStories = {
	facebook: {
		preview: studioPhoto,
		title: 'Keep your Facebook Page worth following.',
		intro:
			'New products, weekend offers, a look behind the scenes. Prepare your Page posts in one sitting and make room for the rest of your business.',
		angle: 'Give people a reason to come back.',
		example:
			'The new collection is here. Meet the makers, see the details, and find your favourite. Available in the shop from Friday.',
		visual: 'image-editor',
		sections: [
			{
				title: 'Turn everyday updates into something to share.',
				text: 'A new arrival, a customer question, a change in opening hours. Write the update, add your photos, and preview the post before putting it on the calendar.'
			},
			{
				title: 'Make the image without leaving your post.',
				text: 'Crop product photos, add a price or headline, and save a reusable design in the Image Editor. Keep your logo and photos together for the next promotion.'
			},
			{
				title: 'Plan the week around your business.',
				text: 'Prepare a launch announcement and its follow-up together. Choose a time for each post, then see Facebook alongside your other channels in one calendar.'
			}
		],
		ideas: [
			'A new product with a close-up photo',
			'This week’s opening hours or special offer',
			'An answer to a question customers keep asking'
		],
		question: 'Can I use my personal Facebook profile?',
		answer:
			'OpenPost’s Facebook integration is for Pages. Personal profiles and Groups are not supported. You need permission to manage the Page you want to use.'
	},
	linkedin: {
		title: 'Let your work do the talking on LinkedIn.',
		intro:
			'Turn a product launch, a lesson learned, or a useful idea into your next post. Write it while it’s fresh, then plan when to share it.',
		angle: 'Your next post is probably in today’s work.',
		example:
			'We changed one thing in our onboarding this week: the first screen now asks what you want to achieve. Here’s what we removed, and why.',
		visual: 'main',
		sections: [
			{
				title: 'Start with something you actually know.',
				text: 'Capture a customer conversation, a decision, or the story behind a release. Use AI writing to explore an opening or tighten a draft, then make the final words your own.'
			},
			{
				title: 'Give your idea a little more room.',
				text: 'Pair a post with product photos, a short demo, or a PDF document. A step-by-step explanation can become a document people can read one page at a time.'
			},
			{
				title: 'Keep your profile and company Page distinct.',
				text: 'Write personally on your profile and focus on the product on your company Page. Change the copy for each account while keeping the original idea together.'
			}
		],
		ideas: [
			'A decision you made and the trade-off behind it',
			'A short demo of something you just shipped',
			'A practical lesson your customers can use'
		],
		question: 'Can I post to my profile and a company Page?',
		answer:
			'OpenPost includes personal-profile and company-Page posting. Company Pages need a connected member with the right Page permissions. Available posting options depend on that account.'
	},
	tiktok: {
		preview: studioPhoto,
		title: 'From footage to your next TikTok.',
		intro:
			'Make a demo, show your process, or answer a customer on camera. Cut the footage and prepare your TikTok caption in the same place.',
		angle: 'Show the thing. Skip the long introduction.',
		example: 'From first shaping to final glaze. Here’s how this cup came together.',
		visual: 'video-editor',
		sections: [
			{
				title: 'Turn the footage you have into a finished clip.',
				text: 'Trim the slow start, cut a mistake, add captions, and frame the video for a vertical screen. The desktop Video Editor keeps the footage and edits in one project.'
			},
			{
				title: 'Write a caption that adds something.',
				text: 'Give the video context, name the product, or invite a specific question. Save your draft next to the clip so you can finish a batch without finding the files again.'
			},
			{
				title: 'Make the clip work on your other channels.',
				text: 'Reuse the exported video for Reels or Shorts and adjust the title and caption for each. Check the preview and available posting options before scheduling.'
			}
		],
		ideas: [
			'A product demonstration with the result first',
			'A behind-the-scenes clip from your workday',
			'A quick answer to one customer question'
		],
		question: 'Can I choose who sees my TikTok video?',
		answer:
			'TikTok supplies the available privacy choices for your connected account. Review them before publishing. Some accounts or posting connections may restrict a video to private visibility.'
	},
	instagram: {
		preview: studioPhoto,
		title: 'Make your next Instagram post right here.',
		intro:
			'Product photos, carousels, Stories, and Reels. Bring the idea, make the media, and plan your next post without juggling separate tools.',
		angle: 'One shoot. A week of ideas.',
		example: 'A closer look at our new forest-green glaze. Made slowly, for everyday coffee.',
		visual: 'image-editor',
		sections: [
			{
				title: 'Give your photos a consistent look.',
				text: 'Crop, adjust colors, add text, and reuse your brand assets in the Image Editor. Build a multi-page design when the story needs more than one image.'
			},
			{
				title: 'Turn a demo into a Reel.',
				text: 'Trim your recording, add captions, and export a vertical video in the desktop Video Editor. Keep the original project so the next edit starts with your work already there.'
			},
			{
				title: 'See the posts you have planned.',
				text: 'Put product launches, useful tips, and behind-the-scenes updates on one calendar. Change the caption for Instagram while preparing the same idea for other channels.'
			}
		],
		ideas: [
			'A carousel explaining how to use your product',
			'A Reel showing the finished result',
			'A Story about what you are working on today'
		],
		question: 'Which Instagram accounts can I use?',
		answer:
			'OpenPost’s Instagram connection requires a professional account. Personal accounts are not supported. Reels, Stories, and feed posts have different requirements, so check the options shown for your account.'
	},
	x: {
		title: 'Keep the ideas coming on X.',
		intro:
			'Share a quick update or tell the longer story in a thread. Draft, preview, and plan it while you have something to say.',
		angle: 'A good thread starts with a real idea.',
		example:
			'We launched today. Three things we learned while building it, and one thing we would do differently next time.',
		visual: 'main',
		sections: [
			{
				title: 'Write the story before splitting it up.',
				text: 'Use the thread composer to keep the parts in order. Read each post on its own and check that the whole thread still makes sense before scheduling it.'
			},
			{
				title: 'Make every character useful.',
				text: 'Check the count as you write, including links. OpenPost uses the posting limit available to your connected account, so a short update and a longer post get the right checks.'
			},
			{
				title: 'Keep launch day from becoming a copy-and-paste job.',
				text: 'Prepare your announcement, a demo, and follow-up posts together. Adapt the same idea for LinkedIn or Bluesky without starting again.'
			}
		],
		ideas: [
			'A short launch announcement with a working link',
			'A thread explaining a useful process',
			'A screenshot of a small improvement'
		],
		question: 'Can I write longer posts with an X subscription?',
		answer:
			'OpenPost checks the subscription and posting limits available to your connected X account. When the account’s longer-post access cannot be confirmed, it uses the standard limit.'
	},
	bluesky: {
		title: 'Keep up with your people on Bluesky.',
		intro:
			'Share what you’re building, join a conversation, and give a longer idea its own thread. Keep the drafts together and post when you’re ready.',
		angle: 'Something useful to add to the conversation.',
		example:
			'A small improvement we’re happy with: you can now pick up a saved draft exactly where you left it. Here’s a look.',
		visual: 'main',
		sections: [
			{
				title: 'Write a post people can respond to.',
				text: 'Start with a clear observation, update, or question. Add a link card or images when they help explain it, and check the preview before sharing.'
			},
			{
				title: 'Give longer ideas a thread.',
				text: 'Keep each part short and readable. OpenPost keeps the order of your thread together while you edit, so you can follow the whole thought before it goes out.'
			},
			{
				title: 'Bring Bluesky into your weekly plan.',
				text: 'Prepare a Bluesky version alongside the rest of your social posts. Keep its conversational voice while sharing the same underlying news.'
			}
		],
		ideas: [
			'A small update with a screenshot',
			'A useful link and why it matters',
			'A question for people doing similar work'
		],
		question: 'Do I use my usual Bluesky password?',
		answer:
			'Use an app password created in Bluesky’s settings. It gives OpenPost a separate connection you can remove without changing your main password.'
	},
	mastodon: {
		title: 'Share with your Mastodon community.',
		intro:
			'Keep your own server, your own voice, and your own posting rhythm. Prepare updates and threads alongside your other social content.',
		angle: 'Made for the community you chose.',
		example:
			'A look at this week’s work: a new design, a few lessons from testing it, and the files for anyone who wants to try it.',
		visual: 'main',
		sections: [
			{
				title: 'Stay on the server you call home.',
				text: 'Connect your public Mastodon server and work with the post length it allows. Your account stays where your community already is.'
			},
			{
				title: 'Keep the context with the post.',
				text: 'Write image descriptions, add a content warning when it helps, and review visibility before publishing. Prepare a thread when a single post is not enough.'
			},
			{
				title: 'Make a different version for each community.',
				text: 'A Mastodon update does not have to read like a LinkedIn announcement. Change the opening and media while keeping both connected to the same idea.'
			}
		],
		ideas: [
			'A useful resource with a clear description',
			'A progress update from your project',
			'An explanation of a decision and what you learned'
		],
		question: 'Can I connect my own Mastodon server?',
		answer:
			'You can connect an account on a public Mastodon server. Servers may set different post lengths and media limits. OpenPost checks the limits reported by the connected server.'
	},
	pixelfed: {
		title: 'Put your photos where your Fediverse audience is.',
		intro:
			'Your work deserves better than a screenshot in a microblog post. Publish photos and albums to Pixelfed with captions and alt text, straight from the same workspace.',
		angle: 'Photo-first, not an afterthought.',
		example:
			'Golden hour over the workshop. Full album with alt text on every photo, scheduled for tomorrow morning.',
		visual: 'image-editor',
		sections: [
			{
				title: 'Design the album, then publish it.',
				text: 'Arrange up to four photos, write one caption, and add alt text to each image. Review the order before it goes out.'
			},
			{
				title: 'Keep accessibility with the post.',
				text: 'Alt text travels with every image. Content warnings and sensitive-media flags are preserved, never dropped to make cross-posting succeed.'
			},
			{
				title: 'Respect the instance you publish to.',
				text: 'Photo and album limits can differ by server. OpenPost checks the connected instance and validates before scheduling.'
			}
		],
		ideas: [
			'A product shoot with per-photo alt text',
			'A behind-the-scenes album from the week',
			'A launch photo with a content warning where it helps'
		],
		question: 'Can I connect my own Pixelfed instance?',
		answer:
			'You can connect an account on a public Pixelfed instance. Photo and album limits can differ by server. OpenPost checks the limits reported by the connected instance.'
	},
	peertube: {
		title: 'Publish videos to your own channel.',
		intro:
			'A demo, a tutorial, a launch walkthrough. Upload it to your PeerTube channel with a title, description, and captions, and know when it finishes processing.',
		angle: 'The channel is the destination.',
		example:
			'Watch the two-minute tour of the new dashboard, with captions and chapters in the description.',
		visual: 'video-editor',
		sections: [
			{
				title: 'Pick the channel, not just the account.',
				text: 'One account can own several channels with different subscribers. Choose the channel when you connect, and every upload lands in the right place.'
			},
			{
				title: 'Upload once, with everything attached.',
				text: 'Title, description, privacy, language, tags, thumbnail, and captions go with the upload. Interrupted transfers resume instead of duplicating.'
			},
			{
				title: 'Trust the processing state.',
				text: 'Transcoding takes time. OpenPost reports the video as published only after the instance confirms it, and keeps checking while it processes.'
			}
		],
		ideas: [
			'A product demo with captions',
			'A tutorial published to your teaching channel',
			'A launch update with a thumbnail'
		],
		question: 'Which channel will my video publish to?',
		answer:
			'The channel you connect is the destination. If your account owns several channels, pick one during setup. Each channel is a separate destination in OpenPost.'
	},
	lemmy: {
		title: 'Join the Lemmy discussion properly.',
		intro:
			'Communities reward posts written for them. Pick the community, write a title and body for it, and follow the replies from the same workspace.',
		angle: 'A community is a destination, not a hashtag.',
		example:
			'Why we self-host our analytics: the costs, the surprises, and what we would do differently. Discussion open.',
		visual: 'main',
		sections: [
			{
				title: 'Write for one community at a time.',
				text: 'Each rendition targets one community with its own title, body, and validation. Adapting a post for another community means reviewing it again.'
			},
			{
				title: 'Keep the rules next to the editor.',
				text: 'The community description and rules stay alongside your draft, and OpenPost rechecks posting restrictions before submission.'
			},
			{
				title: 'Stay for the conversation.',
				text: 'Read comments and reply from the inbox instead of dropping a link and leaving. Moderation changes are reported, never silently reposted.'
			}
		],
		ideas: [
			'A lesson learned, written for one community',
			'A question with enough context to answer',
			'A launch announcement adapted per community'
		],
		question: 'Do I need an account on every community server?',
		answer:
			'No. You connect your home instance, and it resolves communities hosted elsewhere. Two communities with the same name on different servers stay separate destinations.'
	},
	piefed: {
		title: 'Publish to PieFed communities natively.',
		intro:
			'PieFed shares the community-posting experience with Lemmy through its own native API. Pick the community, write for it, and follow the replies.',
		angle: 'Same care, native API.',
		example:
			'What we changed in onboarding this week, written for this community with full context.',
		visual: 'main',
		sections: [
			{
				title: 'One community, one rendition.',
				text: 'Each post targets one community with its own title, body, and validation. Nothing is shared implicitly across communities.'
			},
			{
				title: 'See the rules while you write.',
				text: 'Community descriptions and posting warnings stay next to the editor, and restrictions are rechecked before submission.'
			},
			{
				title: 'Follow the replies.',
				text: 'Read comments, reply, and manage the conversation from the inbox. Removed posts are reported, never reposted automatically.'
			}
		],
		ideas: [
			'A discussion post with full context',
			'A link with a title written for the community',
			'An update adapted from your launch notes'
		],
		question: 'How is PieFed different from Lemmy in OpenPost?',
		answer:
			'The authoring experience is shared, but PieFed connects through its own native API with its own adapter, validation, and community resolution.'
	},
	threads: {
		title: 'Make room for a conversation on Threads.',
		intro:
			'A thought, a question, a story from the day. Save the idea now and prepare your next Threads post without breaking your focus.',
		angle: 'Start with the part you’d tell a friend.',
		example:
			'What’s one part of running your business that turned out to be completely different from what you expected?',
		visual: 'calendar',
		sections: [
			{
				title: 'Catch the thought while it’s there.',
				text: 'Save a rough draft when something comes to mind. Come back to tighten the opening, add a photo, or turn it into a short conversation starter.'
			},
			{
				title: 'Give the update its own voice.',
				text: 'Reuse the idea from your launch post, then make it more personal for Threads. Review the text and media together before choosing when to publish.'
			},
			{
				title: 'Leave room between announcements.',
				text: 'Use the calendar to mix updates, useful advice, and questions. See what you have prepared across your accounts without opening every app.'
			}
		],
		ideas: [
			'An honest lesson from the workday',
			'A question with a specific starting point',
			'The story behind a product detail'
		],
		question: 'Can I post images and video on Threads?',
		answer:
			'OpenPost includes text, image, carousel, and video formats for Threads. Available formats and file limits depend on the connected account and the posting options shown in OpenPost.'
	},
	youtube: {
		preview: { ...studioPhoto, title: 'From clay to coffee cup' },
		title: 'Take your next video from edit to upload.',
		intro:
			'Record a walkthrough, finish a product demo, or cut a Short. Keep the video, thumbnail, and description together as you prepare to share it.',
		angle: 'Make the answer easier to watch.',
		example:
			'A look inside the studio, from the first shaping to the finished glaze. See how we make a cup for everyday coffee.',
		visual: 'video-editor',
		sections: [
			{
				title: 'Record the thing you want to explain.',
				text: 'Capture your screen, camera, and microphone. Use the desktop Video Editor to remove pauses, add captions, and make the important part easy to see.'
			},
			{
				title: 'Finish the details that go with the video.',
				text: 'Create a thumbnail in the Image Editor and write a title that tells viewers what they will learn. Keep the description, links, and video with the same draft.'
			},
			{
				title: 'Make a shorter version for the feed.',
				text: 'Return to your project to create a vertical cut for Shorts, Reels, or TikTok. Adjust the framing and caption for each channel before you share it.'
			}
		],
		ideas: [
			'A walkthrough that answers a common support question',
			'A product demo with a clear before and after',
			'A Short showing one useful tip'
		],
		question: 'Will my video be public straight away?',
		answer:
			'YouTube processes an upload before it is ready to watch. Review the final visibility and processing status. Some posting connections can restrict uploads to private until YouTube approves them.'
	},
	discord: {
		title: 'Keep your Discord community in the loop.',
		intro:
			'Prepare release notes, event reminders, and useful updates for your channel. Keep them on the same calendar as your public announcements.',
		angle: 'Your community should hear it from you.',
		example:
			'This week’s update is ready. Here’s what changed, where to try it, and where to leave your feedback.',
		visual: 'calendar',
		sections: [
			{
				title: 'Give announcements a home.',
				text: 'Connect the Discord channel where members expect your updates. Prepare a clear message with screenshots or files so people have what they need in one place.'
			},
			{
				title: 'Prepare reminders while planning the event.',
				text: 'Write the announcement and follow-up together. Choose when each should appear instead of remembering to return to Discord at the right moment.'
			},
			{
				title: 'Keep public and community updates together.',
				text: 'Use a shorter announcement for social feeds and more detail for existing members. Tailor the copy for Discord while sharing the same news.'
			}
		],
		ideas: [
			'Release notes with a link to try the update',
			'An event reminder with the date and timezone',
			'A useful resource for new members'
		],
		question: 'Does OpenPost read my Discord conversations?',
		answer:
			'No. The Discord connection sends messages through a channel webhook. It does not read the channel inbox. You need permission to create that connection in your Discord server.'
	},
	telegram: {
		title: 'Bring your Telegram channel into the plan.',
		intro:
			'Share updates with your channel or group without leaving your workflow. Prepare the message here, then send it through your connected chat.',
		angle: 'Your channel, on the calendar.',
		example:
			'The new collection is here. See the details and find your favourite in the shop from Friday.',
		visual: 'calendar',
		sections: [
			{
				title: 'Connect the chat you run.',
				text: 'Add the OpenPost bot as an administrator of your channel or group, then post a one-time command inside that chat. Refresh your accounts to confirm the chat appears.'
			},
			{
				title: 'Write the message once.',
				text: 'Prepare text up to 4,096 characters, or add media with a caption up to 1,024 characters. Check the preview before scheduling.'
			},
			{
				title: 'Keep channel history in view.',
				text: 'OpenPost observes channel posts from installation onward and records reaction counts. Earlier messages are never backfilled.'
			}
		],
		ideas: [
			'A product update with a photo of what changed',
			'An event reminder with the date and time',
			'A short note pointing members to something new'
		],
		question: 'Which chats can I connect?',
		answer:
			'Channels and groups where the bot is an administrator with permission to post. Post the command inside that chat. A command sent anywhere else does nothing.'
	}
} satisfies Record<string, ChannelStory>;

export function getChannelStory(slug: string): ChannelStory | undefined {
	return Object.entries(channelStories).find(([key]) => key === slug)?.[1];
}
