### Fixed

- A provider acceptance without a native post id or a reference to reconcile with no longer reports published. It stays pending with reconcile-only safety so it reconciles instead of retrying. Acceptances carrying a reconciliation reference (for example Instagram container flows) are unchanged.
