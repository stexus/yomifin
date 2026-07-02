/*
 * React Native renderer for Yomitan structured content (the mini-HTML JSON tree used
 * by JMdict and many other dictionaries for glossary entries).
 *
 * RN port of Yomitan's display/structured-content-generator.js (which emits DOM). The
 * classification / grouping / style mapping logic lives in the RN-free, unit-tested
 * utils/yomifin/structuredContent.ts; this file turns that into <View>/<Text>.
 * Definitions-only scope: images are skipped, links render as styled (tappable) text,
 * tables degrade to simple rows. See PHASE2_YOMITAN.md.
 *
 * Robustness: a glossary item may be a plain string, a structured-content tree, OR a
 * Yomitan WRAPPER object ({type:'structured-content'|'text'|'image', ...}); we normalize
 * those here so the renderer always gets a valid tree, and never throws on odd input.
 */
import type React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  classify,
  getListBullet,
  groupChildren,
  LIST_TAGS,
  mapStyleToRN,
  normalizeGlossary,
  type SCContent,
  type SCNode,
  toChildArray,
} from "@/utils/yomifin/structuredContent";

const INLINE_TAGS_AS_TEXT = new Set([
  "span",
  "a",
  "em",
  "strong",
  "b",
  "i",
  "ruby",
  "rt",
  "rp",
]);

interface RenderCtx {
  /** Called when an internal dictionary link (href) is tapped, with the query string. */
  onLinkPress?: (href: string) => void;
  /** Base text color so inline runs inherit it. */
  color: string;
  /** Link color (theme-driven). */
  linkColor: string;
  /**
   * Phase 8 sense selection: serialized paths (see utils/yomifin/senses.ts) of the
   * nodes that should render as tappable selection targets. Path semantics: each
   * step indexes the node's children (array elements, or toChildArray(content)).
   */
  senseSet: Set<string> | null;
  /** Serialized path of the currently selected sense (highlight). */
  selectedPath: string | null;
  onSelectPath?: (path: number[]) => void;
  /** Long-press on a sense target (popup opens the manual ✎ text editor). */
  onLongPressPath?: (path: number[]) => void;
  /** Selected-state colors (theme-driven). */
  selectedBg?: string;
  selectedBorder?: string;
}

/** Wrap a rendered node in a tappable selection target when its path is a sense. */
function selectableWrap(
  rendered: React.ReactNode,
  path: number[],
  ctx: RenderCtx,
  key: string,
): React.ReactNode {
  const ser = path.join(".");
  if (!ctx.senseSet?.has(ser)) return rendered;
  const selected = ctx.selectedPath === ser;
  return (
    <Pressable
      key={`${key}.sel`}
      onPress={ctx.onSelectPath ? () => ctx.onSelectPath?.(path) : undefined}
      onLongPress={
        ctx.onLongPressPath ? () => ctx.onLongPressPath?.(path) : undefined
      }
      style={[
        styles.sense,
        selected && {
          backgroundColor: ctx.selectedBg,
          borderColor: ctx.selectedBorder,
          borderWidth: StyleSheet.hairlineWidth,
        },
      ]}
    >
      {rendered}
    </Pressable>
  );
}

/** Render content valid INSIDE a <Text> (strings + inline nodes). */
function renderInline(
  node: SCContent,
  ctx: RenderCtx,
  key: string,
): React.ReactNode {
  if (node === null || node === undefined) return null;
  if (typeof node === "string") return node;
  if (Array.isArray(node)) {
    return node.map((n, i) => (
      <Text key={`${key}.${i}`}>{renderInline(n, ctx, `${key}.${i}`)}</Text>
    ));
  }

  const el = node as SCNode;
  if (el.tag === "br") return "\n";
  if (el.tag === "rt" || el.tag === "rp") return null; // furigana annotations: base only

  const style = mapStyleToRN(el.style);
  const children = toChildArray(el.content).map((c, i) => (
    <Text key={`${key}.${i}`}>{renderInline(c, ctx, `${key}.${i}`)}</Text>
  ));

  if (el.tag === "a" && typeof el.href === "string") {
    const href = el.href;
    return (
      <Text
        key={key}
        style={[styles.link, { color: ctx.linkColor }, style]}
        onPress={ctx.onLinkPress ? () => ctx.onLinkPress?.(href) : undefined}
      >
        {children}
      </Text>
    );
  }

  const extra: Record<string, unknown> = {};
  if (el.tag === "strong" || el.tag === "b") extra.fontWeight = "bold";
  if (el.tag === "em" || el.tag === "i") extra.fontStyle = "italic";
  return (
    <Text key={key} style={[extra, style]}>
      {children}
    </Text>
  );
}

/**
 * Render a group of children: inline runs wrapped in one <Text>, blocks standalone.
 * `path` is the parent node's sense path; child i's path is [...path, i] where i is
 * the child's ORIGINAL index (groupChildren partitions children in order, so a
 * running counter recovers it). Inline runs are never sense targets.
 */
function renderGroups(
  children: SCContent[],
  ctx: RenderCtx,
  key: string,
  path: number[],
): React.ReactNode[] {
  let childIndex = 0;
  return groupChildren(children).map((group, gi) => {
    const startIndex = childIndex;
    childIndex += group.nodes.length;
    if (group.kind === "inline") {
      return (
        <Text key={`${key}.g${gi}`} style={{ color: ctx.color }}>
          {group.nodes.map((n, i) => (
            <Text key={`${key}.g${gi}.${i}`}>
              {renderInline(n, ctx, `${key}.g${gi}.${i}`)}
            </Text>
          ))}
        </Text>
      );
    }
    // Block groups hold exactly one node (see groupChildren).
    const nodePath = [...path, startIndex];
    return (
      <View key={`${key}.g${gi}`}>
        {group.nodes.map((n, i) =>
          selectableWrap(
            renderBlock(n, ctx, `${key}.g${gi}.${i}`, nodePath),
            nodePath,
            ctx,
            `${key}.g${gi}.${i}`,
          ),
        )}
      </View>
    );
  });
}

