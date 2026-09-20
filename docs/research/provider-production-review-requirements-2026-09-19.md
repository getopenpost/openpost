# Hosted social-provider production review requirements

Date checked: 2026-09-19

This note maps the scopes OpenPost currently requests to the official production, review, and audit requirements for X, LinkedIn, Facebook, Instagram, Threads, YouTube, TikTok, and Pinterest. It describes provider requirements, not the current approval status of OpenPost's live apps. No app IDs, credentials, or account-specific values are included.

## Executive summary

| Provider                     | Registered company required?                                                                                                      | Public-user gate                                                                                                        | Recording to prepare                                                                                                         |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| X                            | No published requirement                                                                                                          | Approved developer account, configured app, user OAuth, and sufficient pay-per-use credits                              | None documented for the normal self-serve path                                                                               |
| LinkedIn member profiles     | No legal-entity review for the self-service `w_member_social` path, but the developer app must be associated with a LinkedIn Page | Share on LinkedIn and OpenID Connect products                                                                           | None for basic member posting                                                                                                |
| LinkedIn organization Pages  | Yes                                                                                                                               | Community Management Standard tier after Development tier                                                               | Under 5 minutes, high resolution, complete OAuth flow, every requested use case, and test credentials if requested           |
| Facebook, Instagram, Threads | Yes for OpenPost's customer-facing use case                                                                                       | Verified Meta Business, Tech Provider access verification, App Review for Advanced Access, then Live mode               | 1080p+, logged-out through authorization and real use of every requested permission, with a native result                    |
| Google / YouTube OAuth       | No published legal-company requirement                                                                                            | Brand plus sensitive-scope verification; public production app removes the unverified warning and lifetime 100-user cap | Unlisted YouTube video showing English OAuth, app name, client ID in the address bar, and real use of every scope            |
| YouTube uploads              | No published legal-company requirement                                                                                            | Separate YouTube API Services compliance audit to remove forced-private uploads                                         | No fixed public video format, but retain the OAuth demo and a complete upload-to-native-result recording as audit evidence   |
| TikTok                       | No, an owning organization is recommended but not required                                                                        | Production app review plus a separate Content Posting audit for public Direct Post                                      | One to five videos, 50 MB each, showing the current end-to-end integration, every product and scope, and real UI interaction |
| Pinterest                    | No legal entity specified, but a Pinterest business account is required                                                           | Trial approval, then Standard access for production behavior                                                            | Live Pinterest integration plus complete OAuth flow; a terminal/Postman recording is accepted only for a single-user app     |

## One recording pack to make first

Record cleanly at 1440 px wide or less and 1080p or better. Use an English UI, visible cursor, no secrets, and captions instead of narration. Keep the browser address bar visible during OAuth. Create provider-specific cuts from this source material:

1. Start signed out of OpenPost and the provider.
2. Sign in to OpenPost using reviewer credentials that contain no real customer data.
3. Open **Accounts**, choose the provider, and complete the whole provider OAuth flow.
4. Show every requested permission on the provider consent screen.
5. Return to OpenPost and show the connected account or Page selected by the user.
6. Create a minimal text post, image post, video post, or multi-part post as needed to exercise every reviewed publishing permission.
7. Publish it, show OpenPost's inspectable result, then open the native provider result.
8. For read or analytics scopes, open the exact OpenPost screen that consumes the data and show the resulting account content, comments, messages, or analytics.
9. Show disconnect or revocation where a provider asks how users remove access.

Do not use one generic marketing tour. Meta requires evidence per permission, Google requires real use of every requested scope, and LinkedIn requires every claimed Community Management use case.[1][8][10]

TikTok requires every selected product and scope.[4]

## X

OpenPost uses three-legged OAuth 1.0a and its app must have read-and-write permission. X's current self-service documentation requires a developer account, an app name, description and use case, exact callback configuration, generated credentials, and pay-per-use credits. It does not publish a separate company-verification, app-review video, test-user, privacy-policy, or production-review gate for an ordinary posting app.[9][16][17]

**Company:** Not required by the published self-service flow.

**Do now:** Keep the production callback exact, keep the app at read/write, fund credits with a safety margin, and retain a fresh-user OAuth and publication smoke test. There is no review video to submit unless X asks for one directly.

