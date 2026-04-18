import { BaseFormatConverter, parseMarkdown, stringifyMarkdown } from "chat";
import type { Root } from "mdast";

/**
 * Format converter that translates between mdast and the plain-text format
 * Linq accepts on the wire.
 *
 * Linq's iMessage payloads are plain text; rich formatting is expressed via
 * the per-character `text_decorations` array on a text part (not implemented
 * yet — see README §"Inline text formatting"). Until that lands, mdast bold,
 * italic, etc. are preserved as their literal markdown markers.
 *
 * @public
 */
export class LinqFormatConverter extends BaseFormatConverter {
  override toAst(platformText: string): Root {
    return parseMarkdown(platformText);
  }

  override fromAst(ast: Root): string {
    return stringifyMarkdown(ast).trimEnd();
  }
}
