/*
 * Popup selection model (Phase 7 scaffolding + Phase 8 sense-level refinement),
 * consumed by Phase 8's {popup-selection-text} marker.
 *
 * Selection granularity, coarse → fine:
 *   "dictionary" — a whole dictionary block within the active pane
 *   "definition" — one glossary item within that block
 *   "sense"      — one sense NODE inside a single glossary item's structured-content
 *                  tree (JMdict packs all senses into one item; `path` is the index
 *                  chain locating the tapped node — see senses.ts)
 *   "segment"    — one TEXTUAL sense inside a blob item with no structure (㊀㊁… /
 *                  ①②… lines; see senses.ts senseSegments). Addressed by index and
 *                  re-derived at resolve time — selection is ephemeral per popup, so
 *                  the derivation can't drift under it.
 *
 * `null` means "nothing selected" — the marker engine falls back to the active pane's
 * full glossary in that case.
 */
import type { LookupResult } from "./lookup";
import {
  type SensePath,
  senseSegments,
  serializePath,
  subtreeAtPath,
} from "./senses";
import {
  glossaryDefinitionsToHtml,
  normalizeGlossary,
  type SCContent,
  scToText,
} from "./structuredContent";

export type PopupSelection =
  | { kind: "dictionary"; paneIndex: number; dictionary: string }
  | {
      kind: "definition";
      paneIndex: number;
      dictionary: string;
      /** index of the glossary item within that dictionary's DefinitionGroup */
      glossIndex: number;
    }
  | {
      kind: "sense";
      paneIndex: number;
      dictionary: string;
      glossIndex: number;
      /** index chain locating the sense node inside the glossary item's SC tree */
      path: SensePath;
    }
  | {
      kind: "segment";
      paneIndex: number;
      dictionary: string;
      glossIndex: number;
      /** index into senseSegments(glossary item) */
      segIndex: number;
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
  if (a.kind === "sense" && b.kind === "sense") {
    return (
      a.glossIndex === b.glossIndex &&
      serializePath(a.path) === serializePath(b.path)
    );
  }
  if (a.kind === "segment" && b.kind === "segment") {
    return a.glossIndex === b.glossIndex && a.segIndex === b.segIndex;
  }
  return true;
}

/**
 * Resolve a selection to the glossary items (or sense subtree) it refers to.
 * Returns an empty array if the selection is null or no longer resolvable — callers
 * treat that as "no selection" and fall back to the full glossary.
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
  if (item === undefined) return [];
  if (selection.kind === "definition") return [item];
  if (selection.kind === "segment") {
    const segment = senseSegments(item)[selection.segIndex];
    return segment === undefined ? [] : [segment];
  }
  const subtree = subtreeAtPath(item, selection.path);
  return subtree === undefined ? [] : [subtree];
}

/**
 * Flatten the current selection to plain text for {popup-selection-text}.
 * "" when nothing is selected / resolvable (the marker then falls back to the full
 * glossary — the sensible default per the plan).
 */
export function flattenSelectionText(
  result: LookupResult,
  selection: PopupSelection,
): string {
  const items = selectionGlossary(result, selection);
  const lines: string[] = [];
  for (const item of items) {
    const text = scToText(normalizeGlossary(item)).trim();
    if (text) lines.push(text);
  }
  return lines.join("\n").trim();
}

/**
 * HTML flavor of flattenSelectionText for the HTML-glossary mode ({popup-selection-
 * text} then ships Yomitan-style markup instead of plain text). "" when nothing is
 * selected / resolvable.
 */
export function flattenSelectionHtml(
  result: LookupResult,
  selection: PopupSelection,
): string {
  if (!selection) return "";
  const items = selectionGlossary(result, selection).map(
    (item) => normalizeGlossary(item) as SCContent,
  );
  // Selection is already dictionary-scoped → brief mode (no <i>(dict)</i> prefix).
  return glossaryDefinitionsToHtml(
    [{ dictionary: selection.dictionary, items }],
    { dictionaryTag: false },
  );
}
