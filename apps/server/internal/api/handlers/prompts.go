package handlers

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"sync"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/google/uuid"
	"github.com/openpost/backend/internal/api/middleware"
	"github.com/openpost/backend/internal/models"
	"github.com/uptrace/bun"
)

// Built-in prompts seeded on first request.
type PromptHandler struct {
	db             *bun.DB
	auth           middleware.Authenticator
	seedMu         sync.Mutex
	seeded         bool
	builtinPrompts []models.Prompt
}

func NewPromptHandler(db *bun.DB, authenticator middleware.Authenticator) *PromptHandler {
	return &PromptHandler{
		db:   db,
		auth: authenticator,
		builtinPrompts: []models.Prompt{
			// Bold & Provoking
			{ID: "builtin-001", Text: "Share a bold, slightly extreme take on something you genuinely believe. Controversial opinions spark the best conversations — don't water it down.", Example: "Hot take: most \"growth hacking\" advice is busywork wearing a strategy costume. Posting daily is not a strategy. Posting with a point of view is. If you can't explain what one post is supposed to do, you're not growing — you're adding noise. Change my mind.", Category: promptCategoryBoldProvoking, IsBuiltIn: true},
			{ID: "builtin-002", Text: "What's a widely accepted 'best practice' in your field that you think is actually wrong?", Example: "Unpopular opinion: the \"always reply to every comment\" rule is hurting your content. It looks great in dashboards, but it teaches the algorithm that back-and-forth arguments are what you do. I reply to questions, thank real compliments, and skip the bait. My numbers went up.", Category: promptCategoryBoldProvoking, IsBuiltIn: true},
			{ID: "builtin-003", Text: "What's something almost everyone in your industry does that you quietly think is a waste of time?", Example: "I'll say it: most monthly reports are theater. We spent years building dashboards nobody read, then stopped. Now we track three numbers that actually drive decisions. Nobody has asked for the old report once.", Category: promptCategoryBoldProvoking, IsBuiltIn: true},
			{ID: "builtin-004", Text: "Finish this: 'Everyone talks about X, but nobody wants to admit that...'", Example: "Everyone talks about work-life balance, but nobody wants to admit that the person who \"has it all\" usually just moved the line. I stopped chasing balance. I chase seasons — grind quarters, then real recovery. It's not pretty, but it's honest.", Category: promptCategoryBoldProvoking, IsBuiltIn: true},

			// Storytelling
			{ID: "builtin-005", Text: "Tell the story of how you got into what you do. Skip the LinkedIn version — make it honest.", Example: "I didn't plan any of this. Four years ago I was fixing spreadsheets at 2am, bored out of my mind, and I started writing small tools to automate my own job. That side project became my company. There was no vision board. There was a deadline, a broken process, and stubbornness.", Category: promptCategoryStorytelling, IsBuiltIn: true},
			{ID: "builtin-006", Text: "Tell a story about a failure that ultimately led to your biggest win. What did you actually learn?", Example: "We launched a product that failed so hard we refunded every customer and deleted the marketing page. It cost us 9 months and a lot of pride. But the one feature people kept asking to keep became our best-selling product today. Failure is usually just data you weren't ready to read.", Category: promptCategoryStorytelling, IsBuiltIn: true},
			{ID: "builtin-007", Text: "Describe a moment where everything clicked. What changed after that?", Example: "The moment it clicked: a customer emailed \"this tool finally feels like it was built for people like me.\" We had spent two years building for a persona we invented. After that, we only built features three real customers asked for. Revenue tripled in a year.", Category: promptCategoryStorytelling, IsBuiltIn: true},
			{ID: "builtin-008", Text: "What's a decision you almost didn't make that completely changed your trajectory?", Example: "I almost turned down the call that changed everything. I was busy, it was cold outreach, and I was one click away from archive. That call led to our first enterprise deal. Lesson: answer the strange calls. The path you can't predict is usually the good one.", Category: promptCategoryStorytelling, IsBuiltIn: true},

			// Repurpose & FAQ
			{ID: "builtin-009", Text: "What's a question you get asked over and over? Answer it properly, once and for all.", Example: "I get asked the same question weekly: \"How much does this actually cost?\" So here's the real answer. The software is free. The cost is your time — about 10 hours to set up properly. What you get is 5 hours back every week. That's the honest math nobody puts in the pitch.", Category: promptCategoryRepurposeFAQ, IsBuiltIn: true},
			{ID: "builtin-010", Text: "What do people always misunderstand about what you do? Set the record straight.", Example: "No, I don't \"post for you.\" I give you the systems so you post better yourself — templates, a calendar, feedback loops. Running your feed for you is a different product. Both are valid. But if you buy one expecting the other, you'll be disappointed.", Category: promptCategoryRepurposeFAQ, IsBuiltIn: true},
			{ID: "builtin-011", Text: "Turn your most common question into content. If people keep asking, others are wondering too.", Example: "The #1 question I get: \"How do I find time to write?\" My honest answer: you don't find it, you schedule it. I write 20 minutes before my first meeting, every day, even when it's bad. Bad writing is faster to fix than a blank page. That's the whole secret.", Category: promptCategoryRepurposeFAQ, IsBuiltIn: true},
			{ID: "builtin-012", Text: "What's the advice you keep giving privately that you've never posted publicly?", Example: "I give this advice to clients all the time but never post it: stop posting every day. Most accounts are better served by 3 strong posts a week than 7 forgettable ones. Consistency matters, but only if the quality clears the bar.", Category: promptCategoryRepurposeFAQ, IsBuiltIn: true},

			// Daily Updates
			{ID: "builtin-013", Text: "What are you working on today? Share what's on your plate — then ask your audience what's on theirs.", Example: "Today's plate: shipping the export feature, finally cleaning up the backlog of 40 half-finished drafts, and one hard conversation with a vendor we're outgrowing. It's an ordinary Tuesday and I love it. What's on your plate today?", Category: promptCategoryDailyUpdates, IsBuiltIn: true},
			{ID: "builtin-014", Text: "What's your plan for the weekend? Share yours and ask your followers what they've got going on.", Example: "Weekend plan: zero screens until Sunday afternoon. Two long runs, one long dinner, and finishing a book I've been \"reading\" since March. The reset is non-negotiable — Monday-me is a different human. What are you all up to?", Category: promptCategoryDailyUpdates, IsBuiltIn: true},
			{ID: "builtin-015", Text: "What are your top 3 priorities this week? Saying them out loud makes them real.", Example: "This week, three priorities: 1) ship the beta to 100 users, 2) decide on pricing before Friday, 3) reply to every piece of feedback that lands in the inbox. That's it. Everything else waits. What are your three?", Category: promptCategoryDailyUpdates, IsBuiltIn: true},
			{ID: "builtin-016", Text: "Walk through your morning routine. The boring parts too — those are often the most relatable.", Example: "My morning routine, unfiltered: wake up, make coffee, skip the gym, stare at email for 45 minutes, then remember my one task and do it first. The habit that saves me is writing that one task down before I open anything else.", Category: promptCategoryDailyUpdates, IsBuiltIn: true},

			// How-To & Educational
			{ID: "builtin-017", Text: "Teach something you know well. Break it into steps small enough that a beginner could follow along.", Example: "How to make a landing page that converts, in 4 steps. 1) One sentence that says who it's for and what they get. 2) One image of the actual product — not a stock photo. 3) One button. 4) A five-line story of how it works. That's it. Everything else is decoration.", Category: promptCategoryHowTo, IsBuiltIn: true},
			{ID: "builtin-018", Text: "What took you years to figure out that you could explain to someone in 5 minutes today?", Example: "It took me 4 years to learn what I can now explain in 5 minutes: your pricing page should have three options, not two. Two makes people freeze. Three gives them an anchor, a target, and an escape. Sales talk reduces, revenue goes up.", Category: promptCategoryHowTo, IsBuiltIn: true},
			{ID: "builtin-019", Text: "Share a shortcut, trick, or habit that quietly saves you hours every week.", Example: "The trick that saves me 5+ hours a week: a weekly review every Friday at 4pm. I close every tab, move every half-finished idea to one list, and write next week's top 3. Monday morning I never \"figure out what to do\" — I just start.", Category: promptCategoryHowTo, IsBuiltIn: true},
			{ID: "builtin-020", Text: "Write a 'what not to do' guide for someone just starting out in your field. Be specific.", Example: "What not to do when starting your own product: don't build the full vision — build the smallest thing that solves one real problem. Don't ask friends if it's good — they'll say yes. Don't wait for the perfect launch — ship to 10 strangers and watch them use it.", Category: promptCategoryHowTo, IsBuiltIn: true},

			// Reflection & Growth
			{ID: "builtin-021", Text: "What's something you learned this week that genuinely surprised you?", Example: "This week I learned that our best customers weren't the first to sign up — they were the ones who nearly left and stayed. Every \"churn risk\" conversation taught us more than any happy customer ever did. The almost-losers are your best teachers.", Category: promptCategoryReflection, IsBuiltIn: true},
			{ID: "builtin-022", Text: "What's a mistake you made recently, and what would you do differently now?", Example: "Recent mistake: I shipped a feature because one loud customer demanded it, without checking how many others would use it. Two weeks later, adoption is near zero. Next time I'll ask for 3 customers who'd pay for it before I build anything.", Category: promptCategoryReflection, IsBuiltIn: true},
			{ID: "builtin-023", Text: "What would you tell yourself from a year ago? Be specific — not just 'believe in yourself'.", Example: "If I could tell myself a year ago: stop optimizing the dashboard nobody opens. The metrics that matter are customers who stay and customers who tell friends. Also: that hiring decision you're agonizing over? The answer is yes. You'll know within a month.", Category: promptCategoryReflection, IsBuiltIn: true},
			{ID: "builtin-024", Text: "What's something you're currently struggling with? Sharing the hard parts builds real connection.", Example: "Honestly? I'm struggling with focus. My days have become a meeting soup and the real work keeps sliding to 9pm. I know the fix — I've written about it. So this week I'm blocking 2 hours every morning, no exceptions. Writing it here makes it real.", Category: promptCategoryReflection, IsBuiltIn: true},

			// Engagement & Community
			{ID: "builtin-025", Text: "Ask your followers: what's one thing you wish you'd learned much earlier in your career?", Example: "Career question for all of you: what's one thing you wish someone had told you in your first year? I'll go first — being good at your job matters less than being easy to work with. Your turn. I read every reply.", Category: promptCategoryEngagement, IsBuiltIn: true},
			{ID: "builtin-026", Text: "Drop a hot take. Something you actually believe, not something safe. Then defend it.", Example: "Hot take: the 4-day work week is a luxury most companies can't afford yet — and pretending otherwise is dishonest. Fewer hours only works if the work shrinks too. Most teams are still drowning in 5 days of meetings. Fix the meetings first. Agree or disagree?", Category: promptCategoryEngagement, IsBuiltIn: true},
			{ID: "builtin-027", Text: "Fill in the blank: 'The one thing I wish more people understood about _____ is _____.'", Example: "The one thing I wish more people understood about running a startup is that it's mostly boring. Not glamorous. Not dramatic. Just a long list of small decisions, made correctly, in a row, for years. The \"overnight success\" usually had 2,000 quiet Tuesdays behind it.", Category: promptCategoryEngagement, IsBuiltIn: true},
			{ID: "builtin-028", Text: "Ask your audience: What should I write about next? Let them shape your content.", Example: "I've been posting for 3 months and I want to write what you actually want to read. Pick one: A) how we got our first 100 customers, B) our real pricing math, C) the tools we use every day, or D) a post-mortem of our worst launch. Comment a letter. The winner gets written this week.", Category: promptCategoryEngagement, IsBuiltIn: true},

			// Tools & Workflow
			{ID: "builtin-029", Text: "What's one tool you'd recommend to anyone in your field, and why does it actually matter?", Example: "If you run any kind of business, get a second monitor. That's not a flex — it's the difference between comparing docs side by side and alt-tabbing 80 times a day. It's the cheapest productivity upgrade I own. Fewer interruptions is the whole point.", Category: promptCategoryToolsWorkflow, IsBuiltIn: true},
			{ID: "builtin-030", Text: "What's a workflow or process change that made you noticeably more productive?", Example: "The change that made the biggest dent: no meetings before 11am. Every morning is now 2.5 hours of deep work before the world wakes up. It took two weeks for the team to adjust, and it doubled my output. If you control your calendar, give it a try.", Category: promptCategoryToolsWorkflow, IsBuiltIn: true},
			{ID: "builtin-031", Text: "What's an automation you set up recently that you're quietly proud of? Walk people through it.", Example: "The automation I'm proudest of: every new sales email gets tagged, scored, and — if it's a cold pitch — auto-archived with a polite \"not interested\" reply. My inbox went from 60 noisy emails a day to 10 real ones. Simple rules, 20 minutes back every day.", Category: promptCategoryToolsWorkflow, IsBuiltIn: true},
			{ID: "builtin-032", Text: "What does your actual workspace look like right now? Share the setup — messy or not.", Example: "My workspace right now: one laptop, one coffee, a pile of sticky notes I'm too afraid to throw away, and a dog asleep on my feet. No standing desk, no fancy lighting. It's unglamorous and it works. Your setup doesn't need to be pretty — it needs to be yours.", Category: promptCategoryToolsWorkflow, IsBuiltIn: true},

			// Behind the Scenes
			{ID: "builtin-033", Text: "What would people be surprised to learn about what your work actually looks like day-to-day?", Example: "People think running a SaaS is strategy meetings and product demos. Reality: 60% of my week is saying no — to feature ideas, meetings, \"quick chats,\" and partners. The job is mostly protection: of the roadmap, the team's time, and the product's focus.", Category: promptCategoryBehindScenes, IsBuiltIn: true},
			{ID: "builtin-034", Text: "Share something from a project you're in the middle of — before it's polished or done.", Example: "Here's a raw look at what we're building: a search feature that's currently ugly and slow, but test users keep asking for it anyway. The design is still rough. The data model is a mess. But watching someone use it told us more than any roadmap ever did. Progress over polish.", Category: promptCategoryBehindScenes, IsBuiltIn: true},
			{ID: "builtin-035", Text: "Show the messy draft, the half-finished thing, the work in progress. People love seeing the real process.", Example: "First draft of our pricing email: 6 paragraphs, 4 jokes, 3 \"excited to share!\" The version we actually sent: 4 sentences. The process is usually subtractive. Showing the messy middle is the honest part — most final things you admire started as something embarrassing.", Category: promptCategoryBehindScenes, IsBuiltIn: true},
			{ID: "builtin-036", Text: "How do you actually go from a blank page (or blank file) to a finished thing? Walk us through it.", Example: "How I go from blank page to published: 1) write one terrible sentence to break the blank. 2) Write the ending first so I know where I'm going. 3) Write the middle badly. 4) Cut everything that doesn't serve the point. 5) Read it out loud once. Published. Done beats perfect.", Category: promptCategoryBehindScenes, IsBuiltIn: true},

			// Wins & Milestones
			{ID: "builtin-037", Text: "Share a win — recent or long overdue. Don't downplay it. You earned it.", Example: "Today we hit 1,000 paying customers. That number looked impossible two years ago when we had 12. To everyone who stayed through the beta bugs, the pricing changes, and the slow months — this one's for you. Now back to work; the next 1,000 won't wait.", Category: promptCategoryWins, IsBuiltIn: true},
			{ID: "builtin-038", Text: "What's something small you got done today that you're actually proud of?", Example: "Small win: I finally replied to the 14 emails I've been \"going to get to\" for two weeks. None took more than 3 minutes. My brain feels 10% lighter. Small tasks don't need big momentum — they just need to be done.", Category: promptCategoryWins, IsBuiltIn: true},
			{ID: "builtin-039", Text: "Shout out someone who's been doing great work lately. Public recognition goes a long way.", Example: "Public shoutout: our designer just rebuilt our onboarding flow, and churn on step 3 dropped by half. They noticed what nobody asked them to fix and fixed it anyway. That's the kind of ownership that builds companies. Hire people who fix what isn't their job.", Category: promptCategoryWins, IsBuiltIn: true},
			{ID: "builtin-040", Text: "What's a small win that felt way bigger than it looked from the outside?", Example: "A customer told me our tool \"made them feel organized for the first time in a year.\" That's not a metric I can put in a report. But it means more than any revenue number. Some wins are small from the outside and enormous from the inside.", Category: promptCategoryWins, IsBuiltIn: true},

			// Curated Lists
			{ID: "builtin-041", Text: "Share 3 resources — articles, books, tools, videos — that genuinely changed how you work.", Example: "Three things that genuinely changed how I work: 1) Deep Work by Cal Newport — the reason I block my mornings. 2) A 20-minute video on writing emails that get replies. 3) A simple to-do app I almost deleted twice. None are new. All of them stuck.", Category: promptCategoryCuratedLists, IsBuiltIn: true},
			{ID: "builtin-042", Text: "What are the 5 tools you actually use every day? Not the ones you recommend — the ones you depend on.", Example: "The 5 tools I actually can't run without: 1) a calendar, 2) a notes app, 3) a to-do list, 4) my browser, 5) and honestly, coffee. No project managers, no fancy dashboards, no AI stack. The tools that matter are the ones you'll actually open every day.", Category: promptCategoryCuratedLists, IsBuiltIn: true},
			{ID: "builtin-043", Text: "If someone asked you where to start in your field, what would you tell them to read, watch, or do first?", Example: "If you want to start in content and marketing: don't buy a course. Do this instead. Pick a topic you know better than your friends. Write one post a day for 30 days. Read the replies. That's the whole curriculum. The course you can afford later is usually just this, with better branding.", Category: promptCategoryCuratedLists, IsBuiltIn: true},
			{ID: "builtin-044", Text: "Who are 3 people in your space worth following? Tell people why, not just who.", Example: "Three people I learn from weekly in this space: one for brutally honest breakdowns of what works, one for tactical how-tos that are copy-pasteable, and one who thinks two years ahead. Follow all three and you've got a free masterclass every morning.", Category: promptCategoryCuratedLists, IsBuiltIn: true},

			// Predictions & Future
			{ID: "builtin-045", Text: "Where do you honestly think your industry is headed in the next 5 years? Make a real prediction.", Example: "Prediction: in 5 years, most software won't be sold — it'll be assembled. The next wave of companies won't build products from scratch; they'll compose them from better APIs. The winners will understand workflows, not code. The no-code revolution is just the beginning.", Category: promptCategoryPredictions, IsBuiltIn: true},
			{ID: "builtin-046", Text: "What's a trend you've been watching closely? What does it tell you about where things are going?", Example: "Trend I'm watching: AI assistants that act on your behalf — booking, scheduling, even drafting. The signal: the interface is moving from \"you type, it responds\" to \"you delegate, it does.\" The brands that win will be the ones that become easy to delegate to.", Category: promptCategoryPredictions, IsBuiltIn: true},
			{ID: "builtin-047", Text: "What emerging technology or shift excites you most right now — and what do you think it'll actually change?", Example: "The thing that excites me most: voice interfaces that are actually good. Not the joke they were five years ago. If talking to software becomes as natural as talking to a colleague, the whole app economy reshapes around voice-first. I'm building for that.", Category: promptCategoryPredictions, IsBuiltIn: true},
			{ID: "builtin-048", Text: "What's something in your field that you think will be completely obsolete in 10 years?", Example: "In 10 years, the traditional \"set up a new hire\" experience will be gone — weeks of context, docs, and onboarding meetings replaced by an assistant that already knows your tools and your history. The onboarding manual is going to read like a fax machine manual. It's coming.", Category: promptCategoryPredictions, IsBuiltIn: true},

			// Quick & Easy
			{ID: "builtin-049", Text: "Share a screenshot of something you're working on right now. No context needed.", Example: "No caption. Just the current state of the thing I'm building. [attach screenshot]", Category: promptCategoryQuickEasy, IsBuiltIn: true},
			{ID: "builtin-050", Text: "What's one thing on your desk or in your space that has a story behind it?", Example: "This cracked mug has been on my desk for 6 years. It was my first company's last piece of merch before we shut down. I keep it to remember that surviving is a skill too. Some things on your desk aren't clutter — they're evidence.", Category: promptCategoryQuickEasy, IsBuiltIn: true},
			{ID: "builtin-051", Text: "Share a quote that's been stuck in your head lately — and why it landed.", Example: "\"Done is better than perfect.\" I've heard it a hundred times, but it finally landed this week when I shipped something I'd been polishing for a month. The rough version got 10x the feedback the perfect version would have gotten. Quotes stick when you've lived them.", Category: promptCategoryQuickEasy, IsBuiltIn: true},
			{ID: "builtin-052", Text: "What's the last tab you had open that wasn't work? Be honest.", Example: "The last non-work tab I had open: a live cam of puffins on a cliff in Iceland. I don't know why. I don't know a single puffin. But it's been my background tab for a week and it's the most peaceful thing I own.", Category: promptCategoryQuickEasy, IsBuiltIn: true},

			// Developer
			{ID: "builtin-053", Text: "What's a piece of code you wrote that you're genuinely proud of? Share what makes it good.", Example: "The code I'm proudest of is 40 lines long and I haven't touched it in 2 years. It's the function that makes our weekly digest email assemble itself. No meetings, no bug reports, no \"can you look at this?\" The best code is the code you forget about because it just works.", Category: promptCategoryDeveloper, IsBuiltIn: true},
			{ID: "builtin-054", Text: "What's a bug that took you way too long to find? Walk through the moment you finally figured it out.", Example: "The bug that owned me for 3 days: a random 0.1% of orders lost their discount. The cause? A floating-point comparison. 19.99 !== 19.99 because of rounding eight decimals deep. I fixed it with a one-character change and questioned my entire career for a week.", Category: promptCategoryDeveloper, IsBuiltIn: true},
			{ID: "builtin-055", Text: "What's your current stack, and what would you change if you were starting fresh today?", Example: "Current stack: a boring monolith, one database, and a lot of restraint. If I started over I'd use the same boring choices. Every \"clever\" technology decision I made added a learning curve, not a feature. Start boring. Add complexity only when a real user demands it.", Category: promptCategoryDeveloper, IsBuiltIn: true},
			{ID: "builtin-056", Text: "What's a library, framework, or tool you've changed your mind about — positively or negatively?", Example: "I used to hate ORMs. \"Raw SQL or nothing,\" I'd say. Then I joined a team that used one properly, and I realized my hatred was for the misuse, not the tool. Now I write 90% less boilerplate and my queries still fly. Changed my mind completely. What have you flip-flopped on?", Category: promptCategoryDeveloper, IsBuiltIn: true},
			{ID: "builtin-057", Text: "What's something you built just for yourself that turned out to be genuinely useful?", Example: "I built a tiny script to remind me to stand up — a notification that just says \"get up, coward.\" Three years later it's the most-installed thing I've ever made, because I open-sourced it and 2,000 people use it too. The best software starts as a selfish itch.", Category: promptCategoryDeveloper, IsBuiltIn: true},
			{ID: "builtin-058", Text: "How do you approach learning a new technology? Share your actual process, not the idealized version.", Example: "My actual process for learning a new tech: 1) read the quickstart and get confused. 2) Copy-paste a tutorial until it breaks. 3) Break it on purpose to see the errors. 4) Build something small and bad. 5) Read the docs with fresh eyes. Not elegant, but the knowledge sticks.", Category: promptCategoryDeveloper, IsBuiltIn: true},
			{ID: "builtin-059", Text: "What's a concept that took you a long time to really understand — and what finally made it click?", Example: "Functional programming took me years to \"get\" until I stopped memorizing terms and forced myself to write 10 functions without any mutable state. The click wasn't a lecture — it was wrestling with the constraint. Concepts make sense when you hit the wall, not before.", Category: promptCategoryDeveloper, IsBuiltIn: true},
			{ID: "builtin-060", Text: "Open source, side projects, freelance, or full-time — what's your current mix, and how did you get there?", Example: "My mix: a full-time job, one side project that's been \"almost ready\" for 18 months, and one open-source library that gets 10 downloads a week and brings me more joy than anything I've shipped professionally. I got here by being honest that the side project might never launch — and being fine with it.", Category: promptCategoryDeveloper, IsBuiltIn: true},

			// Building in Public (founder product posts)
			{ID: "builtin-061", Text: "Announce a feature you just shipped. Don't just announce — show what it unlocks with a specific, surprising detail.", Example: "We just added one-click translation to our app. Sounds small, right? But when we looked at the data, 40% of our highest-paying accounts had international customers. We almost didn't build it because only 12% of total users asked for it. Lesson: don't just count who wants a feature. Look at who's paying for it.", Category: promptCategoryBuildInPublic, IsBuiltIn: true},
			{ID: "builtin-062", Text: "Share a product decision you reversed after talking to customers. Shows you're thoughtful.", Example: "Last month we were about to add dark mode everywhere. Then we talked to 10 customers. Every single one said they'd never use it on the editor — it was for the reading view only. We cut the scope by 80% and shipped it in a week. Talking to customers beat our roadmap again.", Category: promptCategoryBuildInPublic, IsBuiltIn: true},
			{ID: "builtin-063", Text: "Explain a 'no' you gave a customer. Explaining your 'no' builds trust in your 'yes.'", Example: "A customer asked for CSV export yesterday. We said no — for now. Here's why: only 3 accounts have asked, and building it would delay the API we're shipping for the team that pays 60% of our revenue. It's a prioritization, not a rejection. If more of you need it, we'll move it up. Say so in the comments.", Category: promptCategoryBuildInPublic, IsBuiltIn: true},
			{ID: "builtin-064", Text: "Share a metric you're watching — even an uncomfortable one. Specific numbers beat vague growth claims.", Example: "47 customers churned last month. But here's what's interesting — we talked to every single one. The #1 reason: our onboarding took too long. So we're fixing it. Churn is only scary when you don't know why it happens. Now we do.", Category: promptCategoryBuildInPublic, IsBuiltIn: true},
			{ID: "builtin-065", Text: "Reveal every tool you use to run your company. People love seeing how companies actually run.", Example: "Here's every tool we use to run our startup with a team of 4: Notion for everything written, Linear for bugs, a $12/mo analytics tool, and email for the stuff we're too scared to migrate. Total: about $180/mo. We're boring on purpose, so the money goes into the product.", Category: promptCategoryBuildInPublic, IsBuiltIn: true},

			// Founder Story (posts about you)
			{ID: "builtin-066", Text: "Tell your origin story. New followers haven't heard it — tell it once a quarter.", Example: "3 years ago I was a product manager drowning in 4 different tools just to publish one post. I kept thinking \"why doesn't one tool just do this?\" So I built it — badly, in a weekend. That weekend hack now serves thousands of creators. The best origin stories start with an annoyance, not a vision.", Category: promptCategoryFounderStory, IsBuiltIn: true},
			{ID: "builtin-067", Text: "Share your worst professional mistake and what you learned. Vulnerability builds trust faster than perfection.", Example: "Worst hiring decision I ever made: I hired for \"nice in the interview\" over \"actually good at the job.\" Three months and one rescued project later, I learned the lesson the expensive way. Hiring is the one decision where slow and skeptical beats fast and hopeful.", Category: promptCategoryFounderStory, IsBuiltIn: true},
			{ID: "builtin-068", Text: "Share your founder routines — including the ones you skip. Founders are curious how other founders operate.", Example: "My non-negotiable habits as a founder: 20 minutes of walking before any meeting, one screen-free hour after work, and writing tomorrow's top task on paper before bed. The one I skip when things get crazy: the walk. The one I never skip: the paper list. That list has saved more deadlines than anything else.", Category: promptCategoryFounderStory, IsBuiltIn: true},
			{ID: "builtin-069", Text: "Share advice you received and ignored — and what happened. Hindsight content resonates because everyone has their own version.", Example: "An investor told me two years ago: \"your pricing is too low and you're leaving money on the table.\" I ignored it — I was scared of losing customers. We raised prices 6 months later and lost 4 of 200 customers. Revenue went up 30%. Ignoring good advice out of fear is expensive.", Category: promptCategoryFounderStory, IsBuiltIn: true},
			{ID: "builtin-070", Text: "Take a stance most people in your industry won't. Invite the debate at the end.", Example: "Unpopular opinion: most startups don't need a social media manager. They need their founder to post 3x a week for 6 months. A social media manager can amplify a voice. But they can't create one from scratch. The founder's perspective is what actually makes people follow a company page. Agree or disagree?", Category: promptCategoryFounderStory, IsBuiltIn: true},

			// Industry Commentary (posts about your market)
			{ID: "builtin-071", Text: "Comment on something happening in your industry right now — and what people are missing.", Example: "Everyone's talking about AI replacing content teams. Here's what they're missing: the bottleneck was never writing — it was taste. AI can draft a hundred versions; it still needs a human who knows which one is good. The teams that survive get better at editing, not faster at typing.", Category: promptCategoryIndustry, IsBuiltIn: true},
			{ID: "builtin-072", Text: "Demystify something insiders know but outsiders don't.", Example: "Most people think a \"viral\" post is luck. Here's how it actually works: the first hour decides everything. A post that gets strong early engagement gets shown to more people, which earns more engagement — it's a compounding loop, not a lottery. That's why timing and an engaged core audience matter more than the algorithm gods.", Category: promptCategoryIndustry, IsBuiltIn: true},
			{ID: "builtin-073", Text: "Make a bold, specific prediction about your market. Be willing to be wrong.", Example: "Prediction: in 2 years, the \"social media agency\" will be a dying business model. The tools are getting good enough that a founder plus AI can do what a 5-person agency did. What won't die: strategy and voice. The agencies that sell execution are in trouble. The ones that sell perspective will thrive.", Category: promptCategoryIndustry, IsBuiltIn: true},
			{ID: "builtin-074", Text: "Compare two approaches, tools, or strategies for a use case. Show when each makes sense.", Example: "Posting daily vs posting weekly: for a personal brand, daily works — the algorithm rewards volume for individuals. For a company account, weekly wins — one strong post beats seven weak ones, and companies need to protect their name. Different goals, different cadences. Pick based on the account, not the trend.", Category: promptCategoryIndustry, IsBuiltIn: true},
			{ID: "builtin-075", Text: "Analyze something a respected company or person does differently. Borrow their credibility.", Example: "Notion does onboarding differently than everyone else: they don't teach you the product. They hand you a blank page and let you play. Most SaaS forces you through 10 steps first. Notion bets that exploration beats instruction. Sometimes the best product experience is getting out of the way.", Category: promptCategoryIndustry, IsBuiltIn: true},

			// Team & Culture (posts about your people)
			{ID: "builtin-076", Text: "Welcome a new hire with a specific reason you're excited. They'll share it, extending your reach.", Example: "Maria just joined us as our first marketing hire. Why I'm excited: in her last job she grew a newsletter from 2k to 60k without a single paid ad — by being relentlessly useful. She could have gone anywhere; she chose a 4-person team. Welcome aboard. We're going to learn a lot from you.", Category: promptCategoryTeamCulture, IsBuiltIn: true},
			{ID: "builtin-077", Text: "Shine light on your team, not yourself. Describe the backstory.", Example: "Shoutout to our support lead, who quietly rewrote every help article this month. Not asked, not on the roadmap — they just noticed the docs were bad and fixed them. Support tickets starting with \"the docs told me to do this\" dropped 40%. The best work is the work nobody assigns.", Category: promptCategoryTeamCulture, IsBuiltIn: true},
			{ID: "builtin-078", Text: "Explain how you think about building teams. What do you actually optimize for?", Example: "We don't hire for \"culture fit.\" That phrase usually means \"like us.\" We hire for curiosity and ownership — people who ask \"why are we doing this?\" and fix what isn't their job. A team of owners beats a team of friends every time. They can become friends too. That happens naturally.", Category: promptCategoryTeamCulture, IsBuiltIn: true},
			{ID: "builtin-079", Text: "Show what working at your company actually looks like.", Example: "What our Monday all-hands looks like: 30 minutes, four slides — wins, blockers, customer quotes, and one question for the room. No status theater. The rule: if it's in the project tracker, you don't repeat it in the meeting. Mondays at 9:30. Tuesdays through Fridays are for work.", Category: promptCategoryTeamCulture, IsBuiltIn: true},
			{ID: "builtin-080", Text: "Show one of your values through a real, specific story. Don't list values — demonstrate them.", Example: "One of our values is \"boring is a compliment.\" Here's what that looked like last week: a customer asked for a wild new feature. We shipped the stable version of the thing they actually needed instead — in half the time, with zero downtime. Dazzling is easy. Reliable is the real flex.", Category: promptCategoryTeamCulture, IsBuiltIn: true},

			// Lessons & Frameworks (posts that teach)
			{ID: "builtin-081", Text: "Give people a mental model they can apply to a common decision.", Example: "How I decide what to build next, in 3 filters: 1) Will 3 paying customers use it this month? 2) Can we ship it in 2 weeks? 3) Does it make the product easier to explain? If it fails any filter, it waits. This framework has killed 20+ \"brilliant\" ideas — and those were the best ones killed.", Category: promptCategoryLessons, IsBuiltIn: true},
			{ID: "builtin-082", Text: "Recommend a book, podcast, or article with context — the key idea and why it mattered.", Example: "This book changed how I think about money: The Psychology of Money. The key idea: doing well with money has little to do with how smart you are and a lot to do with how you behave. I'd heard every finance tip before. Reading the why behind them is what made them stick.", Category: promptCategoryLessons, IsBuiltIn: true},
			{ID: "builtin-083", Text: "Write a letter to your past self. The classic format because it works.", Example: "5 things I'd tell myself when I started this company: 1) Your first pricing will be wrong — raise it sooner. 2) The customers you lose are the best research you'll ever get. 3) Ship the ugly version today. 4) Your \"bad\" quarter is normal, not a crisis. 5) You're going to be okay. Probably not the last one.", Category: promptCategoryLessons, IsBuiltIn: true},
			{ID: "builtin-084", Text: "Challenge conventional wisdom with something you've learned the hard way.", Example: "Counterintuitive thing I've learned: posting less grows you faster. We spent months on daily content and went nowhere. We cut to 3 strong posts a week with one clear point each, and reach roughly doubled. The algorithm rewards completion, not volume. More posts just gives people more chances to scroll past.", Category: promptCategoryLessons, IsBuiltIn: true},
			{ID: "builtin-085", Text: "Give away something genuinely useful — a template, doc, or framework.", Example: "Here's the exact template we use to write our weekly newsletter. Four sections: 1) One thing we learned. 2) One tool that saved us time. 3) One mistake we made. 4) One thing we're excited about. That's it. Steal it. It took us a year to learn that consistency beats cleverness.", Category: promptCategoryLessons, IsBuiltIn: true},

			// Engagement Starters (posts that spark conversation)
			{ID: "builtin-086", Text: "Ask a simple question people actually want to answer. Go first with yours.", Example: "Founders: what's one tool you couldn't run your company without? I'll start — ours is a $9/mo todo app, and everything else is negotiable. Your turn.", Category: promptCategoryEngageStart, IsBuiltIn: true},
			{ID: "builtin-087", Text: "Invite others to share their hot takes. Go first with yours.", Example: "What's an unpopular opinion you have about the SaaS industry? I'll go first: most pricing pages are copy-paste from each other, and nobody has thought about their pricing since they set it. Your turn. I'll reply to the best ones.", Category: promptCategoryEngageStart, IsBuiltIn: true},
			{ID: "builtin-088", Text: "Run a poll on a question you genuinely don't know the answer to.", Example: "Which matters more for an early-stage startup? A) a stunning product, or B) a distribution channel you own. I have a guess, but I want yours. Vote below — and defend your pick in the comments.", Category: promptCategoryEngageStart, IsBuiltIn: true},
			{ID: "builtin-089", Text: "Present a dilemma you actually faced and ask what they'd do.", Example: "Scenario: your biggest customer — 40% of revenue — asks for a feature only they want, or they'll leave. Build it and grow dependent, or lose them and stay focused? What would you do? Here's what we did: [answer in comments]. I'll tell the full story if this gets traction.", Category: promptCategoryEngageStart, IsBuiltIn: true},
			{ID: "builtin-090", Text: "Thank someone who helped you. They'll engage, and their network sees it.", Example: "Shoutout to Maria, our first customer, who stayed through every buggy beta and then sent us 11 pages of feedback — for free, out of kindness. We made it to 1,000 customers because someone believed before it made sense to. Thank you. This is what \"early supporter\" really means.", Category: promptCategoryEngageStart, IsBuiltIn: true},
		},
	}
}

