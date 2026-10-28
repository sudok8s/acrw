// Monaco is bundled locally (no CDN): the editor core, Monarch syntax
// highlighting for the basic languages and the ACRW theme.
import { loader } from "@monaco-editor/react";
// @ts-expect-error — the ESM entry has no bundled typings; types come from "monaco-editor".
import * as monacoCore from "monaco-editor/esm/vs/editor/edcore.main";
import "monaco-editor/esm/vs/basic-languages/monaco.contribution";
import EditorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import type * as Monaco from "monaco-editor";

const monaco = monacoCore as typeof Monaco;

(self as unknown as { MonacoEnvironment: unknown }).MonacoEnvironment = {
  getWorker: () => new EditorWorker(),
};

monaco.editor.defineTheme("acrw", {
  base: "vs-dark",
  inherit: true,
  rules: [
    { token: "", foreground: "E6E6E8" },
    { token: "keyword", foreground: "D9939C" },
    { token: "string", foreground: "A8C49A" },
    { token: "string.escape", foreground: "A8C49A" },
    { token: "number", foreground: "D7A45B" },
    { token: "type", foreground: "9DB8D9" },
    { token: "type.identifier", foreground: "9DB8D9" },
    { token: "tag", foreground: "9DB8D9" },
    { token: "attribute.name", foreground: "9DB8D9" },
    { token: "comment", foreground: "80838C", fontStyle: "italic" },
    { token: "delimiter", foreground: "92949D" },
    { token: "identifier", foreground: "E6E6E8" },
  ],
  colors: {
    "editor.background": "#101113",
    "editor.foreground": "#E6E6E8",
    "editorGutter.background": "#101113",
    "editorLineNumber.foreground": "#80838C",
    "editorLineNumber.activeForeground": "#E6E6E8",
    "editor.lineHighlightBackground": "#191A1E",
    "editor.lineHighlightBorder": "#00000000",
    "editor.selectionBackground": "#303238",
    "editorCursor.foreground": "#E6E6E8",
    "editorIndentGuide.background1": "#202126",
    "editorWhitespace.foreground": "#303238",
    "diffEditor.insertedLineBackground": "#13261B",
    "diffEditor.removedLineBackground": "#2B1519",
    "diffEditor.insertedTextBackground": "#1C3A28CC",
    "diffEditor.removedTextBackground": "#45202ACC",
    "diffEditorGutter.insertedLineBackground": "#1C3A28",
    "diffEditorGutter.removedLineBackground": "#45202A",
    "diffEditor.diagonalFill": "#202126",
    "diffEditor.unchangedRegionBackground": "#191A1E",
    "diffEditor.unchangedRegionForeground": "#92949D",
    "diffEditor.border": "#303238",
    "scrollbarSlider.background": "#30323880",
    "scrollbarSlider.hoverBackground": "#6E717A80",
    "editorWidget.background": "#202126",
    "editorWidget.border": "#303238",
    "editorHoverWidget.background": "#202126",
    "editorHoverWidget.border": "#303238",
    "focusBorder": "#E0485A",
  },
});

loader.config({ monaco });

export { monaco };
