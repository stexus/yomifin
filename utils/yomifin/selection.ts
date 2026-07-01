/*
 * Popup selection model (Phase 7 scaffolding, consumed by Phase 8's
 * {popup-selection-text} marker).
 *
 * The definition popup lets the user tap a whole DICTIONARY block or a single
 * DEFINITION within it to mark it selected. This module defines that selection's data
 * shape and a pure resolver from a selection to the glossary items it refers to — so
 * Phase 8 can flatten those items to text (via the existing anki.ts flattener) without
 * the popup needing to know anything about Anki.
 *
 * `null` means "nothing selected" — Phase 8 should fall back to the active pane's full
 * glossary in that case.
 */
import type { LookupResult } from "./lookup";

export type PopupSelection =
  | { kind: "dictionary"; paneIndex: number; dictionary: string }
  | {
      kind: "definition";
      paneIndex: number;
      dictionary: string;
      /** index of the glossary item within that dictionary's DefinitionGroup */
      glossIndex: number;
    }
  | null;

/** True if two selections refer to the same target (used to toggle selection off). */
export function selectionEquals(a: PopupSelection, b: PopupSelection): boolean {
  if (a === null || b === null) return a === b;
  if (a.kind !== b.kind) return false;
  if (a.paneIndex !== b.paneIndex || a.dictionary !== b.dictionary)
    return false;
  if (a.kind === "definition" && b.kind === "definition") {
    return a.glossIndex === b.glossIndex;
  }
  return true;
}

/**
 * Resolve a selection to the glossary items it refers to (Phase 8 flattens these).
 * Returns an empty array if the selection is null or no longer resolvable.
 */
export function selectionGlossary(
  result: LookupResult,
  selection: PopupSelection,
): unknown[] {
  if (!selection) return [];
  const entry = result.entries[selection.paneIndex];
  if (!entry) return [];
  const group = entry.definitions.find(
    (d) => d.dictionary === selection.dictionary,
  );
  if (!group) return [];
  if (selection.kind === "dictionary") return group.glossary;
  const item = group.glossary[selection.glossIndex];
  return item === undefined ? [] : [item];
}