func (h *PromptHandler) seedBuiltInPrompts(ctx context.Context) error {
	h.seedMu.Lock()
	defer h.seedMu.Unlock()

	if h.seeded {
		return nil
	}

	now := time.Now().UTC()
	prompts := make([]models.Prompt, len(h.builtinPrompts))
	copy(prompts, h.builtinPrompts)
	for index := range prompts {
		prompts[index].CreatedAt = now
	}
	if len(prompts) > 0 {
		if _, err := h.db.NewInsert().
			Model(&prompts).
			On("CONFLICT (id) DO UPDATE SET text = EXCLUDED.text, example = EXCLUDED.example, category = EXCLUDED.category").
			Exec(ctx); err != nil {
			return err
		}
	}

	h.seeded = true
	return nil
}

func (h *PromptHandler) checkWorkspaceAccess(ctx context.Context, workspaceID, userID string) error {
	allowed, err := workspaceReadAllowed(ctx, h.db, workspaceID, userID)
	if err != nil {
		return huma.Error500InternalServerError(errValidateWorkspaceAccess)
	}
	if !allowed {
		return huma.Error403Forbidden(errWorkspaceAccessDenied)
	}
	return nil
}

func (h *PromptHandler) checkWorkspaceEditAccess(ctx context.Context, workspaceID, userID string) error {
	allowed, err := workspaceEditAllowed(ctx, h.db, workspaceID, userID)
	if err != nil {
		return huma.Error500InternalServerError(errValidateWorkspaceAccess)
	}
	if !allowed {
		return huma.Error403Forbidden("workspace editor role required")
	}
	return nil
}

