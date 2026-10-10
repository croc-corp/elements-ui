# Releasing

Elements is released from `main` and deployed from `production`. Only tagged releases that passed CI reach
the site, and every release can be rolled back from the Actions tab.

```
pull request ──▶ main ──▶ CI green on a version bump ──▶ tag vX.Y.Z + GitHub release ──▶ production ──▶ deploy
```

| Branch | Role | Who updates it |
| --- | --- | --- |
| `main` | Integration. Every change arrives through a pull request with green CI. | Maintainers, by merging pull requests |
| `production` | What the site runs. The deployment builds it with `docker-compose.yml`. | Only the Release and Deploy workflows |

## Versions

Elements follows [Semantic Versioning](https://semver.org). The public API is what users install and call:
registry item names, component props, attributes, events and methods, the `--lumesec*` and `--ui-*` tokens and
the CDN module URLs. While the version is 0.x, a minor release may change that API; such changes are listed
under **Breaking** in the changelog. A patch release contains fixes only.

The version lives in one place, `package.json`. The site reads it from there.

## Changelog

`content/docs/changelog.mdx` is the changelog, shown on the site at `/docs/changelog`. A pull request with a
change users can notice adds a line under `## Unreleased` at the top (create the heading if it is missing).
Write it for the people who install the components: what changed for them, not how it was done.

## Release

1. Open a pull request named "Release X.Y.Z" that:
   - renames `## Unreleased` to `## X.Y.Z · YYYY-MM-DD` and adds a one-line summary below it;
   - sets `"version": "X.Y.Z"` in `package.json`;
   - sets `updated` in the changelog front matter to the same date.

   `pnpm release:notes X.Y.Z` prints the notes the release will get, and fails when the section is missing.
2. Merge it. CI runs on `main`.
3. When CI passes on that commit, the **Release** workflow (`.github/workflows/release.yml`):
   - tags the commit `vX.Y.Z` and publishes a GitHub release with the changelog section as notes;
   - moves `production` to the commit (fast-forward only).

   If the `production` environment requires a reviewer, the workflow waits for an approval first.
4. The deployment notices the new commit on `production`, builds it with `docker-compose.yml` and replaces the
   running container once the healthcheck (`/api/health`) passes.

A commit on `main` that does not change the version is not released. Merging more pull requests before the
release pull request is fine; they ship with the next release.

## Roll back or re-deploy

Run **Deploy a release** (`.github/workflows/deploy.yml`) from the Actions tab with the tag to deploy, for
example `v0.4.0`. It moves `production` to that release. The next release fast-forwards it again.

To fix something in production, fix it on `main` and release a patch version. Nothing is committed to
`production` directly.

## One-time setup

Repository settings:

- **Environment `production`** (Settings → Environments): limit it to the `main` branch, optionally add required
  reviewers so that every release and rollback needs an approval, and add the secret `RELEASE_TOKEN`.
- **`RELEASE_TOKEN`:** a fine-grained personal access token (or a GitHub App token) for this repository only,
  with the permissions Contents (read and write) and Workflows (read and write). The workflows use it to tag,
  publish and move `production`, because the built-in `GITHUB_TOKEN` may not push commits that add or change
  files in `.github/workflows`. Renew it before it expires; a release fails with a clear message when it is
  missing.
- **Ruleset for `main`:** require a pull request and the status checks "Verify and build" and "Docker image",
  require the branch to be up to date, block force pushes and deletion. Require approvals from code owners once
  there are at least two maintainers; GitHub does not let you approve your own pull request.
- **Ruleset for `production`:** block deletion and restrict updates, with the token's owner (or the app) on the
  bypass list, so that only the Release and Deploy workflows can move it.

Deployment, for example a Docker Compose application in your hosting platform:

- Source: this repository, branch `production`, compose file `docker-compose.yml`, deploy on push.
- Variables: `NEXT_PUBLIC_SITE_URL` (required, also used at build time), and optionally `DATABASE_URL`,
  `DATABASE_POOL_MAX` and `TRUSTED_PROXIES` (see `.env.example`). `BIND_ADDRESS` and `HOST_PORT` choose where
  the container port is published; keep it reachable only from your reverse proxy.
- A reverse proxy with TLS in front, which passes `X-Forwarded-For` on.
