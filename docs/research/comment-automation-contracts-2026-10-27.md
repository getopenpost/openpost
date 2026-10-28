# Instagram comment automation contracts

Checked 2026-10-27. Research only. Implementation details below are supplied by the parent, not a code audit or live API verification.

## Meta contract and required corrections

**Direct Instagram Login is supported by the current request shape. Facebook Login needs an explicit integration-path decision because Meta's two official guides disagree.** Do not silently treat every `graph.facebook.com` connection as the same contract.

| Connection / official guide                    | Private-reply endpoint                                                            | Token and permissions listed by that guide                                                                                                                                                    |
| ---------------------------------------------- | --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Instagram Login, Instagram Platform guide [M1] | `POST https://graph.instagram.com/{version}/{igAccountID}/messages`               | Instagram User token; `instagram_business_basic`, `instagram_business_manage_comments`                                                                                                        |
| Facebook Login, Instagram Platform guide [M1]  | `POST https://graph.facebook.com/{version}/{igAccountID}/messages`                | Facebook Page token; `instagram_basic`, `instagram_manage_comments`, `pages_read_engagement`; additionally `ads_management` and `ads_read` for the Business Manager role case described there |
| Facebook Login, Messenger Instagram guide [M2] | `POST https://graph.facebook.com/{PAGE_ID}/messages` (guide sample omits version) | Linked Page token from a person with the Page's `MESSAGING` task; `instagram_manage_comments` **and `pages_messaging`**; also lists Human Agent feature and Advanced Access                   |

The page-ID requirement in [M2] is explicitly for **Instagram commenters**, not a Facebook-comment example. [M1], last updated June 30, 2026, and [M2], July 2, 2026, remain inconsistent. Consequently, the supplied Facebook branch is supported by [M1] but does **not** implement [M2]'s documented endpoint or permission contract. Confirm the app's actual onboarding/product path before claiming compatibility or replacing its endpoint. For the Messenger/Page integration, use the linked Page ID and check `pages_messaging`; an Instagram account ID and comment permission alone do not satisfy that guide. No live send was attempted.

[M1] also has a separate **Unified Login** column: Business Integration System User token, `graph.facebook.com`, `instagram_basic`, `instagram_manage_comments`, and explicitly `instagram_manage_messages` for private replies. Do not apply that column's extra messaging permission to direct Instagram Login or mistake Unified Login for Facebook Login.

Both private-reply guides address the comment using `recipient.comment_id`, with `message.text`. [M1] explicitly demonstrates JSON and `Authorization: Bearer`; [M2] demonstrates a Page token as `access_token`. The supplied bearer shape matches [M1]. Do not replace the comment ID with the commenter's user ID: ordinary messaging addresses `recipient.id` and has different eligibility. [M1, M2, M3]

Both guides allow one private reply associated with the comment, within seven days **of comment creation**, rather than post publication or automation activation. Instagram Live is eligible only while broadcasting. Further messages require the recipient to respond; the private-reply guides then specify 24 hours from that response. Sending the initial private reply does not itself authorize a continuing sequence. Apply these restrictions at dispatch as well as trigger admission, including after review or queue delay. [M1, M2]

The supplied **1,000-byte** text cap is supported: both ordinary messaging references explicitly specify UTF-8 bytes. Retain byte counting after rendering variables; emoji and non-ASCII characters consume multiple bytes. The Messenger reference also has a less precise character-count bullet, but its text section explicitly uses bytes. [M3, M4]

Comment permissions are not a universal authorization for normal DMs. Direct Instagram Login ordinary messaging requires `instagram_business_basic` and `instagram_business_manage_messages`, with the person initiating the conversation. The current general messaging reference describes a usual 24-hour window and a separate Click-to-Direct-ad exception; that exception must not extend a comment private reply's specific window. Inbox takeover is routing, not permission to bypass provider eligibility. [M1, M3]

Operational implications derived from these rules: durably reserve the private response by account/comment across rules and webhook duplicates; keep delivered message IDs; do not blindly repeat a send with an uncertain delivery outcome. Meta explicitly notes duplicate boosted/ad-comment webhooks. A product daily run cap is independent of Meta limits. [M2]