func (h *PromptHandler) promptReadScope(
	ctx context.Context,
	userID,
	requestedWorkspaceID string,
) (string, bool, error) {
	if requestedWorkspaceID != "" {
		if err := h.checkWorkspaceAccess(ctx, requestedWorkspaceID, userID); err != nil {
			return "", false, err
		}
		return requestedWorkspaceID, false, nil
	}
	scopedWorkspaceID := middleware.GetWorkspaceID(ctx)
	if scopedWorkspaceID != "" {
		if err := h.checkWorkspaceAccess(ctx, scopedWorkspaceID, userID); err != nil {
			return "", false, err
		}
		return scopedWorkspaceID, false, nil
	}
	return "", true, nil
}

func promptReadQuery(
	query *bun.SelectQuery,
	workspaceID string,
	includePersonal bool,
	userID string,
) *bun.SelectQuery {
	if includePersonal {
		return query.Where("(is_built_in = ? OR (COALESCE(workspace_id, '') = '' AND user_id = ?))", true, userID)
	}
	return query.Where("(is_built_in = ? OR workspace_id = ?)", true, workspaceID)
}

type PromptResponse struct {
	ID          string `json:"id" doc:"Prompt ID"`
	WorkspaceID string `json:"workspace_id,omitempty" doc:"Workspace ID (if custom)"`
	UserID      string `json:"user_id,omitempty" doc:"User ID (if custom)"`
	Text        string `json:"text" doc:"Prompt text"`
	Example     string `json:"example" doc:"Full example post for the prompt (may be empty)"`
	Category    string `json:"category" doc:"Prompt category"`
	IsBuiltIn   bool   `json:"is_built_in" doc:"Whether this is a built-in prompt"`
	CreatedAt   string `json:"created_at" doc:"Creation time (ISO 8601)"`
}

