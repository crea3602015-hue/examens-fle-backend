const {
  Document, Packer, Paragraph, TextRun, ExternalHyperlink, Table, TableRow, TableCell, ImageRun, WidthType, BorderStyle,
  AlignmentType, HeightRule, LineRuleType, VerticalAlign, ShadingType,
} = require('docx');
const { LH } = require('./layout');
const { imageInfo } = require('./renderPdf');

const tw = pt => Math.round(pt * 20);
const hex = c => c.map(v => Math.round(v * 255).toString(16).padStart(2, '0')).join('').toUpperCase();
const NONE = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
const NOBORDERS = { top: NONE, bottom: NONE, left: NONE, right: NONE, insideHorizontal: NONE, insideVertical: NONE };


const GRID = { style: BorderStyle.SINGLE, size: 4, color: 'BDC2D1' };
const isTblBlock = b => b.kind === 'thead' || b.kind === 'tcat' || b.kind === 'trow';

/** Une suite de lignes de tableau de la mise en page devient un vrai tableau Word (en-tête répété). */
function tableFromRows(rows, frameW) {
  const ncols = Math.max(...rows.map(r => r.cols.length));
  const base = rows.find(r => r.kind === 'thead') || rows.find(r => r.kind === 'trow') || rows[0];
  const widths = base.cols.map(w => tw(w));
  const trs = rows.map(b => {
    const span = b.cols.length === 1 && ncols > 1;
    const cells = b.cells.map((c, ci) => {
      const paras = c.lines.length ? c.lines.map(l => {
        const base = { text: l.text, font: 'Arial', size: Math.floor(l.size * 2), bold: !!l.bold, italics: !!l.italic, color: hex(l.color) };
        const run = l.link ? new ExternalHyperlink({ link: l.link, children: [new TextRun({ ...base, underline: {}, color: '1F5AA6' })] }) : new TextRun(base);
        return new Paragraph({ spacing: { before: 0, after: tw(l.gap || 0), line: tw(l.size * LH), lineRule: LineRuleType.EXACT }, indent: { left: tw(l.indent || 0) }, children: [run] });
      }) : [new Paragraph({ spacing: { before: 0, after: 0, line: tw(8 * LH), lineRule: LineRuleType.EXACT }, children: [new TextRun({ text: '', size: 16 })] })];
      return new TableCell({
        width: { size: span ? tw(frameW) : widths[ci], type: WidthType.DXA }, columnSpan: span ? ncols : 1,
        shading: b.fill ? { type: ShadingType.CLEAR, fill: hex(b.fill), color: 'auto' } : undefined,
        margins: { top: tw(b.padY), bottom: tw(b.padY), left: tw(b.padX), right: tw(b.padX) },
        borders: { top: GRID, bottom: GRID, left: GRID, right: GRID }, verticalAlign: VerticalAlign.TOP, children: paras,
      });
    });
    return new TableRow({ tableHeader: b.kind === 'thead', cantSplit: true, children: cells });
  });
  return new Table({ width: { size: tw(frameW), type: WidthType.DXA }, columnWidths: widths, rows: trs });
}

function blockParagraph(b) {
  if (b.kind === 'rule') {
    return new Paragraph({ spacing: { before: tw(b.before || 0), after: tw(b.after || 0), line: 20, lineRule: LineRuleType.EXACT }, border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: hex(b.color), space: 0 } }, children: [new TextRun({ text: '', size: 2 })] });
  }
  const size = Math.floor(b.size * 2); // demi-points entiers (jamais plus large que prévu)
  const color = hex(b.color);
  const children = [];
  (b.lines || []).forEach((line, i) => {
    const base = { text: line, font: 'Arial', size, bold: !!b.bold, italics: !!b.italic, color, break: i > 0 ? 1 : 0 };
    if (b.kind === 'link' && b.link) children.push(new ExternalHyperlink({ link: b.link, children: [new TextRun({ ...base, underline: {}, color: '1F5AA6' })] }));
    else children.push(new TextRun(base));
  });
  return new Paragraph({ spacing: { before: tw(b.before || 0), after: tw(b.after || 0), line: tw(b.size * LH), lineRule: LineRuleType.EXACT }, indent: { left: tw(b.indent || 0) }, keepNext: !!b.keep, children });
}

