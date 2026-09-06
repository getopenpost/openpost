import { defineRule } from "@oxlint/plugins";
import type { ESTree } from "@oxlint/plugins";

const FORBIDDEN_SYMBOL_NAME = "shape";
const GRAPHIC_SHAPE_SYMBOLS = new Set([
  "addShape",
  "drawShape",
  "image_editor_shape",
  "ImageEditorShapeValue",
  "insertShape",
  "media_shapes",
  "shape",
  "shapeOptions",
  "ShapesIcon",
  "ShapeStyle",
  "shapeSlotKind",
  "tool_shape",
  "updateVisualShapeStyle",
  "video_editor_add_shape",
  "video_editor_shape_arrow",
  "video_editor_shape_click_pulse",
  "video_editor_shape_ellipse",
  "video_editor_shape_highlight",
  "video_editor_shape_kind",
  "video_editor_shape_progress",
  "video_editor_shape_rectangle",
  "video_editor_shape_redaction",
]);

function containsForbiddenSymbolName(name: string): boolean {
  return name.toLowerCase().includes(FORBIDDEN_SYMBOL_NAME) && !GRAPHIC_SHAPE_SYMBOLS.has(name);
}

/** Ban the case-insensitive substring "shape" in every JavaScript and TypeScript symbol name. */
export const noForbiddenTermInSymbolNamesRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        'Disallow the case-insensitive substring "shape" in JavaScript, TypeScript, private, and JSX symbol names.',
    },
    messages: {
      forbiddenSymbolName:
        'Rename symbol "{{name}}" for its domain role; "shape" describes structure rather than ownership.',
    },
  },
  createOnce(context) {
    const reportForbiddenSymbolName = (node: ESTree.Node & { name: string }) => {
      if (!containsForbiddenSymbolName(node.name)) return;
      context.report({
        node,
        messageId: "forbiddenSymbolName",
        data: { name: node.name },
      });
    };

    return {
      Identifier: reportForbiddenSymbolName,
      PrivateIdentifier: reportForbiddenSymbolName,
      JSXIdentifier: reportForbiddenSymbolName,
    };
  },
});
