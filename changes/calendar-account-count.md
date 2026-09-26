### Fixed

- Month-grid publication buttons now include the destination account count in their accessible name (for example "Launch week post · 2 accounts") instead of only the post title. The avatar stack inside the button is decorative and hidden from assistive technology.
- Day-drawer publication rows now expose the account count as screen-reader text instead of an `aria-label` on a role-less span, which assistive technology silently ignored.
