import { describe, expect, it } from "vitest";
import { paragraph, root, text } from "chat";
import { LinqFormatConverter } from "../src/format-converter.js";

const converter = new LinqFormatConverter();

describe("LinqFormatConverter", () => {
  it("parses plain text into mdast", () => {
    expect(converter.toAst("Hello").type).toBe("root");
  });

  it("renders an AST back to text", () => {
    expect(converter.fromAst(root([paragraph([text("Hello")])]))).toBe("Hello");
  });

  it("renderPostable handles strings and markdown", () => {
    expect(converter.renderPostable("Hello")).toBe("Hello");
    expect(converter.renderPostable({ markdown: "**bold**" }).toLowerCase()).toContain("bold");
  });
});