## LinkedIn

### Member profiles

LinkedIn lists Sign in with LinkedIn using OpenID Connect and Share on LinkedIn's `w_member_social` as open, self-service permissions. OpenPost requests `openid profile w_member_social`; when thread replies are enabled it also requests `w_member_social_feed`.[7]

**Company:** A registered legal company is not stated as a requirement for the basic self-service member-posting product. LinkedIn does require a developer app to be associated with a LinkedIn Page. This is not the same as the legal-organization vetting used for Community Management.

**Important OpenPost boundary:** `w_member_social_feed`, organization publishing, organization administration, and organization/member analytics move the app beyond the simple self-service member-posting path. If Hosted only needs personal-profile publishing at first, disabling LinkedIn thread replies keeps the authorization request on the documented open scopes. This is a product/configuration choice, not a substitute for checking the live app's granted products.

### Organization Pages and richer community management

OpenPost's organization mode adds `rw_organization_admin`, `w_organization_social`, `r_organization_social`, `r_member_profileAnalytics`, and `r_member_postAnalytics`. LinkedIn's Community Management API is for registered legal organizations and commercial use cases. Development tier is limited to 500 calls per app per day and 100 calls per member per day, forbids batch reads, disables Social Actions webhooks, and lasts at most 12 months. Standard tier is the live-production tier.[18][19]

**Company:** Required for Community Management. Prepare the legal organization name, registered address, business-domain email, company website, privacy policy, and associated LinkedIn Page. A personal email fails vetting.[19]

**Demo:** A downloadable, high-resolution screencast under five minutes should show the complete OAuth flow and every core LinkedIn-data feature claimed in the request. Provide reviewer test credentials if requested. Show Page selection, creating and publishing a Page post, any comment/reply flow, and the corresponding analytics screens that use the requested scopes.[8][19]

## Meta: Facebook, Instagram, and Threads

OpenPost is a Tech Provider under Meta's definition because it is a service used by other businesses and requests permissions in Meta's access-verification list. That list includes the Facebook Page, Instagram publishing, and Threads permissions OpenPost uses. Tech Provider verification is independent of App Review, and Business Verification is a prerequisite.[12][13]

**Company:** Required for this Hosted use case. Connect the app to a Meta Business, complete Business Verification as a business entity, then complete Tech Provider access verification. A role-only private app is exempt, but that does not cover arbitrary Hosted users.[12][13]

**Shared prerequisites:** Publicly reachable app, app icon, accurate app purpose/category/contact email, privacy-policy URL, app domains, user-data deletion URL or instructions, and any terms URL used by the product. Development mode only authorizes app-role users; Live mode authorizes anyone, but only for approved permissions and features.[26][27]

**App Review mechanics:** Make at least one successful API call with each requested Advanced Access permission during the 30 days before submission. Give each permission its own specific usage explanation and recording. Meta tests with its own accounts, so provide navigation/access instructions and non-Meta OpenPost reviewer credentials where needed, but never personal Meta credentials.[10]

**Recording format:** 1080p or better, English UI or captions, visible cursor, no audio dependency. Start logged out, show the complete OpenPost login and Meta authorization flow, show account/Page selection, then show the feature consuming the permission and the native result. Any permission missing from the recordings will not be approved.[10][11]

### Facebook recording cuts

OpenPost requests `business_management`, `pages_show_list`, `pages_read_engagement`, `pages_read_user_content`, `pages_manage_engagement`, `pages_manage_metadata`, `pages_manage_posts`, and `pages_messaging`.

Prepare cuts that show:

- OAuth and selection of a Page the reviewer controls.
- Page discovery and metadata use.
- Creating a Page post in OpenPost and viewing it on Facebook.
- Reading a Page post/comment and creating the supported reply or moderation action.
- Opening and replying to a Page conversation if `pages_messaging` remains in the request.

Remove permissions for features that are not ready to demonstrate. Meta reviews allowed usage and a real user-facing flow, not future intent.[10]

### Instagram recording cuts

OpenPost currently requests `business_management`, `instagram_basic`, `instagram_content_publish`, `instagram_manage_comments`, `instagram_manage_messages`, `instagram_manage_insights`, `pages_show_list`, `pages_read_engagement`, `pages_read_user_content`, and `pages_manage_metadata`. This Facebook Login path supports professional Instagram accounts linked to Facebook Pages, not consumer Instagram accounts.[15]

