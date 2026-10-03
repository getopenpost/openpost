# Braces security patch

`braces@3.0.3.patch` applies the five production file changes from upstream
[PR72](https://github.com/micromatch/braces/pull/72), commit
`28d440b5dd449dbf1fe6f3506cf94ecca4d02660`. The upstream package remains MIT
licensed; its installed license and attribution are unchanged.

[CVE-2026-93687](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) has no
published fixed version. The patch caps parser nesting and recursive public
AST walkers at 100, also bounding parent-chain cycles during expansion. Root
and mobile installs apply the same patch file. Ordinary alternatives, ranges,
and escaped syntax keep their existing implementation.

The audit admits only this advisory after checking every installed Braces
artifact against the reviewed index/lib SHA-256 hashes. Missing, unpatched,
or changed copies fail before the version-based audit. Other advisories remain
subject to its existing policy. Remove the patch, hashes, admission and related
regressions when a fixed upstream release replaces them.
