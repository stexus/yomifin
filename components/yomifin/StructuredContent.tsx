/*
 * React Native renderer for Yomitan structured content (the mini-HTML JSON tree used
 * by JMdict and many other dictionaries for glossary entries).
 *
 * This is the RN port of Yomitan's display/structured-content-generator.js (which
 * emits DOM). The classification / grouping / style mapping logic lives in the
 * RN-free, unit-tested utils/yomifin/structuredContent.ts; this file only turns that
 * into <View>/<Text>. Definitions-only scope: images are skipped, links render as
 * styled (optionally tappable) text, tables degrade to simple rows. See PHASE2_YOMITAN.md.
 */
import type React from "react";
import { StyleSheet, Text, View } from "react-native";
import {
  classify,
  getListBullet,
  groupChildren,
  LIST_TAGS,
  mapStyleToRN,
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

let keySeq = 0;
const nextKey = () => `sc${keySeq++}`;

/** Render content that is valid INSIDE a <Text> (strings + inline nodes). */
function renderInline(node: SCContent, ctx: RenderCtx): React.ReactNode {
  if (node === null || node === undefined) return null;
  if (typeof node === "string") return node;
  if (Array.isArray(node))
    return node.map((n) => <Text key={nextKey()}>{renderInline(n, ctx)}</Text>);

  const el = node as SCNode;
  if (el.tag === "br") return "\n";
  // rt/rp are furigana ruby annotations; show base text only for MVP → skip annotations
  if (el.tag === "rt" || el.tag === "rp") return null;

  const style = mapStyleToRN(el.style);
  const children = toChildArray(el.content).map((c) => (
    <Text key={nextKey()}>{renderInline(c, ctx)}</Text>
  ));

  if (el.tag === "a" && typeof el.href === "string") {
    const href = el.href;
    return (
      <Text
        key={nextKey()}
        style={[styles.link, style]}
        onPress={ctx.onLinkPress ? () => ctx.onLinkPress?.(href) : undefined}
      >
        {children}
      </Text>
    );
  }

  // span / em / strong / b / i / ruby / unknown-inline → styled text
  const extra: Record<string, unknown> = {};
  if (el.tag === "strong" || el.tag === "b") extra.fontWeight = "bold";
  if (el.tag === "em" || el.tag === "i") extra.fontStyle = "italic";
  return (
    <Text key={nextKey()} style={[extra, style]}>
      {children}
    </Text>
  );
}

/** Render a group of children: inline runs wrapped in one <Text>, blocks standalone. */
function renderGroups(
  children: SCContent[],
  ctx: RenderCtx,
): React.ReactNode[] {
  return groupChildren(children).map((group) => {
    if (group.kind === "inline") {
      return (
        <Text key={nextKey()} style={{ color: ctx.color }}>
          {group.nodes.map((n) => (
            <Text key={nextKey()}>{renderInline(n, ctx)}</Text>
          ))}
        </Text>
      );
    }
    return (
      <View key={nextKey()}>{group.nodes.map((n) => renderBlock(n, ctx))}</View>
    );
  });
}

/** Render a block-level node (or anything not known to be inline) as views. */
function renderBlock(node: SCContent, ctx: RenderCtx): React.ReactNode {
  if (node === null || node === undefined) return null;
  if (typeof node === "string") {
    return (
      <Text key={nextKey()} style={{ color: ctx.color }}>
        {node}
      </Text>
    );
  }
  if (Array.isArray(node)) {
    return <View key={nextKey()}>{renderGroups(node, ctx)}</View>;
  }

  const el = node as SCNode;
  const style = mapStyleToRN(el.style);

  if (INLINE_TAGS_AS_TEXT.has(el.tag)) {
    return (
      <Text key={nextKey()} style={{ color: ctx.color }}>
        {renderInline(el, ctx)}
      </Text>
    );
  }

  if (LIST_TAGS.has(el.tag)) {
    const ordered = el.tag === "ol";
    const items = toChildArray(el.content);
    return (
      <View key={nextKey()} style={[styles.list, style]}>
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
            <View key={nextKey()} style={styles.listItem}>
              {bullet ? (
                <Text style={[styles.bullet, { color: ctx.color }]}>
                  {bullet}{" "}
                </Text>
              ) : null}
              <View style={styles.listItemBody}>
                {renderGroups(itemChildren, {
                  ...ctx,
                  color: (itemStyle.color as string) ?? ctx.color,
                })}
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
      <View key={nextKey()} style={[styles.table, style]}>
        {renderGroups(toChildArray(el.content), ctx)}
      </View>
    );
  }
  if (el.tag === "tr") {
    return (
      <View key={nextKey()} style={styles.tableRow}>
        {toChildArray(el.content).map((cell) => (
          <View key={nextKey()} style={styles.tableCell}>
            {renderGroups(toChildArray((cell as SCNode)?.content ?? cell), ctx)}
          </View>
        ))}
      </View>
    );
  }

  // div / details / summary / unknown block → container
  return (
    <View key={nextKey()} style={style}>
      {renderGroups(toChildArray(el.content), ctx)}
    </View>
  );
}

export interface StructuredContentProps {
  /** A Yomitan structured-content tree, OR a plain string glossary item. */
  content: SCContent;
  color?: string;
  onLinkPress?: (href: string) => void;
}

/** Render one glossary item (string or structured-content tree). */
export function StructuredContent({
  content,
  color = "#e5e5e5",
  onLinkPress,
}: StructuredContentProps) {
  const ctx: RenderCtx = { onLinkPress, color };
  if (typeof content === "string") {
    return <Text style={{ color }}>{content}</Text>;
  }
  return (
    <View>
      {classify(content) === "inline" ? (
        <Text style={{ color }}>{renderInline(content, ctx)}</Text>
      ) : (
        renderBlock(content, ctx)
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