type ListPromptsInput struct {
	WorkspaceID string `query:"workspace_id" doc:"Filter by workspace ID"`
	Category    string `query:"category" doc:"Filter by category"`
}

type ListPromptsOutput struct {
	Body []PromptResponse
}

func (h *PromptHandler) ListPrompts(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "list-prompts",
		Method:      http.MethodGet,
		Path:        "/prompts",
		Summary:     "List writing prompts",
		Tags:        []string{tagPrompts},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
		Errors:      []int{403, 500},
	}, func(ctx context.Context, input *ListPromptsInput) (*ListPromptsOutput, error) {
		userID := middleware.GetUserID(ctx)

		// Seed built-in prompts on first request
		if err := h.seedBuiltInPrompts(ctx); err != nil {
			return nil, huma.Error500InternalServerError("failed to seed prompts")
		}

		var prompts []models.Prompt
		query := h.db.NewSelect().Model(&prompts)

		workspaceID, includePersonal, err := h.promptReadScope(ctx, userID, input.WorkspaceID)
		if err != nil {
			return nil, err
		}
		query = promptReadQuery(query, workspaceID, includePersonal, userID)

		if input.Category != "" {
			query = query.Where("category = ?", input.Category)
		}

		query = query.Order("is_built_in DESC", "category ASC", "created_at DESC")

		if err := query.Scan(ctx); err != nil {
			return nil, huma.Error500InternalServerError("failed to fetch prompts")
		}

		resp := make([]PromptResponse, len(prompts))
		for i, p := range prompts {
			resp[i] = PromptResponse{
				ID:          p.ID,
				WorkspaceID: p.WorkspaceID,
				UserID:      p.UserID,
				Text:        p.Text,
				Example:     p.Example,
				Category:    p.Category,
				IsBuiltIn:   p.IsBuiltIn,
				CreatedAt:   p.CreatedAt.Format(time.RFC3339),
			}
		}

		return &ListPromptsOutput{Body: resp}, nil
	})
}