Prepare cuts that show:

- Selecting the linked Facebook Page and Instagram professional account.
- Publishing a feed image or Reel and viewing the native result.
- Publishing a Story if that format is claimed, using an eligible business account.
- Reading and replying to a comment.
- Reading and replying to a conversation if message permission remains requested.
- Opening the OpenPost analytics screen backed by Instagram insights.

### Threads recording cuts

OpenPost requests `threads_basic`, `threads_content_publish`, `threads_manage_replies`, `threads_manage_insights`, and `threads_location_tagging`.[14]

Prepare cuts that show:

- Threads OAuth and account connection.
- Publishing text and the media or carousel formats claimed by the app.
- Reply creation or management.
- The insights screen using Threads data.
- Location tagging if that permission remains in the request.

## Google OAuth and YouTube

OpenPost requests profile/email plus `youtube.readonly`, `yt-analytics.readonly`, `youtube.upload`, and the broad `youtube` account-management scope. Public apps using sensitive scopes need verification. Apps that remain unverified show a warning and have a lifetime 100-new-user cap; the cap cannot be reset. Testing status is limited to listed test users and short-lived authorizations.[1][2]

**Company:** Google does not state that a registered company is required. It does require a real public app identity, a homepage and privacy policy on a verified owned domain, accurate support and developer contacts, and verified ownership of domains used by the app and OAuth configuration.[1][2]

**Before submission:** Publish the OAuth app to Production, complete brand verification, declare every scope actually sent by OpenPost, add up to three relevant feature-documentation links, and write a justification for every sensitive scope explaining why a narrower scope is insufficient.[1][2]

**Scope risk:** OpenPost currently requests both narrower scopes and broad `youtube`. Google's policy requires the narrowest necessary scopes. Before recording, inventory the exact live features and endpoints, then remove redundant scopes or give a concrete feature-level reason for each. A demo cannot compensate for an unnecessarily broad scope request.[1][20]

**OAuth demo:** Upload one video to YouTube as Unlisted. Show the full OAuth and consent flow in English, the exact app name, the OAuth client ID visible in the browser address bar, every requested scope on the consent screen, and the OpenPost feature that uses each scope. For the current set, cover account/channel discovery, upload, playlist or other account management, content reading, and analytics.[1][2]

### Separate YouTube upload compliance audit

OAuth verification is not the whole YouTube launch. For API projects created after 2020-07-28, videos uploaded through `videos.insert` are forced to private until the project passes a YouTube API Services compliance audit.[21]

Submit the YouTube API Services Audit and Quota Extension Form for the production project. Describe OpenPost as a user-directed publishing client, list the endpoints and storage behavior, explain consent, revocation and deletion, and include end-user use rather than describing it as an internal tool. The public audit guide does not impose a fixed demo-video format, but keep a short upload proof showing connect, select file, choose privacy, upload, OpenPost status, and the native YouTube result. A quota audit is also required before raising the default quota.[22]

## TikTok

OpenPost requests `user.info.basic`, `user.info.profile`, `user.info.stats`, `video.list`, `video.publish`, and `video.upload`.

**Company:** TikTok recommends app ownership by an organization but says it is not required for ordinary app registration. Its separate business-document verification is mandatory for mini games, mini dramas, and monetization, not documented as a prerequisite for the Content Posting integration used here.[5][23]

**Production app review:** The website must be a real, complete public product, not a login page or thin landing page. Privacy Policy and Terms links must be active and visible without opening a menu. Verify ownership of the web, Terms, Privacy, redirect, and Content Posting media URLs as applicable. Explain every selected product and scope. First-time review evidence must use Sandbox.[4][23]

**Demo:** Upload at least one and at most five videos, each no larger than 50 MB. Show the complete current integration, real OpenPost UI and interaction, full OAuth, and every selected scope. The domain in the recording must match the submitted website. Include account/profile display, video/content listing and stats if those read scopes remain, a Direct Post flow for `video.publish`, and an upload-as-draft flow for `video.upload`.[4]

