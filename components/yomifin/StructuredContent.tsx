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
import { StyleSheet, Text, View } from "react-native";
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
        style={[styles.link, style]}
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

/** Render a group of children: inline runs wrapped in one <Text>, blocks standalone. */
function renderGroups(
  children: SCContent[],
  ctx: RenderCtx,
  key: string,
): React.ReactNode[] {
  return groupChildren(children).map((group, gi) => {
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
    return (
      <View key={`${key}.g${gi}`}>
        {group.nodes.map((n, i) => renderBlock(n, ctx, `${key}.g${gi}.${i}`))}
      </View>
    );
  });
}

/** Render a block-level node (or anything not known to be inline) as views. */
function renderBlock(
  node: SCContent,
  ctx: RenderCtx,
  key: string,
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
    return <View key={key}>{renderGroups(node, ctx, key)}</View>;
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
          return (
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
                )}
              </View>
            </View>
          );
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
        {renderGroups(toChildArray(el.content), ctx, key)}
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
            )}
          </View>
        ))}
      </View>
    );
  }

  // div / details / summary / unknown block → container
  return (
    <View key={key} style={style}>
      {renderGroups(toChildArray(el.content), ctx, key)}
    </View>
  );
}

export interface StructuredContentProps {
  /** A glossary item: string, structured-content tree, or Yomitan wrapper object. */
  content: unknown;
  color?: string;
  onLinkPress?: (href: string) => void;
}

/** Render one glossary item (normalized to a structured-content tree). */
export function StructuredContent({
  content,
  color = "#e5e5e5",
  onLinkPress,
}: StructuredContentProps) {
  const ctx: RenderCtx = { onLinkPress, color };
  const tree = normalizeGlossary(content);
  if (tree === null || tree === undefined) return null;
  if (typeof tree === "string") return <Text style={{ color }}>{tree}</Text>;
  return (
    <View>
      {classify(tree) === "inline" ? (
        <Text style={{ color }}>{renderInline(tree, ctx, "r")}</Text>
      ) : (
        renderBlock(tree, ctx, "r")
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  link: { color: "#6cb6ff", textDecorationLine: "underline" },
  list: { gap: 2 },
  listItem: { flexDirection: "row", alignItems: "flex-start" },
  listItemBody: { flex: 1 },
  bullet: { fontWeight: "600" },
  table: { gap: 2 },
  tableRow: { flexDirection: "row", gap: 8 },
  tableCell: { flex: 1 },
});