type CreatePromptInput struct {
	Body struct {
		WorkspaceID string `json:"workspace_id,omitempty" doc:"Workspace ID (for workspace prompt)"`
		Text        string `json:"text" minLength:"1" maxLength:"500" doc:"Prompt text"`
		Example     string `json:"example" maxLength:"2000" doc:"Full example post for the prompt"`
		Category    string `json:"category" minLength:"1" maxLength:"50" doc:"Prompt category"`
	}
}

type CreatePromptOutput struct {
	Body PromptResponse
}

func (h *PromptHandler) CreatePrompt(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "create-prompt",
		Method:      http.MethodPost,
		Path:        "/prompts",
		Summary:     "Create a custom writing prompt",
		Tags:        []string{tagPrompts},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
		Errors:      []int{400, 403},
	}, func(ctx context.Context, input *CreatePromptInput) (*CreatePromptOutput, error) {
		userID := middleware.GetUserID(ctx)

		// Verify workspace access if provided
		if input.Body.WorkspaceID != "" {
			if err := h.checkWorkspaceEditAccess(ctx, input.Body.WorkspaceID, userID); err != nil {
				return nil, err
			}
		} else if middleware.GetWorkspaceID(ctx) != "" {
			return nil, huma.Error403Forbidden(errWorkspaceAccessDenied)
		}

		prompt := &models.Prompt{
			ID:          uuid.New().String(),
			WorkspaceID: input.Body.WorkspaceID,
			UserID:      userID,
			Text:        input.Body.Text,
			Example:     input.Body.Example,
			Category:    input.Body.Category,
			IsBuiltIn:   false,
			CreatedAt:   time.Now().UTC(),
		}

		if _, err := h.db.NewInsert().Model(prompt).Exec(ctx); err != nil {
			return nil, huma.Error500InternalServerError("failed to create prompt")
		}

		return &CreatePromptOutput{Body: PromptResponse{
			ID:          prompt.ID,
			WorkspaceID: prompt.WorkspaceID,
			UserID:      prompt.UserID,
			Text:        prompt.Text,
			Example:     prompt.Example,
			Category:    prompt.Category,
			IsBuiltIn:   prompt.IsBuiltIn,
			CreatedAt:   prompt.CreatedAt.Format(time.RFC3339),
		}}, nil
	})
}

