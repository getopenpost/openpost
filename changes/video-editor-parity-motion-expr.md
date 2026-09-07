# Video editor expression catalog and spring preview math (motion-expr)

- The expression dock now offers FreeCut's per-property preset catalog
  (~50 Adjust/Motion/Timing presets) with a full syntax guide, inserted at the
  cursor into the expression draft.
- `prop()` and direct links accept shape stroke props (trim start/end/offset,
  taper widths/lengths) with the same render defaults as the shape pipeline;
  results apply to the item fields, not the transform.
- Spring easing preview timing is ported from FreeCut's settling math
  (mass 0.3 / friction 18 → ~153ms) with the mirror ping-pong return leg for
  future timed previews; the graph preview itself stays duration-independent.
