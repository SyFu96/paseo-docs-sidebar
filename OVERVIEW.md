# Docs sidebar

Adds a document workspace to Paseo's right explorer. It shows the current workspace as a file tree, opens documents as tabs, and renders each file in a preview pane.

Markdown opens as a rendered document with a source toggle. HTML and PDF open in an isolated document frame on the desktop client. Word documents (`.docx` and `.docm`) open in a simplified reading view on the desktop client, with headings, basic formatting, tables, and embedded images. Images render inline, and other text files open as source. On the desktop client, a relative document link inside a Markdown preview opens as a new tab in the same panel. Relative image paths in Markdown resolve against the open file, and LaTeX math (`$...$`, `$$...$$`, `\(...\)`, `\[...\]`) renders as MathML. The toolbar search field finds text in Markdown previews, Markdown source, and Word reading views; PDF previews keep the viewer's own find. On the desktop client, clicking a local document link in an agent message opens it in the Docs panel instead of the center file tab; Ctrl/Cmd+click keeps Paseo's default behavior. Paths written relative to a subdirectory resolve to the unique matching file; ambiguous or missing paths show an error instead of guessing.

Open documents, expanded folders, and the tree visibility are stored in the explorer tab, so they come back after restarting Paseo. The file tree divider can be dragged to resize it, and the width is kept with the explorer tab. The document tabs stay scrollable, the active tab scrolls into view, and the "All N" button opens a searchable drawer with full file names, per-document close, close others, and close all. The explorer belongs to the workspace rather than to one agent, so switching sessions keeps the document area unchanged.

## Setup

Requires Paseo 0.17.4 or later. No account, token, or external service is needed.

Open the command center and choose "Docs: open on the right", or pick the Docs tab from the explorer's new-tab menu.

The repository's `examples/` folder contains a small sample workspace for Markdown, HTML, and Word previews.

## Data and limits

The daemon reads files from the current workspace. Every path is resolved against the workspace root, and paths outside it are refused. File contents travel only between the daemon and the Paseo client. The plugin does not initiate network requests and does not send file contents to agent providers.

Previews do not load remote resources embedded in a document. Remote images in Markdown are replaced with a local placeholder, and HTML previews run with a content security policy that blocks images, styles, fonts, media, frames, and scripts from the network. An http(s) link opens in the external browser only when you click it.

HTML previews do not run page scripts. HTML and PDF previews use local blob URLs and are available on the desktop client; the mobile client shows a notice. Math is rendered locally by KaTeX on the daemon and sent to the client as MathML; it makes no network requests. Math rendering, Word, HTML, and PDF previews need the desktop client, and other clients show raw TeX. Word previews are a reading view and do not reproduce page layout, headers and footers, footnotes, equations, fields, or complex merged cells; legacy `.doc` files are not supported, and macros in `.docm` files are not executed. Document find is available on the desktop client for Markdown and Word previews through the toolbar search field; it does not search HTML or PDF previews, and Ctrl/Cmd+F stays with Paseo's workspace search. Chat document links are routed on the desktop client only, for workspace-local Markdown, HTML, Word, PDF, and text files. External links, paths outside the workspace, and Ctrl/Cmd+click keep Paseo's behavior. Line numbers are not carried into the Docs preview; line-specific links to source files keep Paseo's behavior. The plugin reads only the clicked link target and does not read chat content or send network requests. The plugin has its own file tree: files opened from Paseo's built-in Files tab still open in the center area.
