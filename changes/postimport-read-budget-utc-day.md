### Fixed

- Reset the post-import read budget at the start of the UTC day, when an account whose budget ran out is retried. The budget rolled over 24 hours after its first read instead, so it was still spent at that midnight retry and the import waited another full day.
