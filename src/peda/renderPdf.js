const { PDFDocument, StandardFonts, rgb, PDFName, PDFString } = require('pdf-lib');
const { LH } = require('./layout');

/** Dimensions d'une image (logo) via pdf-lib — réutilisé par le rendu Word. */
async function imageInfo(logo) {
  if (!logo) return null;
  try {
    const tmp = await PDFDocument.create();
    const img = /png/i.test(logo.mime) ? await tmp.embedPng(logo.buffer) : await tmp.embedJpg(logo.buffer);
    return { width: img.width, height: img.height };
  } catch (e) { return null; }
}

async function renderPdf(layout, logo) {
  const pdf = await PDFDocument.create();
  const fonts = { regular: await pdf.embedFont(StandardFonts.Helvetica), bold: await pdf.embedFont(StandardFonts.HelveticaBold), italic: await pdf.embedFont(StandardFonts.HelveticaOblique) };
  let logoImg = null;
  if (logo) { try { logoImg = /png/i.test(logo.mime) ? await pdf.embedPng(logo.buffer) : await pdf.embedJpg(logo.buffer); } catch (e) { logoImg = null; } }
  const { page: PG, margin: Mg, frame, copies } = layout;
  const col = c => rgb(c[0], c[1], c[2]);

  layout.pages.forEach((lp, pi) => {
    const page = pdf.addPage([612, 792]);
    const annots = [];
    for (let c = 0; c < copies; c++) {
      const top = copies === 1 ? 792 : 792 - c * PG.h; // haut de la fiche sur la feuille
      if (logoImg) {
        const k = Math.min(layout.logoSize / logoImg.width, layout.logoSize / logoImg.height);
        const w = logoImg.width * k, h = logoImg.height * k;
        page.drawImage(logoImg, { x: PG.w - Mg.r - w, y: top - Mg.t - h, width: w, height: h });
      }
      let y = top - Mg.t;
      lp.blocks.forEach(b => {
        if (b.kind === 'thead' || b.kind === 'tcat' || b.kind === 'trow') {
          let x = Mg.l;
          b.cols.forEach((w, ci) => {
            page.drawRectangle({ x, y: y - b.height, width: w, height: b.height, color: b.fill ? col(b.fill) : rgb(1, 1, 1), borderColor: rgb(0.74, 0.76, 0.82), borderWidth: 0.5 });
            let ty = y - b.padY;
            (b.cells[ci].lines || []).forEach(l => {
              const font = l.bold ? fonts.bold : l.italic ? fonts.italic : fonts.regular;
              const baseline = ty - l.size * 0.92, lx = x + b.padX + (l.indent || 0);
              if (l.text) page.drawText(l.text, { x: lx, y: baseline, size: l.size, font, color: col(l.color) });
              if (l.link && l.text) {
                const lw = font.widthOfTextAtSize(l.text, l.size);
                page.drawLine({ start: { x: lx, y: baseline - 1.5 }, end: { x: lx + lw, y: baseline - 1.5 }, thickness: 0.5, color: col(l.color) });
                annots.push(pdf.context.register(pdf.context.obj({ Type: 'Annot', Subtype: 'Link', Rect: [lx, baseline - 2, lx + lw, baseline + l.size], Border: [0, 0, 0], A: { Type: 'Action', S: 'URI', URI: PDFString.of(l.link) } })));
              }
              ty -= l.size * LH + (l.gap || 0);
            });
            x += w;
          });
          y -= b.height; return;
        }
        y -= b.before || 0;
        if (b.kind === 'rule') {
          page.drawLine({ start: { x: Mg.l, y }, end: { x: Mg.l + frame.w, y }, thickness: 0.9, color: col(b.color) });
          y -= (b.after || 0) + 1; return;
        }
        const font = b.bold ? fonts.bold : b.italic ? fonts.italic : fonts.regular;
        (b.lines || []).forEach(line => {
          const baseline = y - b.size * 0.92, x = Mg.l + (b.indent || 0);
          if (line) page.drawText(line, { x, y: baseline, size: b.size, font, color: col(b.color) });
          if (b.kind === 'link' && line) {
            const w = font.widthOfTextAtSize(line, b.size);
            page.drawLine({ start: { x, y: baseline - 1.5 }, end: { x: x + w, y: baseline - 1.5 }, thickness: 0.5, color: col(b.color) });
            annots.push(pdf.context.register(pdf.context.obj({ Type: 'Annot', Subtype: 'Link', Rect: [x, baseline - 2, x + w, baseline + b.size], Border: [0, 0, 0], A: { Type: 'Action', S: 'URI', URI: PDFString.of(b.link) } })));
          }
          y -= b.size * LH;
        });
        y -= b.after || 0;
      });
      if (copies === 1 && layout.pageCount > 1) page.drawText(`Page ${pi + 1} / ${layout.pageCount}`, { x: 306 - 24, y: 28, size: 8, font: fonts.regular, color: rgb(0.45, 0.45, 0.5) });
    }
    if (copies === 2) page.drawLine({ start: { x: 18, y: 396 }, end: { x: 594, y: 396 }, thickness: 0.6, color: rgb(0.6, 0.6, 0.65), dashArray: [4, 3] });
    if (annots.length) page.node.set(PDFName.of('Annots'), pdf.context.obj(annots));
  });
  return Buffer.from(await pdf.save());
}

module.exports = { renderPdf, imageInfo };
