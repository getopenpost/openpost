---
name: openpost-seo
description: Audit OpenPost marketing and documentation SEO with the pinned claude-seo toolkit. Use for site audits, search discovery, structured data, sitemaps, or agent access checks.
---

# OpenPost SEO audit

Run the [claude-seo](https://github.com/AgriciDaniel/claude-seo) scripts directly from Codex. Its Claude Code slash commands and agents are reference material for choosing checks, not part of this workflow.

## Toolkit

- Use the shallow, Git-ignored checkout at `docs/references/claude-seo`, pinned to tag `v2.4.0` (`e77e783e38eeb738424eb72117abbd2dacdd88af`). Clone that tag there if the checkout is absent. Review upstream changes before updating the pin.
- Read `skills/seo/SKILL.md` and only the relevant leaf skill in that checkout for the requested audit. Execute bundled Python scripts through `scripts/claude-seo run <script.py>`, not a bare interpreter.
- Set `CLAUDE_SEO_PYTHON` to a Python 3.10+ executable and `CLAUDE_SEO_DATA_DIR` to a dedicated user-data directory outside the repository. Run `scripts/claude-seo doctor --json` first. If it is not ready, run `scripts/claude-seo setup` only when the user requested setup or dependency repair, then confirm the doctor reports `ready: true`. The checkout's `install.sh` installs Claude Code skills globally and is unnecessary here.

## OpenPost audit

1. Identify the live target and the local Git revision. A local route absent from production may await release. Keep that distinction in every finding.
2. Check the live marketing and documentation sitemaps with `sitemap_discovery.py`. Use `parse_html.py` for titles, descriptions, headings, canonicals, social metadata, and JSON-LD. Use `agentic_check.py` for robots, no-JavaScript content, Markdown alternates, and agent access. The upstream DNS-pinned fetcher is single-threaded; run its requests serially.
3. Verify each reported issue against the live page and its source owner. Marketing metadata and routes come from `packages/social-images/src/index.js`, structured data from `apps/marketing/src/routes/_structured-data.ts`, sitemaps from `apps/marketing/src/routes/sitemap.xml/` and `apps/docs/app/sitemap.ts`, and agent-readable output from `scripts/generate-agent-surfaces.mjs`. Treat informational and not-applicable checks as such. A tool score alone does not prove search visibility or a defect.
4. Report concrete evidence, affected URLs, source revision or deployment state, and the next action. For code changes, follow `AGENTS.md` checks for the affected surface. Keep point-in-time audit output outside tracked source files.

PageSpeed Insights may require credentials or hit a rate limit. Report the missing measurement and use another available source when performance is in scope; do not infer Core Web Vitals from HTML alone.

Google treats `https://openpo.st` and `https://openpo.st/` as the same root URL. Normalize that pair when comparing sitemap and canonical values; see [Google's trailing-slash guidance](https://developers.google.com/search/blog/2010/04/to-slash-or-not-to-slash).
