/** Save a rendered DOM element (the feedback surface) as a pixel-perfect PDF.
 *  Uses html-to-image (foreignObject — handles modern CSS + inline SVG) then
 *  jsPDF, paginating tall content across A4 pages. */
import jsPDF from "jspdf";
import { toPng } from "html-to-image";

export async function saveElementAsPdf(el: HTMLElement, filename: string): Promise<void> {
  const previous = {
    overflow: el.style.overflow,
    height: el.style.height,
    maxHeight: el.style.maxHeight,
    width: el.style.width,
  };
  const width = Math.max(el.scrollWidth, el.offsetWidth);
  const height = Math.max(el.scrollHeight, el.offsetHeight);

  el.style.overflow = "visible";
  el.style.height = `${height}px`;
  el.style.maxHeight = "none";
  el.style.width = `${width}px`;

  let dataUrl: string;
  try {
    dataUrl = await toPng(el, {
      pixelRatio: 2,
      cacheBust: true,
      backgroundColor: "#ffffff",
      width,
      height,
      style: {
        overflow: "visible",
        scrollbarWidth: "none",
      },
      filter: (node) => {
        if (!(node instanceof HTMLElement)) return true;
        return !node.classList.contains("marking-activity");
      },
      // Skip embedding web fonts: reading cross-origin Google Fonts cssRules
      // throws a SecurityError. The snapshot uses a fallback font; layout and
      // colours (the point of the snapshot) are preserved.
      skipFonts: true,
    });
  } finally {
    el.style.overflow = previous.overflow;
    el.style.height = previous.height;
    el.style.maxHeight = previous.maxHeight;
    el.style.width = previous.width;
  }

  const img = await loadImage(dataUrl);
  const pdf = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const renderW = pageW;
  const renderH = (img.height / img.width) * renderW;

  if (renderH <= pageH) {
    pdf.addImage(dataUrl, "PNG", 0, 0, renderW, renderH);
  } else {
    // Draw the full-height image shifted up one page-height at a time.
    let offset = 0;
    let page = 0;
    while (offset < renderH) {
      if (page > 0) pdf.addPage();
      pdf.addImage(dataUrl, "PNG", 0, -offset, renderW, renderH);
      offset += pageH;
      page += 1;
    }
  }
  pdf.save(filename);
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}