## Product patterns, not proof of Meta rules

**ManyChat:** its official Post/Reel trigger offers specific content, all content, or the next publication; include/exclude keywords or any comment; and rotating public reply variants. Its first private-message node uses an explicit private-reply mode, one content block, and restricted continuation controls. Actions, conditions, delays, and randomizers are additional building blocks. Its documented overlapping-trigger behavior is creation-order based for broad rules. The help page claims first-comment-per-person/post behavior; that claim is not established by the Meta guides checked here, so do not label it a verified Meta restriction. [C1]

**Chatfuel:** current Help Center rules can target selected posts/Reels or ads and exact/contains/any-comment matching. Public and private responses are independently controlled. It documents one winning rule: content-specific before general before base, then exact before contains before any. This differs from an older SDK blog's claim that overlapping rules have unspecified precedence; prefer the current Help Center description. [C2]

For saved-message/campaign patterns, distinguish the documented products: Chatfuel SDK Inbox has per-operator saved replies, while Broadcasts campaigns use **approved WhatsApp templates**, audience filters/counts, previews, scheduling, duplication, and visible delivery states. I did not verify a distinct Instagram feature named “saved-message campaigns.” These pages do not prove Instagram permits outbound campaigns or follow-up sequences. [C3, C4]

## Recommendations beyond the parent's implemented scope

The parent reports incoming comments, selected/all published/scheduled/imported scopes, include/exclude exact/word/contains matching, daily limits, priority, separate public/private/handoff nodes, and Inbox review/takeover. These were not re-audited here.

- Prioritize connection-path readiness and the dispatch-time seven-day/one-message checks above. Scheduled/imported scopes are OpenPost selection choices; a scheduled item still needs a published provider object and an actual eligible comment.
- Keep the current no-continuing-DM-sequences boundary. Show a pending-response state after the single private reply; manual takeover must retain provider eligibility checks.
- Future options: “next published post,” reusable reply text with a rendered preview, public-response variants, and a sample-comment rule evaluator explaining the winning priority and exclusions. These are product choices, not Meta requirements.
- Preserve independent public/private outcomes. Only announce that a DM was sent after confirmed success; expose failed or uncertain delivery and review-expired comments in Inbox.

## Sources

Meta developer pages returned HTTP 429 through the web reader. Direct anonymous HTTP GETs with a browser User-Agent succeeded; their embedded documentation and official `.md` representations supplied the contracts above. Postman was inspected as a fallback but its collection-level permission list is not evidence of private-reply-specific requirements.

- **M1:** [Meta, Send a Private Reply to a Commenter](https://developers.facebook.com/documentation/instagram-platform/private-replies), [official Markdown](https://developers.facebook.com/documentation/instagram-platform/private-replies.md).
- **M2:** [Meta, Private replies, Instagram Messaging](https://developers.facebook.com/docs/messenger-platform/instagram/features/private-replies/), [official Markdown](https://developers.facebook.com/documentation/business-messaging/instagram-messaging/features/private-replies.md).
- **M3:** [Meta, Instagram Login Messaging API](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/messaging-api.md).
- **M4:** [Meta, Instagram Messaging Send Message](https://developers.facebook.com/documentation/business-messaging/instagram-messaging/features/send-message.md).
- **M5:** [Meta official Postman collection](https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api?entity=request-23987686-3fe78620-2258-44b6-893f-42d76c7200d7).
- **C1:** [ManyChat Help, Instagram Post and Reel Comments trigger](https://help.manychat.com/hc/en-us/articles/14281316989724-Instagram-Post-and-Reel-Comments-trigger).
- **C2:** [Chatfuel Help, Instagram Comment Autoreply](https://chatfuel.com/docs/instagram/instagram-comment-autoreply).
- **C3:** [Chatfuel SDK, Inbox documentation](https://sdk.chatfuel.com/docs/modules/inbox).
- **C4:** [Chatfuel SDK, Broadcasts](https://sdk.chatfuel.com/modules/broadcasts).
