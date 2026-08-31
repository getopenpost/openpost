# Free tools worth adding to OpenPost

Date: 2026-08-30

## Decision

Add a UTM link builder. If there is room for one more tool, add an engagement rate calculator that shows its formula.

Stop there. OpenPost already has eight useful tools. A long list of near-identical AI caption, hashtag, and username generators would make the page larger without making it better.

## What other products offer

| Product       | Current free-tool pattern                                                                                                                                                                                                                                                                                | Useful lesson for OpenPost                                                                                                                                      |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Buffer        | Its public UTM builder takes a destination URL, campaign name, medium, source, content, term, and campaign ID, then produces a trackable link. Buffer also points visitors to a hashtag generator, scheduler, and link-in-bio product. [Buffer UTM builder](https://buffer.com/free-tools/utm-generator) | A small tool can solve one real job, work before signup, and lead naturally into scheduling.                                                                    |
| SocialBee     | Its free-tools page includes a UTM builder, grid planner, engagement calculators, character counter, post mockups, and image resizers alongside many AI generators. [SocialBee free tools](https://socialbee.com/free-tools/)                                                                            | UTM building and engagement math fill gaps in OpenPost. Most of the other tools overlap its current editors, preview, formatter, and counter.                   |
| Hootsuite     | Its catalog groups caption and hashtag generators with listening tools, engagement calculators, a character counter, and several calculators. [Hootsuite free tools](https://www.hootsuite.com/social-media-tools)                                                                                       | A broad catalog can attract many searches, but much of it is one generator repeated for each network. OpenPost should keep one cross-network tool for each job. |
| Sprout Social | Its public set is small: a social ROI calculator, an image resizer, and downloadable image templates. [Sprout Social free tools](https://sproutsocial.com/free-tools/)                                                                                                                                   | A short set can still be credible. OpenPost already has a deeper image editor, so a second image resizer would add little.                                      |
| Metricool     | Its public mini-tools page lists TikTok and Instagram hashtag generators plus an Instagram mini-tool. [Metricool free tools](https://metricool.com/free-social-media-tools/)                                                                                                                             | More tools are not required. A focused page can point into the main product without pretending to cover every search term.                                      |
| Vista Social  | Its catalog has more than 30 tools, mostly separate caption, hashtag, and username generators for each network. It also includes QR codes, a similarity checker, and a brand voice generator. [Vista Social free tools](https://vistasocial.com/social-media-tools/)                                     | This is an SEO catalog more than a set of distinct jobs. Copying it would weaken OpenPost's simpler cross-network story.                                        |
| Publer        | Its free account includes a photo editor, post previews, preset schedules, link shortening, and UTM tags. [Publer free plan](https://publer.com/help/en/article/what-is-included-in-publer-free-dliovh/)                                                                                                 | UTM tags belong close to social publishing. OpenPost can prove that value with a public builder, then carry the same link into a draft later.                   |

## The current OpenPost set

OpenPost already lists a video editor, image editor, multi-platform character counter, post preview, thread splitter, Fediverse handle checker, LinkedIn formatter, and timezone posting planner in [`_marketing.ts`](../../marketing-site/src/routes/_marketing.ts).

That set already covers most of the common competitor ideas:

- A standalone image resizer, collage maker, or crop tool would sit inside the image editor's job.
- Network-specific character counters and post mockups would repeat the cross-network counter and preview.
- A LinkedIn line breaker would be a narrower copy of the LinkedIn formatter.
- Another generic posting-time tool would repeat the timezone planner. A true "best time" result needs a connected account's own history.

The real gaps are link tracking before a post goes live and simple performance math after it goes live.

## Recommendation 1: UTM link builder

Ship this first. Buffer and SocialBee both offer a public UTM builder, and Publer includes UTM tags in its free publishing flow. The job is common, easy to explain, and useful for a founder sharing a launch link across several networks. [Buffer UTM builder](https://buffer.com/free-tools/utm-generator), [SocialBee UTM builder](https://socialbee.com/free-tools/utm-link-generator/), [Publer free plan](https://publer.com/help/en/article/what-is-included-in-publer-free-dliovh/)

The first version should:

- ask for the destination URL, source, medium, and campaign name;
- keep content and term optional;
- preserve existing query parameters and the URL fragment;
- update the finished link as the user types;
- copy the result with one click;
- offer plain presets such as Instagram, LinkedIn, and newsletter without hiding the final values;
- run in the browser without signup, storage, analytics requests, or an AI service.

The useful product handoff is "Use this link in a post," not a generic signup wall.

## Recommendation 2: Engagement rate calculator

Add this only after the UTM builder is polished. Hootsuite and SocialBee both offer a general engagement calculator, and SocialBee also repeats it for individual networks. [Hootsuite engagement rate calculator](https://www.hootsuite.com/social-media-tools/engagement-rate-calculator), [SocialBee free tools](https://socialbee.com/free-tools/)

OpenPost should make the math more honest than a single unexplained score:

- let the user choose followers, reach, impressions, or views as the denominator;
- accept likes, comments, shares, saves, and clicks;
- show the exact formula beside the result;
- support one post or a set of posts;
- avoid "good" and "bad" labels or stale industry benchmarks;
- keep every value in the browser.

Hootsuite itself notes that engagement rate can use followers, reach, or impressions and that several formulas exist. Showing the choice is a feature, not extra detail. [Hootsuite engagement rate calculator](https://www.hootsuite.com/social-media-tools/engagement-rate-calculator)

The natural next step is to show that OpenPost can collect the same data automatically once the user connects an account.

## Ideas to skip

- **AI caption, hashtag, and username generators.** Hootsuite, SocialBee, Metricool, and Vista Social already crowd this search space. Good hashtag advice needs current network data. Good writing needs a model or service call. Neither is a strong local browser tool, and OpenPost already has writing help in the product.
- **Image resizer or post mockup.** Sprout Social and SocialBee prove demand, but OpenPost's image editor and post preview already cover those jobs. A simpler entry path into the existing tools is better than another page with the same result.
- **Social ROI calculator.** Sprout Social and Hootsuite offer one, but the result depends on revenue attribution, labor cost, ad spend, and a chosen value for non-purchase actions. A short public form would produce false precision.
- **Link-in-bio builder.** This is a hosted product with saved pages, abuse controls, analytics, and ongoing ownership. It is not a small browser utility.
- **Trend tracker or social listening search.** These require current external data and provider access. They cannot meet the local-only bar.
- **Instagram grid planner.** It is useful, but it is limited to one network and sits close to OpenPost's post preview. Revisit it only if usage shows people want to plan several feed posts together.

## Suggested order

1. Launch the UTM link builder and link its result into post creation.
2. Measure use and draft handoffs.
3. Add the engagement calculator only if the tools page needs another distinct job.

Ten clear tools are enough. The page should help someone finish work, not advertise the size of the list.
