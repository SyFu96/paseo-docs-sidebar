# Docs sidebar

Adds a document workspace to Paseo's right explorer. It shows the current workspace as a file tree, opens documents as tabs, and renders each file in a preview pane.

Markdown opens as a rendered document with a source toggle. HTML and PDF open in an isolated document frame on the desktop client. Images render inline, and other text files open as source.

Open documents, expanded folders, and the tree visibility are stored in the explorer tab, so they come back after restarting Paseo. The explorer belongs to the workspace rather than to one agent, so switching sessions keeps the document area unchanged.

## Setup

Requires Paseo 0.17.4 or later. No account, token, or external service is needed.

Open the command center and choose "Docs: open on the right", or pick the Docs tab from the explorer's new-tab menu.

## Data and limits

The daemon reads files from the current workspace. Every path is resolved against the workspace root, and paths outside it are refused. File contents travel only between the daemon and the Paseo client. The plugin makes no network requests and does not send file contents to agent providers.

HTML previews do not run page scripts. HTML and PDF previews use local blob URLs and are available on the desktop client; the mobile client shows a notice. Markdown relative image paths may not resolve. The plugin has its own file tree: files opened from Paseo's built-in Files tab still open in the center area.
