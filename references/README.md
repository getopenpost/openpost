# Local References

This directory is for local, gitignored source checkouts used as implementation references.

- `postiz/` is a shallow clone of <https://github.com/gitroomhq/postiz-app>. It is ignored by Git and is useful when comparing social provider OAuth, account-selection, validation, and posting flows.

Refresh the checkout when needed:

```sh
git -C references/postiz pull --ff-only
```
