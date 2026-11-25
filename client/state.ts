import { z } from "zod";

/** Persisted per explorer tab, so open documents and folders survive app reloads. */
export const docsPanelStateSchema = z.object({
  tabs: z.array(z.string()).max(30),
  active: z.string().nullable(),
  expanded: z.array(z.string()).max(300),
  showTree: z.boolean(),
  source: z.boolean(),
});

export type DocsPanelState = z.infer<typeof docsPanelStateSchema>;

export const DEFAULT_DOCS_PANEL_STATE: DocsPanelState = {
  tabs: [],
  active: null,
  expanded: [],
  showTree: true,
  source: false,
};
