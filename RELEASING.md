# Releasing fixwire

Releases are automated: publishing a **GitHub Release** triggers the
[`release` workflow](./.github/workflows/release.yml), which builds, tests, and
runs `npm publish --provenance --access public`.

## One-time setup

1. Create an npm **automation** access token (npmjs.com → Access Tokens →
   Generate New Token → _Automation_).
2. Add it as a repository secret named `NPM_TOKEN`
   (Settings → Secrets and variables → Actions → New repository secret).

That's it — provenance uses GitHub OIDC (the `id-token: write` permission in the
workflow), so no extra signing keys are needed.

## Cutting a release

1. Make sure `main` is green in CI.
2. Move the `Unreleased` entries in [`CHANGELOG.md`](./CHANGELOG.md) under a new
   version heading with today's date, and update the compare links at the bottom.
3. Bump the version and create the tag:

   ```bash
   npm version patch   # or minor / major — follows semver
   git push --follow-tags
   ```

4. On GitHub, draft a **New Release** from the tag you just pushed, paste the
   changelog section as the notes, and **Publish**.
5. The `release` workflow publishes to npm. Confirm at
   https://www.npmjs.com/package/fixwire.

## Versioning policy

Pre-1.0, minor versions (`0.x.0`) may contain breaking changes; patch versions
(`0.0.x`) are backwards compatible. After 1.0 we follow strict
[SemVer](https://semver.org/).

## Manual fallback

If the workflow is unavailable you can publish locally (requires npm 2FA /
publish rights):

```bash
npm ci
npm test
npm run build
npm publish --access public
```
