### Fixed

- Bluesky direct messages now reach the account's own PDS. The bsky.social entryway answers chat requests with "Method Not Implemented", so Bluesky-hosted accounts never collected messages.
- Message collection stops retrying when a provider refuses access (HTTP 403) or does not offer chat for the account (HTTP 501). The account shows a clear status, OpenPost checks again daily, and these refusals no longer add failed job records.
- Grid view on Posts gives post text the full card width instead of one word per line.
- The Posts Failed tab lists only delivery job records; Inbox collection failures stay in Inbox.
- The schedule dialog explains the actual blocker, such as choosing an account, instead of always asking to connect a destination.
- Media details show MP4 containers as `mp4` and link each post that uses the file.

### Changed

- Ideas is a full page. A build keeps running when you leave the page and can be resumed from any screen.
- The sidebar shows the next scheduled posts with their count and time, in one navigation list.
- Inbox pages share one Collection issues control and one search plus Filters row. Features you turned off are no longer counted as issues, and Reviews and Comments have their own empty states.
- Settings navigation has icons and clearer groups. Instance configuration rows stack on narrow panels and keep environment variable notes quiet.
- Billing leads with the current plan and usage; payment actions sit together with a quieter cancel action.
- Notification settings list events first, choose the digest timezone from a list, and keep temporary mutes after the form.
- Account pickers use one Select all checkbox.
