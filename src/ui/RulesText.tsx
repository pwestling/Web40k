import type { ReactNode } from "react";

/**
 * A rule's text as lists write it (BattleScribe, New Recruit): **bold**,
 * ^^keywords^^ and ■ bullets, shown as such instead of as markup (UX 387).
 * The words are the player's; nothing in them becomes a link or HTML.
 */

/** Bold and keywords inside one line. */
function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  // **bold**, ^^keyword^^, or both nested either way; anything unmatched stays as typed.
  const re = /\*\*(.+?)\*\*|\^\^(.+?)\^\^/g;
  let last = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1] !== undefined) out.push(<strong key={m.index}>{inline(m[1])}</strong>);
    else
      out.push(
        <span key={m.index} className="kw">
          {inline(m[2]!)}
        </span>,
      );
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** Whether text carries any markup worth reading out. */
const MARKED = /\*\*|\^\^|■/;

export function RulesText({ text }: { text: string }) {
  if (!MARKED.test(text)) return <>{text}</>;
  // ■ starts a bullet, wherever lists put it (often mid-line).
  const [lead, ...bullets] = text.split(/\s*■\s*/);
  return (
    <>
      {lead && inline(lead.trim())}
      {bullets.length > 0 && (
        <ul className="rules-bullets">
          {bullets.map((b, i) => (
            <li key={i}>{inline(b.trim())}</li>
          ))}
        </ul>
      )}
    </>
  );
}