async function renderDocx(layout, logo) {
  const info = await imageInfo(logo);
  const { frame, margin: Mg, copies } = layout;
  const headerW = frame.w - (copies === 1 ? 76 : 52);
  const logoBox = layout.logoSize;

  function headerTable(headerBlocks) {
    const left = new TableCell({ width: { size: tw(headerW), type: WidthType.DXA }, borders: NOBORDERS, margins: { top: 0, bottom: 0, left: 0, right: 0 }, children: headerBlocks.length ? headerBlocks.map(blockParagraph) : [new Paragraph({ children: [] })] });
    let rightChildren = [new Paragraph({ children: [] })];
    if (info && logo) {
      const k = Math.min(logoBox / info.width, logoBox / info.height);
      rightChildren = [new Paragraph({ alignment: AlignmentType.RIGHT, spacing: { before: 0, after: 0 }, children: [new ImageRun({ type: /png/i.test(logo.mime) ? 'png' : 'jpg', data: logo.buffer, transformation: { width: Math.round(info.width * k), height: Math.round(info.height * k) } })] })];
    }
    const right = new TableCell({ width: { size: tw(frame.w - headerW), type: WidthType.DXA }, borders: NOBORDERS, margins: { top: 0, bottom: 0, left: 0, right: 0 }, verticalAlign: VerticalAlign.TOP, children: rightChildren });
    return new Table({ width: { size: tw(frame.w), type: WidthType.DXA }, columnWidths: [tw(headerW), tw(frame.w - headerW)], borders: NOBORDERS, rows: [new TableRow({ children: [left, right] })] });
  }

  function ficheChildren(lp) {
    const head = lp.blocks.filter(b => b.header), body = lp.blocks.filter(b => !b.header);
    const out = [headerTable(head)];
    // le filet fait partie de l'en-tête dans la mise en page : on le garde dans le corps
    let run = [];
    const flushRun = () => { if (run.length) { out.push(tableFromRows(run, frame.w)); run = []; } };
    body.forEach(b => { if (isTblBlock(b)) run.push(b); else { flushRun(); out.push(blockParagraph(b)); } });
    flushRun();
    // Word exige un paragraphe après un tableau en fin de cellule ou de page
    if (!body.length || isTblBlock(body[body.length - 1])) out.push(new Paragraph({ spacing: { before: 0, after: 0, line: 20, lineRule: LineRuleType.EXACT }, children: [new TextRun({ text: '', size: 2 })] }));
    return out;
  }

  const sections = layout.pages.map(lp => {
    if (copies === 1) {
      return { properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: tw(Mg.t), bottom: tw(Mg.b), left: tw(Mg.l), right: tw(Mg.r) } } }, children: ficheChildren(lp) };
    }
    // Version élèves : deux fiches identiques de 8,5 x 5,5 po sur une feuille Letter
    const cell = (cutLine) => new TableCell({
      width: { size: 12240, type: WidthType.DXA },
      margins: { top: tw(Mg.t), bottom: tw(Mg.b), left: tw(Mg.l), right: tw(Mg.r) },
      borders: { top: NONE, left: NONE, right: NONE, bottom: cutLine ? { style: BorderStyle.DASHED, size: 4, color: '999999' } : NONE },
      children: ficheChildren(lp),
    });
    const row = cut => new TableRow({ height: { value: 7880, rule: HeightRule.EXACT }, children: [cell(cut)] });
    const table = new Table({ width: { size: 12240, type: WidthType.DXA }, columnWidths: [12240], borders: NOBORDERS, rows: [row(true), row(false)] });
    return { properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: 0, bottom: 0, left: 0, right: 0, header: 0, footer: 0 } } }, children: [table, new Paragraph({ spacing: { before: 0, after: 0, line: 20, lineRule: LineRuleType.EXACT }, children: [new TextRun({ text: '', size: 2 })] })] };
  });

  const doc = new Document({ creator: 'Collège Albert Camus', title: 'Document pédagogique', styles: { default: { document: { run: { font: 'Arial', size: 21 } } } }, sections });
  return Buffer.from(await Packer.toBuffer(doc));
}

module.exports = { renderDocx };
