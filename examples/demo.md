# Docs sidebar demo

This workspace exercises the Markdown, HTML, and Word preview paths in the Docs panel.

## Markdown

Inline math: $E = mc^2$. Display math:

$$
\bar x_n=\frac{a_n+\Delta q}{Q_n}
$$

| Preview | Sample |
| --- | --- |
| Markdown | [demo.md](demo.md) |
| HTML | [demo.html](demo.html) |
| Word | [demo.docx](demo.docx) |

Inline image:

![Inline image](assets/demo.png)

Reference image with the URL on the next line:

![Reference image][demo-image]

[demo-image]:
  assets/demo.png "Reference image from a next-line definition"

A long file name is in the tree: [very long file name](very-long-file-name-for-testing-the-resizable-file-tree-in-the-docs-sidebar.md).

```md
Code blocks keep their original text: $not rendered$ and <img src=https://example.com/never.png>.
```
