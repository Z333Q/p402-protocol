# Branch Protection & Security Setup Checklist

This file documents the GitHub and npm settings that MUST be configured after
creating the repo. Automation can't enforce these — they require manual setup once.

## GitHub Settings

### 1. Branch Protection on `main`

Settings → Branches → Add rule for `main`:

| Setting | Value | Why |
|---|---|---|
| Require a pull request before merging | ✅ | No direct pushes, even from you |
| Required approvals | 1 (yourself via secondary review) | Forces a review step |
| Dismiss stale reviews on new push | ✅ | Invalidates approvals when code changes |
| Require review from Code Owners | ✅ | Enforces CODEOWNERS rules |
| Require status checks to pass | ✅ | CI must be green |
| Required status checks | `Type-check SDK`, `Type-check CLI` | The two CI jobs |
| Require branches to be up to date | ✅ | Prevents merge of stale code |
| Require linear history | ✅ | No merge commits — easier to audit |
| Require signed commits | ✅ | All commits must be GPG/SSH signed |
| Do not allow bypassing above settings | ✅ | Applies to admins too |

### 2. Tag Protection for Publish Tags

Settings → Tags → Add tag protection rules:

| Pattern | Why |
|---|---|
| `sdk/v*` | Only protected pushers can trigger npm publish |
| `cli/v*` | Only protected pushers can trigger npm publish |

### 3. Environment Protection for `npm-publish`

Settings → Environments → Create `npm-publish`:

| Setting | Value | Why |
|---|---|---|
| Required reviewers | @Z333Q | Manual approval before publish |
| Wait timer | 5 minutes | Gives time to cancel accidental publishes |
| Deployment branches | Selected branches → tag pattern `sdk/v* cli/v*` | Only publish on explicit version tags |

### 4. GitHub Secrets

Settings → Secrets and variables → Actions:

| Secret | Scope | Notes |
|---|---|---|
| `NPM_TOKEN` | Environment: `npm-publish` only | **Not** repo-level — only available in the publish environment after approval |

Scoping NPM_TOKEN to the environment (not the repo) means it is never accessible
to CI runs on pull requests — even malicious PRs that somehow bypass review.

### 5. Secret Scanning & Push Protection

Settings → Security → Code security and analysis:

- ✅ **Secret scanning** — auto-detects committed secrets
- ✅ **Push protection** — blocks pushes that contain secrets before they land

### 6. Dependency Graph + Dependabot Alerts

Settings → Security → Code security and analysis:

- ✅ **Dependency graph**
- ✅ **Dependabot alerts**
- ✅ **Dependabot security updates** — auto-opens PRs for CVEs

---

## npm Settings

### 1. Enable 2FA on the npm account

`npmjs.com` → Account → Two-factor authentication → Require for publishing

Set to **"Authorization and writes"** (not just login) — this means every
`npm publish` requires a 2FA TOTP code, even from CI.

With provenance enabled (`--provenance`), CI uses OIDC instead of a token for
the publish assertion. The NPM_TOKEN is still required for auth but the package
integrity is proven via the OIDC attestation, not the token.

### 2. npm Token Scoping

Generate the NPM_TOKEN at `npmjs.com` → Access Tokens → Generate New Token:

| Setting | Value |
|---|---|
| Type | **Granular Access Token** (not legacy automation token) |
| Expiration | 90 days (rotate quarterly) |
| Allowed IP ranges | GitHub Actions IP ranges (optional, very strict) |
| Packages | `@p402/sdk`, `@p402/cli` — read+write only |
| Organizations | None |

### 3. Package Access

On `npmjs.com`, for both `@p402/sdk` and `@p402/cli`:

- Settings → Access → Require 2FA to publish

---

## GPG Commit Signing (for "Require signed commits")

```bash
# Generate a signing key (if you don't have one)
gpg --full-generate-key

# Get your key ID
gpg --list-secret-keys --keyid-format=long

# Export public key and add it to GitHub
gpg --armor --export YOUR_KEY_ID

# Tell git to sign all commits
git config --global user.signingkey YOUR_KEY_ID
git config --global commit.gpgsign true
git config --global tag.gpgsign true
```

Or use SSH signing (simpler, GitHub supports it):
```bash
git config --global gpg.format ssh
git config --global user.signingkey ~/.ssh/id_ed25519.pub
git config --global commit.gpgsign true
```

---

## Verification Commands

```bash
# Verify an installed package has valid provenance
npm audit signatures

# Check if a package version has SLSA attestation
gh attestation verify --repo Z333Q/p402-protocol $(npm pack @p402/sdk --dry-run 2>/dev/null | tail -1)

# Audit for known vulnerabilities
npm audit --audit-level=moderate

# Check that lockfile is consistent with manifests
npm ci --dry-run
```