**Separate Direct Post audit:** App Review alone does not enable normal public posting. Unaudited clients can have only five users post in 24 hours and can create only `SELF_ONLY` content. The Content Posting audit must approve the Direct Post UX and broad public use case before that restriction is lifted. The flow should query and display creator information, expose only provider-allowed privacy/settings, obtain explicit consent, transfer the content, poll status, and show the native result. TikTok rejects internal or private account-management utilities as a public Direct Post use case.[24]

## Pinterest

OpenPost requests `boards:read`, `boards:write`, `pins:read`, `pins:write`, and `user_accounts:read`.

**Company:** Pinterest requires a Pinterest business account, verified email, and acceptance of the Developer Terms. Its published Trial and Standard checklists do not say the owner must be an incorporated legal entity.[6][7]

**Access path:** Register the app and obtain Trial access first. Trial-created Pins and Boards are visible only to their creator as sandbox entities. Upgrade to Standard for production behavior and higher limits.[6][7]

**Demo:** Show the complete Authorization Code OAuth flow for a separate user, the exact registered redirect, Board selection or creation, Pin creation with image or video, the OpenPost success state, and the live Pin on Pinterest. The demo must show live Pinterest integration, not wireframes. Include the public privacy-policy link on a domain clearly associated with the app. Even a single-user integration must record OAuth; Pinterest permits terminal or Postman only for that single-user case, not for OpenPost's multi-user Hosted review.[6][25]

## Recommended submission order

1. **Google/YouTube:** reduce and justify scopes, record the OAuth demo, submit data-access verification, then submit the separate YouTube compliance audit.
2. **Meta:** complete Business Verification and Tech Provider verification, generate recent API calls, then submit Facebook, Instagram, and Threads permissions with permission-specific cuts.
3. **LinkedIn:** keep member-only posting on the open scope if that is the immediate launch, while preparing the legal-organization Community Management Standard application for Pages and analytics.
4. **TikTok:** fix the public use-case framing, submit Production App Review, then the Content Posting audit.
5. **Pinterest:** obtain Trial, run OAuth and publishing end to end, then record and request Standard.
6. **X:** no review packet, but maintain credits and rerun fresh-user OAuth plus publication checks.

## Sources

[1] https://support.google.com/cloud/answer/13464321?hl=en
[2] https://support.google.com/cloud/answer/13461325?hl=en-GB
[4] https://developers.tiktok.com/docs/en/app-review-guidelines
[5] https://developers.tiktok.com/docs/en/verify-your-business
[6] https://developers.pinterest.com/docs/key-concepts/access-tiers
[7] https://developers.pinterest.com/docs/getting-started/connect-app
[8] https://learn.microsoft.com/en-us/linkedin/marketing/community-management-app-review?view=li-lms-2026-06
[9] https://docs.x.com/x-api/lists/manage-lists/quickstart
[10] https://developers.facebook.com/documentation/resp-plat-initiatives/individual-processes/app-review/submission-guide
[11] https://developers.facebook.com/docs/app-review/submission-guide/screen-recordings
[12] https://developers.facebook.com/documentation/development/release/access-verification
[13] https://developers.facebook.com/documentation/development/release/business-verification
[14] https://www.postman.com/meta/threads/documentation/dht3nzz/threads-api
[15] https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api
[16] https://docs.x.com/fundamentals/developer-portal
[17] https://docs.x.com/fundamentals/developer-apps
[18] https://learn.microsoft.com/en-us/linkedin/marketing/increasing-access?view=li-lms-2026-03
[19] https://learn.microsoft.com/en-us/linkedin/marketing/community-management/community-management-api-migration-guide?view=li-lms-2026-09
[20] https://developers.google.com/youtube/v3/guides/auth/server-side-web-apps
[21] https://developers.google.com/youtube/v3/docs/videos/insert
[22] https://developers.google.com/youtube/v3/guides/quota_and_compliance_audits
[23] https://developers.tiktok.com/docs/en/getting-started-create-an-app
[24] https://developers.tiktok.com/docs/en/content-sharing-guidelines
[25] https://developers.pinterest.com/docs/getting-started/set-up-authentication-and-authorization
[26] https://developers.facebook.com/documentation/development/build-and-test/app-modes
[27] https://developers.facebook.com/documentation/development/create-an-app/app-dashboard/basic-settings.md
