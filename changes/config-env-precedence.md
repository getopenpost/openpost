### Fixed

- Keep cloud credentials under deployment control, fail closed on invalid secret files, and let administrators remove inactive legacy credentials without exposing them. Migration now validates only the database settings it needs, so stored non-secret runtime settings do not block hosted rollouts.
