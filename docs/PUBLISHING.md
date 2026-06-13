# Publishing Navo

This guide covers the first public GitHub and npm release.

## 1. Preflight

Run:

```bash
npm run prepublishOnly
npm pack --dry-run
```

The package should include only project files:

```text
CHANGELOG.md
CONTRIBUTING.md
LICENSE
README.md
SECURITY.md
assets/
bin/navo.mjs
docs/
package.json
```

Do not commit unrelated local experiments such as `index.html` or `greeting-site/`.

## 2. Create The GitHub Repository

Create a public repo named:

```text
navo
```

With GitHub CLI:

```bash
git init
git add package.json README.md LICENSE .gitignore bin assets docs .github CONTRIBUTING.md SECURITY.md CHANGELOG.md CODE_OF_CONDUCT.md
git commit -m "Initial Navo release"
gh repo create rebel0789/navo --public --source=. --remote=origin --push
```

Or create the repo on GitHub, then:

```bash
git remote add origin https://github.com/rebel0789/navo.git
git branch -M main
git push -u origin main
```

After the remote exists, write real npm metadata:

```bash
npm pkg set repository.type=git
npm pkg set repository.url=git+https://github.com/rebel0789/navo.git
npm pkg set bugs.url=https://github.com/rebel0789/navo/issues
npm pkg set homepage=https://github.com/rebel0789/navo#readme
```

## 3. Prepare npm

Publish under the owner scope to avoid npm package-name similarity blocks:

```bash
npm view @rebel0x/navo name version
```

If npm returns `404`, publish:

```bash
npm login
npm publish --access public
```

`prepublishOnly` runs automatically during `npm publish`, so a broken parser check or failing test blocks the release.

## 4. Tag A Release

```bash
git tag v0.1.0
git push origin v0.1.0
```

Create a GitHub Release from `v0.1.0` with the changelog notes.

## 5. Smoke Test

Run without a global install:

```bash
npx -y @rebel0x/navo@latest help
npx -y @rebel0x/navo@latest ui
```

Or install from npm:

```bash
npm install -g @rebel0x/navo
navo help
navo ui
```

Open:

```text
http://127.0.0.1:17854
```

Then test the OpenCode path:

```bash
navo login
navo model deepseek-v4-flash
navo probe-routing
navo verify --fresh
```

## 6. Suggested Repository Settings

Enable:

- Require pull request before merging.
- Require the `CI` check to pass.
- Squash merge.
- Dependabot alerts.
- Secret scanning.

Add topics:

```text
codex
opencode
llm
local-first
developer-tools
model-routing
ai-agents
```

## 7. Make The Repo Star-Friendly

- Add `assets/social-preview.svg` as the GitHub social preview image.
- Pin a demo GIF or short video once the dashboard is stable.
- Keep the README promise simple: safe Codex/OpenCode switching with proof.
- Mention the recovery path early: `navo codex-model`, `navo off`, and backups.
- Ask users to star the repo if it saves setup time.
