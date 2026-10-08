import { useEffect, useRef } from "react";
import { basicSetup } from "codemirror";
import { autocompletion } from "@codemirror/autocomplete";
import { javascript, javascriptLanguage } from "@codemirror/lang-javascript";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { oneDark } from "@codemirror/theme-one-dark";
import { sdkCompletions } from "./completions";

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
}: {
  doc: string;
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
    return () => v.destroy();
    // Made once; `doc` changes are handled below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const v = view.current;
    if (!v || v.state.doc.toString() === doc) return;
    v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: doc } });
  }, [doc]);

  return <div className="workshop-editor" ref={host} />;
}
