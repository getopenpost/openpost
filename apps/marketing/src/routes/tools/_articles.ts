import type { MarketingToolSlug } from '../_marketing';

type ToolArticle = {
	title: string;
	description: string;
	privacy: string;
	steps: readonly string[];
	sections: readonly { title: string; paragraphs: readonly string[] }[];
	questions: readonly { question: string; answer: string }[];
};

export const toolArticles = {
	'multi-platform-character-counter': {
		title: 'Social media character counter',
		description: 'Paste your post. See how it fits on each channel.',
		privacy: 'Your text stays in your browser.',
		steps: [
			'Paste or type your draft in the box.',
			'Check the count for the channels you use.',
			'Shorten any version that is over the limit.'
		],
		sections: [
			{
				title: 'One draft, different character limits',
				paragraphs: [
					'The same post can fit on LinkedIn and be too long for X or Bluesky. This free character counter shows the difference before you copy your draft into each app. You can check the overall character count, word count, and number of lines, then compare the count for individual networks.',
					'Use it when preparing a product announcement, a caption, or a quick update for several channels. Write the idea in full first. Then make a shorter version for the places where the limit is tighter, keeping the point and the next step clear.'
				]
			},
			{
				title: 'Why the numbers can look different',
				paragraphs: [
					'A visible character is not always counted the same way by every social network. Emoji can contain several parts, and X applies its own rules to links and some characters. The counter includes those differences instead of treating every channel as an identical text box.',
					'Spaces, punctuation, and line breaks can use space too. Check the finished draft with its actual link and hashtags. A draft that fits before you add the shop link may need one more edit afterwards. Network rules can change, so review the final post in the app you use to publish.'
				]
			},
			{
				title: 'Shorten the copy without losing the idea',
				paragraphs: [
					'Move the main point to the first sentence. Remove repeated context, replace a long introduction with the actual update, and give the reader one clear next step. If the post still needs more room, turn it into a thread or pair it with an image that explains the details.',
					'A character limit is a ceiling, not a target. Leave a useful short post short. Before scheduling, read it on a phone-sized preview and make sure the first lines still explain why someone should keep reading.'
				]
			}
		],
		questions: [
			{
				question: 'Does this count words and emoji?',
				answer:
					'Yes. It shows words, lines, and visible characters, including composed emoji. The network counts account for differences such as link length on X.'
			},
			{
				question: 'Will a post that fits definitely publish?',
				answer:
					'The counter checks text length. Your account access, media, and the network’s other posting rules still matter.'
			},
			{
				question: 'Do I need an OpenPost account?',
				answer: 'No. The counter is free and runs in this page. Nothing you type is uploaded.'
			}
		]
	},
	'thread-splitter': {
		title: 'Thread splitter',
		description: 'Turn a long draft into a thread. Copy it when it reads right.',
		privacy: 'Your draft stays in your browser.',
		steps: [
			'Paste the full story.',
			'Choose your channel and whether to number the posts.',
			'Read the parts in order, then copy the thread.'
		],
		sections: [
			{
				title: 'Give a longer idea room to breathe',
				paragraphs: [
					'A launch story, a useful lesson, or a step-by-step explanation can need more than one post. The thread splitter divides a draft into smaller parts for X, Bluesky, Mastodon, Threads, or LinkedIn. It looks for paragraph, sentence, and word breaks so each part remains readable.',
					'Start with the complete thought. You do not need to count characters while you are writing the first draft. Once the story is there, choose a channel and review how the parts fit together.'
				]
			},
			{
				title: 'Make the first post useful on its own',
				paragraphs: [
					'People may see the first part without opening the rest. Say what the thread explains and give them something specific to care about. A useful result, a clear question, or a lesson from experience gives the reader a reason to continue.',
					'Keep each following part focused on one point. If the split lands in an awkward place, change the original paragraph or add a line break. The tool prepares a draft; you decide whether the pacing feels natural.'
				]
			},
			{
				title: 'Review the thread before copying it',
				paragraphs: [
					'Read every part in order and check the ending. Make sure a pronoun still has a clear subject, a link stays with its explanation, and the final post tells the reader what to do next. Numbering is optional and uses some of the space in each part.',
					'You can copy one part or the full thread. The destination choices help you split text, but they do not promise that every channel supports the same automatic thread publishing. Check the publishing options available for your connected account.'
				]
			}
		],
		questions: [
			{
				question: 'Does it rewrite my words?',
				answer:
					'No. It splits your draft at readable breaks. You can edit the source text to change how the thread is divided.'
			},
			{
				question: 'Does numbering count towards the limit?',
				answer: 'Yes. The splitter leaves room for the part numbers when numbering is on.'
			},
			{
				question: 'Can I schedule the result?',
				answer:
					'Copy the parts into OpenPost’s thread composer, review the supported channels, and choose when to share it.'
			}
		]
	},
	'linkedin-text-formatter': {
		title: 'LinkedIn text formatter',
		description: 'Tidy your LinkedIn post before you share it.',
		privacy: 'Your text stays in your browser.',
		steps: [
			'Paste your LinkedIn draft.',
			'Choose a paragraph length and tidy the bullet points.',
			'Check the preview and copy the result.'
		],
		sections: [
			{
				title: 'Make a LinkedIn post easier to scan',
				paragraphs: [
					'A useful idea can be hard to read when it arrives as one long block of text. This free formatter helps you prepare the spacing and lists before pasting your post into LinkedIn. Use short paragraphs to separate the problem, the example, and what the reader can take away.',
					'Start with the words. Explain the update or lesson in a way someone outside your company can understand. Formatting should help readers follow that explanation, without asking them to work through a decorative headline first.'
				]
			},
			{
				title: 'Keep the words readable everywhere',
				paragraphs: [
					'This formatter keeps your post in plain text. It separates paragraphs and makes bullet lists consistent, so the result can be read, searched, and copied without special fonts or decorative characters.',
					'Give each paragraph one job. Use a list for steps or examples that belong together, and leave a blank line between ideas. Clear structure helps a reader follow the post even when the feed is crowded.'
				]
			},
			{
				title: 'Check the opening on a small screen',
				paragraphs: [
					'Put the important idea near the beginning. A short opening and clear paragraph breaks help a reader decide whether to expand the rest of a post. Avoid depending on an exact number of visible lines, because the feed changes with screen size and LinkedIn’s layout.',
					'After formatting, read the result once more and check its length. Make sure the headline still sounds like you and the call to action is specific. Copy it into your publishing tool and preview the final version with its image or document attached.'
				]
			}
		],
		questions: [
			{
				question: 'Does this make text bold or italic?',
				answer:
					'No. It improves paragraph spacing and bullet lists while keeping your words in ordinary, readable text.'
			},
			{
				question: 'Does it rewrite my post?',
				answer:
					'No. It keeps your wording and changes the spacing and list structure. Review the result before you copy it.'
			},
			{
				question: 'Is the formatter free?',
				answer: 'Yes. You can format and copy your draft without an account.'
			}
		]
	},
	'utm-link-builder': {
		title: 'UTM link builder',
		description: 'Tag a link. Know which campaign brought people to your site.',
		privacy: 'Links are built in your browser.',
		steps: [
			'Paste the page link you want to share.',
			'Name the source, medium, and campaign.',
			'Copy the tagged link and use it in your post.'
		],
		sections: [
			{
				title: 'See where a visit came from',
				paragraphs: [
					'A campaign link is an ordinary link with a few extra labels. Those labels tell a compatible website analytics tool where a visitor came from. Use them to distinguish a LinkedIn post from an Instagram bio link or an email announcing the same product.',
					'The destination page stays the same. The added tags give your analytics more context when someone follows the link. This builder creates the URL; your website analytics tool records and reports visits.'
				]
			},
			{
				title: 'What to put in each field',
				paragraphs: [
					'Source names the place you shared the link, such as linkedin, instagram, or newsletter. Medium describes the kind of traffic, such as social or email. Campaign groups the links for one promotion, such as autumn-launch. Use short, consistent names that you will recognise later.',
					'The optional content field can separate two versions of a post or two links in one email. The optional term field is useful when your campaign needs a keyword label. Leave optional fields empty when they do not answer a real reporting question.'
				]
			},
			{
				title: 'Keep campaign names consistent',
				paragraphs: [
					'Choose one naming style and reuse it. Lowercase words with hyphens are easy to read. If you call the same campaign autumn-launch in one post and Autumn Launch in another, your analytics tool may separate them into different rows.',
					'Use campaign tags for links you share outside your website. Do not put email addresses, customer names, or other private information in them: the finished URL is visible to anyone who receives it. Test that the page opens correctly before adding the link to scheduled posts.'
				]
			}
		],
		questions: [
			{
				question: 'Does this shorten my link?',
				answer:
					'No. It adds campaign tags to the original URL. The finished link still opens the same page.'
			},
			{
				question: 'Does OpenPost track clicks in this tool?',
				answer:
					'No. This tool builds a link locally. Use a compatible analytics service on your website to read the campaign tags.'
			},
			{
				question: 'Can I tag an existing campaign link?',
				answer:
					'Yes. Required tags are updated with the values you enter. Review the finished link before copying it, especially if the original already contains optional tags.'
			}
		]
	},
	'best-time-to-post-calculator': {
		title: 'Timezone posting planner',
		description: 'Plan posts around your audience’s day, wherever you are.',
		privacy: 'Your plan stays in your browser.',
		steps: [
			'Choose your audience’s timezone and available hours.',
			'Select the days and number of posts.',
			'Copy the plan or download the calendar file.'
		],
		sections: [
			{
				title: 'Turn an audience timezone into a posting plan',
				paragraphs: [
					'Your working day and your audience’s day may start hours apart. This free planner helps you choose a repeatable set of posting times using the days, hours, and timezone you select. It is useful when you want to prepare content for a different country or keep a simple weekly routine.',
					'Choose a window that makes sense for the people you want to reach. Then set a number of posts you can realistically prepare. A plan you can keep is more useful than filling every possible slot.'
				]
			},
			{
				title: 'There is no universal best time to post',
				paragraphs: [
					'This tool does not read your accounts or predict engagement. It turns your choices into a schedule. It cannot know when your particular followers are active, and it does not use industry averages to promise a better result.',
					'Start with a reasonable window, publish useful content, and review the results your network provides. Compare similar posts over time before changing the schedule. A product demo and a short personal update may perform differently for reasons that have little to do with the hour.'
				]
			},
			{
				title: 'Keep dates and timezones clear',
				paragraphs: [
					'Review the timezone shown in the plan and in the calendar where you import it. Daylight saving changes can shift the difference between two countries, so a time conversion that worked last month may look different later in the year.',
					'Download the calendar file when you want the plan alongside your other commitments, or copy the times into your content calendar. The file is a planning aid. It does not schedule or publish a social post on its own.'
				]
			}
		],
		questions: [
			{
				question: 'Are these recommended times based on my followers?',
				answer:
					'No. The planner uses the days, hours, and timezone you enter. It does not connect to a social account or inspect your audience.'
			},
			{
				question: 'Will importing the calendar publish my posts?',
				answer: 'No. It adds planning entries. Schedule the actual content in your publishing tool.'
			},
			{
				question: 'Can I use this for another country?',
				answer:
					'Yes. Select the audience’s timezone and review the resulting dates and times before using them.'
			}
		]
	},
	'fediverse-handle-checker': {
		title: 'Social handle checker',
		description: 'Check a Bluesky or Mastodon handle before you share it.',
		privacy: 'Format checks stay local. Live checks contact the selected server.',
		steps: [
			'Paste the handle you want to check.',
			'Choose Bluesky or Mastodon.',
			'Review its format, or run the optional live check.'
		],
		sections: [
			{
				title: 'Make sure people can find the right account',
				paragraphs: [
					'A small typo in a social handle can send customers to the wrong place. This checker helps you review a Bluesky handle or a Mastodon-style address before adding it to a launch post, a website, or your contact details.',
					'Bluesky handles often look like a domain name. Mastodon addresses include both a username and a server. Keep the full address when sharing an account, especially when the username alone is not enough to identify it.'
				]
			},
			{
				title: 'A format check and a live check answer different questions',
				paragraphs: [
					'The local check asks whether the text looks like the kind of handle you selected. It can help catch missing parts and obvious formatting mistakes without contacting another service.',
					'An optional live check asks the relevant public service about the address. That request leaves your browser, and the server may receive your IP address. A network error does not necessarily mean the handle is wrong: servers can be unavailable, private, or unable to accept browser requests.'
				]
			},
			{
				title: 'Check the destination before publishing it',
				paragraphs: [
					'After checking a handle, open the public profile and confirm that it is the account you meant to share. A correctly formed address does not prove ownership, identity, or that a name is available to register.',
					'Keep a copy of your correct business handles with your brand assets. Reuse them in profile descriptions, announcements, and customer-facing pages so the same account is easy to find everywhere.'
				]
			}
		],
		questions: [
			{
				question: 'Does this reserve a username?',
				answer:
					'No. It checks an address. It cannot register, reserve, or prove ownership of a handle.'
			},
			{
				question: 'Why can a valid handle fail the live check?',
				answer:
					'The server may be unavailable or block browser requests. Check the public profile directly before deciding the account does not exist.'
			},
			{
				question: 'Is the live check automatic?',
				answer:
					'No. Local formatting checks run in your browser. You choose whether to make a live request.'
			}
		]
	},
	'post-preview-generator': {
		title: 'Social post preview',
		description: 'See your post before you share it.',
		privacy: 'Text and local files stay in your browser. Linked media loads from its source.',
		steps: [
			'Choose a channel and write your post.',
			'Add an image, video, or other supported format.',
			'Check the preview and adjust the copy.'
		],
		sections: [
			{
				title: 'Check the whole post together',
				paragraphs: [
					'Words and media need to work together. A caption that reads well in a notes app can feel too long next to a product image, and a thumbnail can be hard to understand when it is small. The preview tool brings those pieces together before you schedule.',
					'Choose a social network, add your text, and try the available media or post formats. You can review supported posts, threads, Stories, videos, documents, polls, and link cards. The options change with the selected channel.'
				]
			},
			{
				title: 'Look at what a reader notices first',
				paragraphs: [
					'Check the opening sentence, the image, and the next step. Someone scrolling should be able to tell what you are sharing without needing the background you have in your head. A clear product photo or a short explanation often helps more than extra formatting.',
					'Read the preview at a narrow width too. Keep essential text away from the edges of images and make captions large enough to read. If a post needs a long explanation, consider a thread, document, or short video.'
				]
			},
			{
				title: 'Use the preview as a draft check',
				paragraphs: [
					'This is an approximation of a social post, not a live rendering from the network. Apps can change their layouts, crop media, shorten visible text, or display a link differently. The preview helps you catch obvious problems; it does not guarantee the final appearance or publishing eligibility.',
					'Local files stay in the browser. If you enter a public media URL, the browser contacts that address to display it. Review the finished post again in your publishing tool, with the actual account and final media selected.'
				]
			}
		],
		questions: [
			{
				question: 'Will it look exactly like this when published?',
				answer:
					'The preview is an approximation. Each network controls the final layout, cropping, and visible text.'
			},
			{
				question: 'Can I preview without an account?',
				answer:
					'Yes. Write the text and add local files here. You do not need to connect a social account.'
			},
			{
				question: 'Does the tool publish anything?',
				answer:
					'No. It only shows a preview. You decide what to copy, save, and publish afterwards.'
			}
		]
	},
	'social-media-image-editor': {
		title: 'Free social media image editor',
		description: 'Make a post, carousel, or thumbnail. Download it without a watermark.',
		privacy: 'Local designs stay on your device unless you save them to OpenPost.',
		steps: [
			'Open the editor and choose a size or template.',
			'Add your images, words, and brand colors.',
			'Download your design as PNG, JPEG, or WebP.'
		],
		sections: [
			{
				title: 'Make the image your post needs',
				paragraphs: [
					'Create a product announcement, a social carousel, a Story slide, or a video thumbnail in your browser. Start with an image, a template, or a blank page, then add the text and visual details that explain your idea.',
					'The editor keeps the design editable. Move a headline, change a photo, adjust colors, and reuse the page for the next announcement. You do not have to rebuild the whole image whenever the date, price, or product changes.'
				]
			},
			{
				title: 'Build a carousel one page at a time',
				paragraphs: [
					'Use multiple pages to explain a process, introduce a collection, or answer a question in steps. Keep the first page clear about what the reader will get, then give each following page one job.',
					'Reuse the same colors and type across the design. Check that the text is readable on a phone and that a product image still makes sense at a small size. Arrange the pages in the order you want before exporting.'
				]
			},
			{
				title: 'Download the right file for the job',
				paragraphs: [
					'PNG is useful for crisp text and transparency. JPEG works well for photographs. WebP can keep a web image compact. Choose the format and size that suit the place you plan to use the result, and check that the destination accepts it.',
					'The editor adds no watermark. Local designs and imported images stay on your device unless you choose to save them to OpenPost. Download a copy of important finished work, because clearing local browser storage can remove local projects.'
				]
			}
		],
		questions: [
			{
				question: 'Is there a watermark or account requirement?',
				answer: 'No. You can create and export images for free without an account or watermark.'
			},
			{
				question: 'Can I make a multi-page carousel?',
				answer: 'Yes. Add and arrange pages, then export the images in the order you need.'
			},
			{
				question: 'Does it work on my phone?',
				answer:
					'The Image Editor supports desktop and mobile browsers. Large designs work best on a device with enough memory.'
			}
		]
	},
	'social-media-video-editor': {
		title: 'Free social media video editor',
		description: 'Cut your clips, add captions, and export. No watermark.',
		privacy: 'Local projects and exports stay in the folder you choose.',
		steps: [
			'Open the editor and import or record your footage.',
			'Trim the clips, add captions, and choose the frame.',
			'Export the finished video to your device.'
		],
		sections: [
			{
				title: 'Turn a recording into a finished video',
				paragraphs: [
					'A product demo or a helpful explanation does not need a separate production setup. Record your screen, camera, or microphone, then edit the footage in your browser. Remove a pause, cut a mistake, and keep the part that explains the idea.',
					'Use Quick Cut for a simple trim, or the full Video Editor when you need several tracks, captions, transitions, color adjustments, and audio. The editor is in beta. Desktop Chrome or Edge gives you the full editing experience.'
				]
			},
			{
				title: 'Prepare the frame for your channel',
				paragraphs: [
					'Choose portrait for a vertical clip, square or feed portrait for a social post, or landscape for a walkthrough. Keep the important action inside the frame and check that captions remain readable at phone size.',
					'A longer recording can become more than one piece of content. Save the project, return to it for another cut, and adjust the opening for the channel where you plan to share it. Reuse your footage without making every version identical.'
				]
			},
			{
				title: 'Save the project as well as the export',
				paragraphs: [
					'Your exported video is the finished file you can upload or share. Your project holds the edits you may want to change later. Keep both when you expect to update a demo, fix a caption, or make another version.',
					'Local projects, recordings, and exports stay in the folder you choose. Export options depend on your browser and device, and the social network still has its own file limits. Review the finished video, including its sound and captions, before scheduling it.'
				]
			}
		],
		questions: [
			{
				question: 'Can I export without a watermark?',
				answer: 'Yes. The free editor does not add a watermark or require an account.'
			},
			{
				question: 'Which browser should I use?',
				answer:
					'Use a current desktop version of Chrome or Edge for full editing and export. Mobile supports capture and project preparation; editing and export capabilities vary by device.'
			},
			{
				question: 'Can I record my screen?',
				answer:
					'Yes. The recorder supports screen, camera, and microphone capture where your browser allows it. You choose what to record and grant the required browser permissions.'
			}
		]
	}
} satisfies Record<MarketingToolSlug, ToolArticle>;