type DeletePromptInput struct {
	PathID string `path:"id" doc:"Prompt ID"`
}

type DeletePromptOutput struct {
	Body struct {
		Message string `json:"message" doc:"Success message"`
	}
}

func (h *PromptHandler) DeletePrompt(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "delete-prompt",
		Method:      http.MethodDelete,
		Path:        "/prompts/{id}",
		Summary:     "Delete a custom prompt",
		Tags:        []string{tagPrompts},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
		Errors:      []int{400, 403, 404},
	}, func(ctx context.Context, input *DeletePromptInput) (*DeletePromptOutput, error) {
		userID := middleware.GetUserID(ctx)

		var prompt models.Prompt
		err := h.db.NewSelect().
			Model(&prompt).
			Where("id = ?", input.PathID).
			Scan(ctx)
		if err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return nil, huma.Error404NotFound("prompt not found")
			}
			return nil, huma.Error500InternalServerError("failed to fetch prompt")
		}

		// Cannot delete built-in prompts
		if prompt.IsBuiltIn {
			return nil, huma.Error400BadRequest("cannot delete built-in prompts")
		}
		if prompt.WorkspaceID == "" && middleware.GetWorkspaceID(ctx) != "" {
			return nil, huma.Error403Forbidden("you do not have permission to delete this prompt")
		}
		if prompt.WorkspaceID != "" {
			if err := h.checkWorkspaceEditAccess(ctx, prompt.WorkspaceID, userID); err != nil {
				return nil, err
			}
		}

		// Verify ownership
		if prompt.UserID != userID {
			// Check if workspace admin
			if prompt.WorkspaceID != "" {
				allowed, err := workspaceAdminAllowed(ctx, h.db, prompt.WorkspaceID, userID)
				if err != nil || !allowed {
					return nil, huma.Error403Forbidden("you do not have permission to delete this prompt")
				}
			} else {
				return nil, huma.Error403Forbidden("you do not have permission to delete this prompt")
			}
		}

		if _, err := h.db.NewDelete().Model(&prompt).Where("id = ?", input.PathID).Exec(ctx); err != nil {
			return nil, huma.Error500InternalServerError("failed to delete prompt")
		}

		return &DeletePromptOutput{Body: struct {
			Message string `json:"message" doc:"Success message"`
		}{Message: "prompt deleted successfully"}}, nil
	})
}

