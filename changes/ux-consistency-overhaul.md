### Changed

- Video Editor: clip actions now have one canonical home per surface. The top-bar overflow "Clip" section is gone (Split, delete, and ripple delete stay in the timeline and inspector clip menus), "Add crossfade" is available from the timeline clip context menu, and empty timeline space offers Add track like the toolbar and track menus do.
- Video Editor: double-clicking a timeline marker now opens its details instead of deleting it; delete stays on the explicit button and context menu.
- Video Editor: modified Appearance, Crop, Playback, Anchor, and Corner pin groups are now marked "Modified" instead of the meaningless "Active" when collapsed.
- Video Editor: the phone inspector pane toggle is now labeled "Properties" so it no longer collides with the "Edit" workspace tab.
- Video Editor: the audio EQ, effects, and ducking panels use the editor's shared disclosure and toggle controls, one consistent on/off pill style, and editor theme tokens instead of mixed app-theme styles; the mixer drawer no longer shows a duplicated "Track EQ" header, and fader drags announce their value to screen readers.
- Editors and start pages: the storage destination choice now reads "OpenPost cloud" / "This device" instead of the past-tense status strings; the Recorder keeps the toggle visible and labeled while recording.
- Quick Cut: panels use the shared editor disclosure and scrub controls, the empty state says to open a video (there is no create action), and playback shortcuts plus Escape keep working in repurpose mode.
- Image Editor: the tablet tool rail now behaves like the desktop rail (click activates the remembered variant; menus open on repeat click and arrow keys), the page strip is resizable with a stable reset, and touch targets meet the 44px minimum.
- Composer and workspace copy now use the product terms consistently: "variant" instead of "rendition" or "account versions", and "account" instead of "channel" for connectable destinations.
- Message catalog: trailing "..." normalized to "…", labels no longer end with periods, and the video editor agent error prefix no longer apologizes.
- Mobile: Media tab shows the standard full-page error state on first-load failure, More drill-ins use the native stack header, empty states fall back to a fitting icon, and the media placeholder and drawer scrim follow the theme.

### Fixed

- Image Editor: the Line tool no longer shows a remove (×) glyph, the tablet ellipse marquee no longer shows a pending (clock) glyph, and the desktop "More" menu can no longer open phone-style sheets stacked over the persistent panes.
- Image Editor: "Resize page" and "Rename page" no longer share the same pencil icon.
- Video Editor: the transcript inspector tab no longer scrolls inside its own nested box within the scrolling inspector.
- Recorder: the local-space estimate no longer adds a "plus 20% working headroom" clause on top of a figure that already includes it.
- Composer: the schedule dialog announces failed time parsing to screen readers, the post-publish feedback uses the shared success notice, and the publication link respects base-path deployments.
- Publications: status and analytics delta colors use semantic theme tokens so organization themes render correctly; the failed-load state keeps the page chrome; loading defaults to the localized message everywhere.
- Media library: the active-filter count badge no longer spends the focal action color on a passive chip.
- Docs: the copy button announces "Copied" after copying, and the 404 figure includes screen-reader context; marketing FAQs share one keyboard focus treatment; the image dropzone limit hint derives from the actual limit; the media converter dropzone shows drag feedback.
- Developers: removed 10 duplicate byte-size formatters and consolidated media-duration formatting and editor control-height tokens onto their shared owners.
