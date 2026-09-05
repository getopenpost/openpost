# Fourteen-Day Activation and Guardrail Plan

> **Product-usage measurement template — no automatic launch metrics are implied.** OpenPost's social-provider Analytics page measures connected accounts and publications; it does not include a product-usage analytics vendor or automatic launch KPI dashboard. Assign a human owner and a reproducible evidence source for every value.

## Window and definitions

- Launch starts: `[TIMESTAMP AND TIMEZONE]`
- Measurement window ends: `[14 DAYS LATER]`
- Owner: `[NAME]`
- Evidence location: `[LINK]`
- Test/internal accounts excluded by: `[RULE]`
- Duplicate users/workspaces handled by: `[RULE]`

Write the definitions before collecting results. For example, define a qualified registration, connected destination, destination-specific campaign, successful schedule, and successful publish in terms that can be checked from current OpenPost records.

## Primary activation targets

These are suggested starting targets from the launch plan, not actual results.

| Metric | Suggested 14-day target | Actual | Definition | Manual evidence source | Owner | Updated at |
| --- | ---: | ---: | --- | --- | --- | --- |
| Qualified registrations | 100 | _Pending_ | `[DEFINE]` | `[SOURCE OR QUERY]` |  |  |
| Users who connect at least two destinations | 30 | _Pending_ | `[DEFINE]` | `[SOURCE OR QUERY]` |  |  |
| Users who create a destination-specific campaign | 20 | _Pending_ | `[DEFINE]` | `[SOURCE OR QUERY]` |  |  |
| Users who successfully schedule or publish | 15 | _Pending_ | `[DEFINE]` | `[SOURCE OR QUERY]` |  |  |
| New paying customers | 5 | _Pending_ | `[DEFINE]` | `[SOURCE OR QUERY]` |  |  |

## Secondary targets

| Metric | Suggested 14-day target | Actual | Manual evidence source | Owner |
| --- | ---: | ---: | --- | --- |
| GitHub stars | 150–300 | _Pending_ | GitHub repository snapshot at window boundaries |  |
| Useful GitHub issues or discussions | 10 | _Pending_ | Manually reviewed issue/discussion list |  |
| Community or tutorial mentions | 3 | _Pending_ | Direct links with author/date |  |
| Attributed customer quotes with permission | 5 | _Pending_ | Approved pilot evidence records |  |

Stars and mentions are secondary. Do not substitute them for connected accounts, destination-specific campaigns, or successful schedules.

## Guardrails

| Guardrail | Actual | Denominator and definition | Manual evidence source | Owner | Response threshold |
| --- | ---: | --- | --- | --- | --- |
| OAuth connection failure rate by provider | _Pending_ | `[DEFINE]` | Provider readiness/errors and support log |  | `[DEFINE]` |
| First-publication failure rate by provider | _Pending_ | `[DEFINE]` | Publication lifecycle events |  | `[DEFINE]` |
| Support requests per activated user | _Pending_ | `[DEFINE]` | Manually classified support log |  | `[DEFINE]` |
| Time from registration to first scheduled post | _Pending_ | `[DEFINE]` | Registration and schedule timestamps |  | `[DEFINE]` |
| Scheduled posts without a final state | _Pending_ | `[DEFINE]` | Queue and lifecycle review |  | `[DEFINE]` |
| Server latency and queue backlog | _Pending_ | `[DEFINE]` | Operator health/log snapshot |  | `[DEFINE]` |
| Refunds or immediate cancellations | _Pending_ | `[DEFINE]` | Paddle/operator billing review |  | `[DEFINE]` |

Do not claim a rate when the denominator is missing. Keep provider-specific values separate; an aggregate can hide one broken OAuth or publishing path.

## Daily manual review

- [ ] Record new registrations and exclude test/internal accounts.
- [ ] Count users who connected two destinations.
- [ ] Count campaigns with at least one distinct destination rendition.
- [ ] Check schedules and publications that reached a final state.
- [ ] Review OAuth and first-publication failures by provider.
- [ ] Review queue backlog and jobs without a final state.
- [ ] Classify support requests and billing cancellations.
- [ ] Save evidence links and update the timestamp.

## Interpretation

- Reach without connected accounts suggests a trust or onboarding problem.
- Connected accounts without a schedule suggest product value, provider friction, or workflow complexity.
- A first schedule without a return visit suggests a retention problem.
- High failure on one provider should narrow the public claim, not be hidden inside an aggregate.
- Missing evidence means unknown, not zero and not success.

At day fourteen, transfer verified outcomes and failures into [`results-template.md`](./results-template.md).
