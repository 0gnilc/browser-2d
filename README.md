# Browser 2D

Browser 2D manages local references to AdsPower browser environments and independent Cards. Add an existing environment ID, save its account and task amount, import Cards, and start or stop work from the Browser row. The current processor verifies access to Baidu. Its result is a verification result, not a completed payment or other external action.

Cards retain their full text, including leading zeros, internal spaces, security codes, and addresses. Import uses a multiline text box or UTF-8 TXT file with eleven pipe-separated columns. Browser and Card amounts have two decimal places and no currency meaning.

## Start development

Use the Node version in [.node-version](.node-version) and the pnpm version in [package.json](package.json).

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Configure the local AdsPower API and its key in Settings before starting work. The key uses the operating-system credential store. Development stores application data in `artifacts/dev-data`. An installed app stores its database at `<userData>/data/app.sqlite`. `BROWSER2D_DATA_DIR` overrides the entire userData root.

## Documentation

- [Architecture](docs/architecture.md) describes process ownership, data, and trust boundaries.
- [Development](docs/development.md) describes commands, restart behavior, and verification.
- [Release](docs/release.md) describes preview formats, native acceptance, and production requirements.
- [Glossary](GLOSSARY.md) defines the domain terms.

Dependency versions are maintained in the [workspace catalog](pnpm-workspace.yaml) and [lockfile](pnpm-lock.yaml). [Issue 13](https://github.com/0gnilc/browser-2d/issues/13) tracks the Browser/Card acceptance work. Formal signing, notarization, a trusted HTTPS update service, and official release certification remain external requirements tracked in [Issue 6](https://github.com/0gnilc/browser-2d/issues/6).