/** Render a block-level node (or anything not known to be inline) as views. */
function renderBlock(
  node: SCContent,
  ctx: RenderCtx,
  key: string,
  path: number[],
): React.ReactNode {
  if (node === null || node === undefined) return null;
  if (typeof node === "string") {
    return (
      <Text key={key} style={{ color: ctx.color }}>
        {node}
      </Text>
    );
  }
  if (Array.isArray(node)) {
    return <View key={key}>{renderGroups(node, ctx, key, path)}</View>;
  }

  const el = node as SCNode;
  const style = mapStyleToRN(el.style);

  if (INLINE_TAGS_AS_TEXT.has(el.tag)) {
    return (
      <Text key={key} style={{ color: ctx.color }}>
        {renderInline(el, ctx, key)}
      </Text>
    );
  }

  if (LIST_TAGS.has(el.tag)) {
    const ordered = el.tag === "ol";
    const items = toChildArray(el.content);
    return (
      <View key={key} style={[styles.list, style]}>
        {items.map((item, index) => {
          const itemNode = item as SCNode;
          const bullet = getListBullet(
            el.style?.listStyleType ?? itemNode?.style?.listStyleType,
            ordered,
            index,
          );
          const itemStyle =
            itemNode && typeof itemNode === "object"
              ? mapStyleToRN(itemNode.style)
              : {};
          const itemChildren =
            itemNode && typeof itemNode === "object" && itemNode.tag === "li"
              ? toChildArray(itemNode.content)
              : [item];
          const itemPath = [...path, index];
          const row = (
            <View key={`${key}.li${index}`} style={styles.listItem}>
              {bullet ? (
                <Text style={[styles.bullet, { color: ctx.color }]}>
                  {bullet}{" "}
                </Text>
              ) : null}
              <View style={styles.listItemBody}>
                {renderGroups(
                  itemChildren,
                  {
                    ...ctx,
                    color: (itemStyle.color as string) ?? ctx.color,
                  },
                  `${key}.li${index}`,
                  itemPath,
                )}
              </View>
            </View>
          );
          return selectableWrap(row, itemPath, ctx, `${key}.li${index}`);
        })}
      </View>
    );
  }

  if (
    el.tag === "table" ||
    el.tag === "thead" ||
    el.tag === "tbody" ||
    el.tag === "tfoot"
  ) {
    return (
      <View key={key} style={[styles.table, style]}>
        {renderGroups(toChildArray(el.content), ctx, key, path)}
      </View>
    );
  }
  if (el.tag === "tr") {
    return (
      <View key={key} style={styles.tableRow}>
        {toChildArray(el.content).map((cell, ci) => (
          <View key={`${key}.c${ci}`} style={styles.tableCell}>
            {renderGroups(
              toChildArray((cell as SCNode)?.content ?? cell),
              ctx,
              `${key}.c${ci}`,
              [...path, ci],
            )}
          </View>
        ))}
      </View>
    );
  }

  // div / details / summary / unknown block → container
  return (
    <View key={key} style={style}>
      {renderGroups(toChildArray(el.content), ctx, key, path)}
    </View>
  );
}

export interface StructuredContentProps {
  /** A glossary item: string, structured-content tree, or Yomitan wrapper object. */
  content: unknown;
  color?: string;
  /** Link color (defaults to the classic blue). */
  linkColor?: string;
  onLinkPress?: (href: string) => void;
  /**
   * Phase 8 sense selection (optional "selectable node" mode): serialized sense
   * paths (utils/yomifin/senses.ts senseTargets + serializePath) to render as
   * tappable targets, the currently-selected one, and the tap callback.
   */
  selectablePaths?: string[];
  selectedPath?: string | null;
  onSelectPath?: (path: number[]) => void;
  onLongPressPath?: (path: number[]) => void;
  selectedBg?: string;
  selectedBorder?: string;
}

/** Render one glossary item (normalized to a structured-content tree). */
export function StructuredContent({
  content,
  color = "#e5e5e5",
  linkColor = "#6cb6ff",
  onLinkPress,
  selectablePaths,
  selectedPath = null,
  onSelectPath,
  onLongPressPath,
  selectedBg,
  selectedBorder,
}: StructuredContentProps) {
  const ctx: RenderCtx = {
    onLinkPress,
    color,
    linkColor,
    senseSet:
      selectablePaths && selectablePaths.length > 0
        ? new Set(selectablePaths)
        : null,
    selectedPath,
    onSelectPath,
    onLongPressPath,
    selectedBg,
    selectedBorder,
  };
  const tree = normalizeGlossary(content);
  if (tree === null || tree === undefined) return null;
  if (typeof tree === "string") return <Text style={{ color }}>{tree}</Text>;
  return (
    <View>
      {classify(tree) === "inline" ? (
        <Text style={{ color }}>{renderInline(tree, ctx, "r")}</Text>
      ) : (
        renderBlock(tree, ctx, "r", [])
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  sense: { borderRadius: 5, paddingHorizontal: 2 },
  link: { color: "#6cb6ff", textDecorationLine: "underline" },
  list: { gap: 2 },
  listItem: { flexDirection: "row", alignItems: "flex-start" },
  listItemBody: { flex: 1 },
  bullet: { fontWeight: "600" },
  table: { gap: 2 },
  tableRow: { flexDirection: "row", gap: 8 },
  tableCell: { flex: 1 },
});
