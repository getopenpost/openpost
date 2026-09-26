# Keyframe graph phantom sliders

## Fixed

- The Video Editor keyframe graph's bezier easing handles and playhead scrub line
  no longer claim the keyboard-operable `slider` role. They are pointer-only
  affordances (`tabindex="-1"`, no keyboard handler) that keyboard users could
  never reach or adjust, so screen readers announced phantom sliders. They now
  expose `role="img"` with their existing labels. Easing stays
  keyboard-adjustable through the focusable segment easing buttons and preset
  menu, and playhead position stays available through the timeline ruler and
  mini-timeline sliders.
