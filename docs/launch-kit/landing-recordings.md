# Landing page recordings

The landing page works with the existing tour and screenshots. These recordings can replace them without changing the story or layout.

| Slot | Record | Length and frame |
| --- | --- | --- |
| Product tour | Start a publication from an idea, choose three destinations, adjust one version, and schedule it. End on the calendar. | 30–45 seconds, 16:9 |
| Image Editor | Start with a photo, add a headline, make a carousel page, and export to Media. | 10–15 seconds, 16:10 |
| Video Editor | Import a short clip, trim it, add a caption, and export. | 10–15 seconds, 16:10 |

Use a demo workspace with no personal data. Keep the cursor visible and pause briefly after each action. Record at 1440px wide or larger, in Workshop light or dark. Keep essential controls inside the left 85% of editor footage; the desktop compositions crop the right edge.

The tour currently links to `demoVideoUrl` in `apps/marketing/src/routes/_marketing.ts`. Editor stills live in the maintained screenshot assets and are rendered by `apps/marketing/src/routes/+page.svelte`. Add new recordings through the asset manifest before referencing them. Use a poster and playback controls; any optional looping preview must stop under reduced motion and include an accessible pause control. Provide captions for spoken audio.