type GetRandomPromptInput struct {
	WorkspaceID string `query:"workspace_id" doc:"Filter by workspace ID"`
	Category    string `query:"category" doc:"Filter by category"`
}

type GetRandomPromptOutput struct {
	Body *PromptResponse
}

func (h *PromptHandler) GetRandomPrompt(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "get-random-prompt",
		Method:      http.MethodGet,
		Path:        "/prompts/random",
		Summary:     "Get a random writing prompt",
		Tags:        []string{tagPrompts},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
		Errors:      []int{403, 500},
	}, func(ctx context.Context, input *GetRandomPromptInput) (*GetRandomPromptOutput, error) {
		userID := middleware.GetUserID(ctx)

		// Seed built-in prompts on first request
		if err := h.seedBuiltInPrompts(ctx); err != nil {
			return nil, huma.Error500InternalServerError("failed to seed prompts")
		}

		var prompt models.Prompt
		query := h.db.NewSelect().
			Model(&prompt).
			OrderExpr("RANDOM()")

		workspaceID, includePersonal, err := h.promptReadScope(ctx, userID, input.WorkspaceID)
		if err != nil {
			return nil, err
		}
		query = promptReadQuery(query, workspaceID, includePersonal, userID)

		if input.Category != "" {
			query = query.Where("category = ?", input.Category)
		}

		if err := query.Limit(1).Scan(ctx); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return &GetRandomPromptOutput{Body: nil}, nil
			}
			return nil, huma.Error500InternalServerError("failed to fetch prompt")
		}

		return &GetRandomPromptOutput{Body: &PromptResponse{
			ID:          prompt.ID,
			WorkspaceID: prompt.WorkspaceID,
			UserID:      prompt.UserID,
			Text:        prompt.Text,
			Example:     prompt.Example,
			Category:    prompt.Category,
			IsBuiltIn:   prompt.IsBuiltIn,
			CreatedAt:   prompt.CreatedAt.Format(time.RFC3339),
		}}, nil
	})
}

type GetPromptCategoriesOutput struct {
	Body struct {
		Categories []string `json:"categories" doc:"Available prompt categories"`
	}
}

func (h *PromptHandler) GetCategories(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "get-prompt-categories",
		Method:      http.MethodGet,
		Path:        "/prompts/categories",
		Summary:     "Get available prompt categories",
		Tags:        []string{tagPrompts},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
	}, func(ctx context.Context, _ *struct{}) (*GetPromptCategoriesOutput, error) {
		// Seed built-in prompts on first request
		if err := h.seedBuiltInPrompts(ctx); err != nil {
			return nil, huma.Error500InternalServerError("failed to seed prompts")
		}

		var categories []string
		err := h.db.NewSelect().
			Model((*models.Prompt)(nil)).
			ColumnExpr("DISTINCT category AS category").
			Where("is_built_in = ?", true).
			Scan(ctx, &categories)
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to fetch categories")
		}

		return &GetPromptCategoriesOutput{Body: struct {
			Categories []string `json:"categories" doc:"Available prompt categories"`
		}{Categories: categories}}, nil
	})
}
