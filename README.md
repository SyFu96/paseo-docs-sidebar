# Docs sidebar

A Paseo plugin that adds a document workspace to the right explorer: a workspace file tree, document tabs, and rendered previews.

![Docs sidebar in Paseo's explorer](assets/screenshot.png)

## What it does

- Markdown rendered as a document, with a source toggle. Relative images load from the workspace.
- Word documents (`.docx`, `.docm`) as a simplified reading view with headings, basic formatting, tables, and embedded images on desktop.
- HTML and PDF previews in an isolated document frame on desktop.
- Images inline; other text files as source.
- Relative document links in a Markdown preview open as new tabs in the same panel on the desktop client.
- Open documents, expanded folders, and tree visibility persist per explorer tab.
- The explorer is workspace-scoped, so switching agent sessions keeps the document area.

## Requirements

- Paseo 0.17.4 or later.
- Desktop client for Word, HTML, and PDF previews. Markdown, text, and images work on other clients.

## Install

From the plugin marketplace (after approval):

```bash
paseo plugin add SyFu96/paseo-docs-sidebar
```

Directly from GitHub, which works before the listing is approved:

```bash
paseo plugin add git:SyFu96/paseo-docs-sidebar
```

From a local checkout:

```bash
paseo plugin install /absolute/path/to/docs-sidebar
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

- Word previews are a reading view: page layout, headers and footers, footnotes, equations, fields, and complex merged cells are not reproduced. Legacy `.doc` files are not supported, and macros in `.docm` files are not executed.
- The plugin has its own file tree. Files opened from Paseo's built-in Files tab still open in the center area.
- HTML previews do not run page scripts.
- Markdown relative image paths and document links resolve against the open file; paths outside the workspace are refused.
- HTML and PDF previews need the desktop client.

## License

MIT. See [LICENSE](LICENSE).
