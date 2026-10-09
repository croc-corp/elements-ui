---
name: release
description: Prepare a LumeSec Elements release pull request - choose the version, turn the Unreleased changelog section into a dated release section and bump package.json. Use when a maintainer asks to prepare, cut or plan a release. Never tag, never push to production.
---

# Prepare a release

Releases are made by the Release workflow after a release pull request is merged; see `RELEASING.md`. This
skill only prepares that pull request. Do not create tags, GitHub releases or commits on `production`.

1. Read `## Unreleased` at the top of `content/docs/changelog.mdx` and the commits since the last tag
   (`git log $(git describe --tags --abbrev=0)..HEAD --oneline`). Make sure every change users can notice is in
   the section; add missing lines in the changelog's voice (what changed for people who install the
   components).
2. Choose the version from the current one in `package.json` (Semantic Versioning; while 0.x, a minor release
   may break the public API, a patch release only fixes). Anything that changes registry item names, props,
   attributes, events, methods, tokens or CDN URLs is listed under **Breaking**.
3. Edit:
   - `content/docs/changelog.mdx`: rename `## Unreleased` to `## X.Y.Z · YYYY-MM-DD` (today) and add a one-line
     summary below it; set `updated` in the front matter to the same date.
   - `package.json`: `"version": "X.Y.Z"`.
4. Check:

   ```bash
   pnpm release:notes X.Y.Z
   pnpm format:check
   pnpm lint
   pnpm test
   pnpm verify
   ```

5. Commit as `Release X.Y.Z` on a branch and open a pull request with the same title and the release notes as
   the description. After it is merged and CI passes, the Release workflow tags `vX.Y.Z`, publishes the GitHub
   release and deploys it.
