# Website deployment

GitHub Pages must use **GitHub Actions** as its publishing source. Branch-based
publishing from `main` bypasses the quality workflow and must remain disabled.
The `github-pages` environment must allow deployments from `main` only.

For the one-time migration, after the pull request checks pass and before merging
to `main`, a repository administrator can change Settings > Pages > Build and
deployment > Source to GitHub Actions. The equivalent API update is:

```sh
gh api --method PUT repos/jeremyswisher13/jeremyswishermd/pages -f build_type=workflow
gh api repos/jeremyswisher13/jeremyswishermd/pages --jq '{build_type, cname, https_enforced}'
```

Verify `build_type` is `workflow`, `cname` is `jeremyswishermd.com`, and
`https_enforced` remains `true`. Keep the custom domain and existing HTTPS settings.

## Required checks

`.github/workflows/quality.yml` publishes only after all six jobs succeed for
the same commit:

- Source validation, source regression tests, and public artifact packaging.
- Published referral PDF structure and regeneration validation.
- Chromium accessibility and behavior tests, plus actual Letter and A4 PDF checks.
- Mobile WebKit navigation, pending-script layout, search, progress storage, and sharing checks.
- Rendered text clipping checks and visual evidence.
- Lighthouse budgets.

Pull requests and manual runs on other branches can test but cannot deploy.
Only the deployment job has Pages write and OIDC permissions. It checks out the
validated SHA, creates an artifact named `github-pages-<SHA>`, verifies that SHA
is still current on `main`, and deploys that artifact. A failed or canceled check
prevents its dependent deployment. A rerun of an old commit cannot replace the
current website.

`npm run build:pages` copies only approved public files to `.quality-results/pages`.
The allowlist in `scripts/package-site.mjs` includes sitemap routes, required
scripts and styles, images, fonts and their licenses, the referral PDF, and the
bundled QR encoder. Source tests confirm public link and asset references exist
in this artifact. Internal scripts, tests, documentation, dependencies, Git files,
and quality reports are excluded. New public dependencies may require an explicit
allowlist update.

## Verify and roll back

After merging, inspect the **Website quality** run for the merge SHA. Confirm all
six checks finished successfully before **Deploy validated website** starts, the
deployment references the same SHA, and the `github-pages` environment reports
success. Check the live homepage, exercise library search and sharing link, a
guided session, the referral PDF, and a missing URL's custom 404.

If a regression needs rollback, revert the affected change on a new branch,
review and merge the revert, then let the resulting new `main` commit pass this
same pipeline. Keep the quality gates and workflow publishing source enabled;
do not redeploy an old artifact or re-enable branch publishing.
