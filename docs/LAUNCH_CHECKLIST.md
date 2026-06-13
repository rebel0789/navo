# Launch Checklist

Use this before the first public GitHub and npm release.

## Product Quality

- Run `npm run check`.
- Run `npm pack --dry-run` and confirm the package does not include local experiments.
- Run `navo help`, `navo version`, and `navo ui`.
- Test Codex native mode with `navo codex-model gpt-5.5`.
- Test OpenCode mode with `navo model deepseek-v4-flash`, `navo probe-routing`, and `navo verify --fresh`.
- Confirm the dashboard loads at `http://127.0.0.1:17854`.
- Confirm `navo ui` opens Chrome once and `navo ui --no-open` only prints the URL.

## GitHub Setup

- Use the repo name `navo`.
- Add the logo from `assets/navo-logo.svg` to the README.
- Add `assets/social-preview.svg` as the GitHub social preview image.
- Enable Issues and Discussions.
- Enable Dependabot alerts and secret scanning.
- Add topics: `codex`, `opencode`, `llm`, `developer-tools`, `model-routing`, `local-first`, `ai-agents`.
- Pin a short demo video or GIF in the README after launch.

## Release Steps

```bash
npm run check
npm pack --dry-run
git add package.json README.md LICENSE .gitignore bin assets docs .github CONTRIBUTING.md SECURITY.md CHANGELOG.md CODE_OF_CONDUCT.md
git commit -m "Initial Navo release"
gh repo create YOUR_GITHUB_USERNAME/navo --public --source=. --remote=origin --push
git tag v0.1.0
git push origin v0.1.0
npm login
npm publish --access public
```

After the GitHub repo exists, add real package metadata:

```bash
npm pkg set repository.type=git
npm pkg set repository.url=git+https://github.com/YOUR_GITHUB_USERNAME/navo.git
npm pkg set bugs.url=https://github.com/YOUR_GITHUB_USERNAME/navo/issues
npm pkg set homepage=https://github.com/YOUR_GITHUB_USERNAME/navo#readme
```

## Star Plan

- Lead with a clear one-line promise: "Use Codex with Codex native models or OpenCode Go models, with local proof of where requests went."
- Show the safety proof early: `navo verify --fresh` and privacy-safe logs.
- Post the launch with one screenshot, one terminal demo, and the recovery story.
- Ask users to star the repo if Navo saves them setup time.
- Reply quickly to the first 10 issues. Early trust is what turns installs into stars.
- Make a `good first issue` list for docs, model presets, and platform testing.
