import { useEffect, useRef } from "react";
import { basicSetup } from "codemirror";
import { autocompletion } from "@codemirror/autocomplete";
import { javascript, javascriptLanguage } from "@codemirror/lang-javascript";
import { EditorState, StateEffect, StateField } from "@codemirror/state";
import { Decoration, EditorView, keymap, type DecorationSet } from "@codemirror/view";
import { oneDark } from "@codemirror/theme-one-dark";
import { sdkCompletions } from "./completions";

/** The line a problem points at, marked until the text changes or another is set. */
const setMark = StateEffect.define<number | null>();
const markLine = Decoration.line({ class: "cm-problem-line" });
const marked = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(marks, tr) {
    for (const e of tr.effects)
      if (e.is(setMark)) {
        if (e.value === null || e.value < 1 || e.value > tr.state.doc.lines) return Decoration.none;
        return Decoration.set([markLine.range(tr.state.doc.line(e.value).from)]);
      }
    return tr.docChanged ? Decoration.none : marks;
  },
  provide: (f) => EditorView.decorations.from(f),
});

/**
 * The workshop's code editor: CodeMirror with JavaScript, the SDK's
 * completions (completions.ts) and Ctrl/Cmd+S to save. `doc` replaces the
 * text only when it changes from outside (a template, a link, another draft).
 */
export function Editor({
  doc,
  onChange,
  onSave,
  label,
  mark = null,
}: {
  doc: string;
  /** A line to mark as where a problem is (1-based), scrolled into view. */
  mark?: number | null;
  onChange: (text: string) => void;
  onSave: () => void;
  label: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  // The latest handlers, so the editor made once always calls the current ones.
  const handlers = useRef({ onChange, onSave });
  useEffect(() => {
    handlers.current = { onChange, onSave };
  });

  useEffect(() => {
    const v = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc,
        extensions: [
          keymap.of([
            {
              key: "Mod-s",
              preventDefault: true,
              run: () => {
                handlers.current.onSave();
                return true;
              },
            },
          ]),
          basicSetup,
          marked,
          javascript(),
          javascriptLanguage.data.of({ autocomplete: sdkCompletions }),
          autocompletion({ activateOnTyping: true }),
          EditorView.contentAttributes.of({ "aria-label": label }),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) handlers.current.onChange(u.state.doc.toString());
          }),
          // The app is dark throughout.
          oneDark,
        ],
      }),
    });
    view.current = v;
    // Browser tests set the text directly.
    if (import.meta.env.DEV) Object.assign(host.current!, { cmView: v });
    return () => v.destroy();
    // Made once; `doc` changes are handled below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const v = view.current;
    if (!v || v.state.doc.toString() === doc) return;
    v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: doc } });
  }, [doc]);

  useEffect(() => {
    const v = view.current;
    if (!v) return;
    const line = mark && mark <= v.state.doc.lines ? v.state.doc.line(mark) : null;
    v.dispatch({
      effects: [setMark.of(mark), ...(line ? [EditorView.scrollIntoView(line.from, { y: "center" })] : [])],
    });
  }, [mark]);

  return <div className="workshop-editor" ref={host} />;
}
