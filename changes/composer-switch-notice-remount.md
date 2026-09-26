### Fixed

- Restored the composer's "Workspace changed" confirmation after discard-and-switch: the notice now survives the app-shell reload that workspace switches trigger, so scheduling/attachment resets are announced instead of silently dropped.
- Re-enabled the skipped `an in-flight autosave cannot attach an old-workspace draft after switching` E2E, which proves the notice appears, the late first-workspace save never attaches to the URL, and follow-up typing saves into the new workspace.
