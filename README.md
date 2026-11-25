# Docs sidebar

A Paseo plugin that adds a document workspace to the right explorer: a workspace file tree, document tabs, and rendered previews.

## What it does

- Markdown rendered as a document, with a source toggle.
- HTML and PDF previews in an isolated document frame on desktop.
- Images inline; other text files as source.
- Open documents, expanded folders, and tree visibility persist per explorer tab.
- The explorer is workspace-scoped, so switching agent sessions keeps the document area.

## Requirements

- Paseo 0.17.4 or later.
- Desktop client for HTML and PDF previews. Markdown, text, and images work on other clients.

## Install

From a local checkout:

```bash
paseo plugin install /absolute/path/to/docs-sidebar
```

From GitHub:

```bash
paseo plugin add git:OWNER/REPOSITORY
```

Then open Paseo's command center and choose **Docs: open on the right**, or pick **Docs** from the explorer's new-tab menu.

## Development

```bash
npm install
npm run typecheck
paseo plugin install "$PWD"
paseo plugin reload docs-sidebar
```

The plugin has no build step. Paseo compiles the TypeScript entries and supplies the host modules (`react`, `react-native`, `zod`, `@tanstack/react-query`, `@getpaseo/plugin`) at runtime.

## How it works

- `index.client.tsx` registers a workspace panel in the explorer and two command-center entries.
- `client/docs-panel.tsx` renders the document tabs, toolbar, tree, and preview split.
- `client/file-tree.tsx` lazy-loads directories and searches file names.
- `client/preview.tsx` renders Markdown with Paseo's `Markdown` component, and HTML/PDF with `DocumentFrame`.
- `index.server.ts` handles daemon-side RPCs for listing, reading, and searching workspace files.
- `shared/docs.ts` defines the RPC contracts and file-kind helpers.

## Limits

- The plugin has its own file tree. Files opened from Paseo's built-in Files tab still open in the center area.
- HTML previews do not run page scripts.
- Markdown relative image paths may not resolve.
- HTML and PDF previews need the desktop client.

## License

Add the license you want to use before publishing. MIT and Apache-2.0 are both compatible with the plugin structure.
