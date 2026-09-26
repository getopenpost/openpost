### Fixed

- The shared editor toolbar group only claims the `toolbar` landmark role when it is given an accessible name. The two unnamed groups (Quick Cut timeline controls and the keyframe sheet clipboard buttons) previously announced themselves as a bare "toolbar" with no way for screen-reader users to tell them apart from sibling toolbars; they now render as plain containers while their individually labeled buttons are unchanged.
