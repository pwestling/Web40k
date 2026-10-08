/**
 * A tiny PDF writer (#47): one JPEG per page, filling it. Print-and-play
 * sheets are drawn on canvases at print resolution, so a page is a picture;
 * this writes them as a PDF any viewer or printer takes, with no library.
 */

export interface PdfPage {
  /** The page's size in points (1/72 inch). */
  width: number;
  height: number;
  /** A baseline JPEG and its pixel size. */
  jpeg: Uint8Array;
  pixels: { width: number; height: number };
}

const enc = new TextEncoder();

export function pdf(pages: PdfPage[], title = "Open Battle"): Blob {
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [];
  let length = 0;
  const push = (b: Uint8Array | string) => {
    const bytes = typeof b === "string" ? enc.encode(b) : b;
    chunks.push(bytes);
    length += bytes.length;
  };
  const object = (n: number, body: () => void) => {
    offsets[n] = length;
    push(`${n} 0 obj\n`);
    body();
    push("\nendobj\n");
  };
  push("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n");
  // 1: catalog, 2: pages, 3: info, then three objects a page (page, content, image).
  const first = 4;
  const kids = pages.map((_, i) => `${first + i * 3} 0 R`).join(" ");
  object(1, () => push("<< /Type /Catalog /Pages 2 0 R >>"));
  object(2, () => push(`<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`));
  object(3, () => push(`<< /Title (${title.replace(/[()\\]/g, "")}) /Producer (Open Battle) >>`));
  pages.forEach((p, i) => {
    const n = first + i * 3;
    const w = p.width.toFixed(2);
    const h = p.height.toFixed(2);
    object(n, () =>
      push(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /Im${i} ${n + 2} 0 R >> >> /Contents ${n + 1} 0 R >>`,
      ),
    );
    const draw = `q ${w} 0 0 ${h} 0 0 cm /Im${i} Do Q`;
    object(n + 1, () => push(`<< /Length ${draw.length} >>\nstream\n${draw}\nendstream`));
    object(n + 2, () => {
      push(
        `<< /Type /XObject /Subtype /Image /Width ${p.pixels.width} /Height ${p.pixels.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpeg.length} >>\nstream\n`,
      );
      push(p.jpeg);
      push("\nendstream");
    });
  });
  const xref = length;
  const count = first + pages.length * 3;
  push(`xref\n0 ${count}\n0000000000 65535 f \n`);
  for (let i = 1; i < count; i++) push(`${String(offsets[i] ?? 0).padStart(10, "0")} 00000 n \n`);
  push(`trailer\n<< /Size ${count} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(chunks as BlobPart[], { type: "application/pdf" });
}
