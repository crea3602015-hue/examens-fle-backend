// Moteur de mise en page commun à l'aperçu, au PDF et au Word : les mêmes retours à la ligne
// et les mêmes tailles de police partout, pour un aperçu fidèle au document téléchargé.
const { PDFDocument, StandardFonts } = require('pdf-lib');
const { buildBlocks, PROFILES, FILL_HEAD, FILL_BAND, WHITE } = require('./content');

const LH = 1.28; // interligne

async function makeMeasurer() {
  const pdf = await PDFDocument.create();
  const fonts = { regular: await pdf.embedFont(StandardFonts.Helvetica), bold: await pdf.embedFont(StandardFonts.HelveticaBold), italic: await pdf.embedFont(StandardFonts.HelveticaOblique) };
  const cache = new Map();
  /** Remplace les caractères que la police standard ne sait pas afficher. */
  function safe(s) {
    return require('./text').noDash(s).replace(/[\u202f\u2009\u200a]/g, ' ').replace(/[\u2011]/g, '-').replace(/[\u2192\u2794]/g, '-').split('').map(ch => {
      if (cache.has(ch)) return cache.get(ch);
      let out = ch;
      if (/[\uE000-\uF8FF\u200b-\u200f\u2028\u2029\u00ad\ufeff\ufe0f\ud800-\udfff]/.test(ch)) out = '';
      else { try { fonts.regular.encodeText(ch); } catch (e) { out = ch === '\n' ? '\n' : '?'; } }
      cache.set(ch, out); return out;
    }).join('');
  }
  const fontFor = b => (b.bold ? fonts.bold : b.italic ? fonts.italic : fonts.regular);
  function wrap(b, size, width) {
    const font = fontFor(b), out = [];
    safe(b.text).split('\n').forEach(par => {
      let line = '';
      const lead = (par.match(/^ +/) || [''])[0].slice(0, 12); // retrait voulu au début d'un paragraphe
      par.split(/\s+/).filter(Boolean).forEach(word => {
        const test = line ? line + ' ' + word : lead + word;
        if (font.widthOfTextAtSize(test, size) <= width) { line = test; return; }
        if (line) out.push(line);
        // mot plus long que la ligne : on le coupe
        let w = word;
        while (font.widthOfTextAtSize(w, size) > width && w.length > 1) { let i = w.length - 1; while (i > 1 && font.widthOfTextAtSize(w.slice(0, i), size) > width) i--; out.push(w.slice(0, i)); w = w.slice(i); }
        line = w;
      });
      out.push(line);
    });
    return out;
  }
  return { fonts, safe, wrap };
}


const isTbl = b => b.kind === 'trow' || b.kind === 'tcat' || b.kind === 'thead';
const cellHeight = (c, padY) => 2 * padY + c.lines.reduce((a, l) => a + l.size * LH + (l.gap || 0), 0);

/** Transforme un tableau en lignes mesurées (en-tête, bandeaux de rubrique, lignes). */
function measureTable(table, s, P, M) {
  const padX = Math.round(P.padX * s * 100) / 100, padY = Math.round(P.padY * s * 100) / 100;
  const colW = table.cols.map(f => f * P.frame.w);
  const build = (kind, cellsItems, span, extra) => {
    const widths = span ? [P.frame.w] : colW;
    const cells = cellsItems.map((items, ci) => {
      const lines = [];
      items.filter(i => String(i.text || '').trim()).forEach(item => {
        const size = Math.round(item.size * s * 100) / 100, indent = (item.indent || 0) * s;
        const wrapped = M.wrap({ text: item.text, bold: item.bold, italic: item.italic }, size, widths[ci] - 2 * padX - indent);
        wrapped.forEach((ln, li) => lines.push({ text: ln, size, bold: !!item.bold, italic: !!item.italic, color: item.color, link: item.link || null, indent, gap: li === wrapped.length - 1 ? Math.round(1.6 * s * 100) / 100 : 0 }));
      });
      return { lines };
    });
    const minH = 2 * padY + 8 * s * LH;
    return { kind, cols: widths, cells, padX, padY, before: 0, after: 0, keep: kind !== 'trow', height: Math.max(minH, ...cells.map(c => cellHeight(c, padY))), ...extra };
  };
  const out = [build('thead', table.titles.map(tt => [{ text: tt, size: P.label + 0.5, bold: true, color: WHITE }]), false, { fill: FILL_HEAD })];
  table.rows.forEach(r => out.push(r.type === 'cat' ? build('tcat', r.cells, true, { fill: FILL_BAND }) : build('trow', r.cells, false, { ref: r.ref })));
  return out;
}

/** Coupe une ligne de tableau trop haute : on garde ce qui tient dans « room » points. */
function splitRow(b, room) {
  const head = [], rest = [];
  b.cells.forEach(c => {
    let h = 2 * b.padY, k = 0;
    while (k < c.lines.length && (h + c.lines[k].size * LH + (c.lines[k].gap || 0) <= room || k === 0)) { h += c.lines[k].size * LH + (c.lines[k].gap || 0); k++; }
    head.push({ lines: c.lines.slice(0, k) }); rest.push({ lines: c.lines.slice(k) });
  });
  const mk = cells => ({ ...b, cells, height: Math.max(...cells.map(c => cellHeight(c, b.padY))) });
  return [mk(head), rest.some(c => c.lines.length) ? mk(rest) : null];
}

function scaleBlock(b, s) {
  return { ...b, size: Math.round(b.size * s * 100) / 100, before: Math.round((b.before || 0) * s * 100) / 100, after: Math.round((b.after || 0) * s * 100) / 100 };
}

function measureBlocks(blocks, s, P, M) {
  const out = [];
  blocks.forEach(b => {
    if (b.kind === 'table') { measureTable(b.table, s, P, M).forEach(r => out.push(r)); return; }
    const sb = scaleBlock(b, s);
    if (b.kind === 'rule') { out.push({ ...sb, lines: [], height: sb.before + 1 + sb.after }); return; }
    const width = P.frame.w - (b.indent || 0) * s - (b.header ? P.headerReserve : 0);
    const lines = M.wrap(sb, sb.size, width);
    out.push({ ...sb, lines, height: sb.before + lines.length * sb.size * LH + sb.after });
  });
  return out;
}

/** Renvoie { scale, pages:[{blocks:[...]}], pageCount, overflow } pour une version ('parents' | 'eleves'). */
async function layoutDocument(doc, version) {
  const P = PROFILES[version]; if (!P) throw new Error('Version inconnue.');
  const M = await makeMeasurer();
  const blocks = buildBlocks(doc, P);
  const total = ms => ms.reduce((a, b) => a + b.height, 0);
  // 1) on cherche la plus grande taille de police qui tient sur UNE page
  let scale = P.maxScale || 1, measured = measureBlocks(blocks, scale, P, M);
  while (total(measured) > P.frame.h && scale > P.minScale + 1e-9) { scale = Math.max(P.minScale, Math.round((scale - 0.02) * 100) / 100); measured = measureBlocks(blocks, scale, P, M); }
  // 2) si ça ne tient toujours pas : on coupe proprement en plusieurs pages (jamais au milieu d'un titre)
  const pages = [];
  if (total(measured) <= P.frame.h) pages.push({ blocks: measured });
  else {
    let cur = [], used = 0;
    const theadB = measured.find(x => x.kind === 'thead');
    const flush = () => { if (cur.length) pages.push({ blocks: cur }); cur = []; used = 0; };
    const continued = () => {
      const small = scaleBlock({ ...blocks[0], size: Math.max(9, blocks[0].size * 0.7), text: blocks[0].text + ' ' + (blocks[0].suite || '(suite)') }, scale);
      small.lines = M.wrap(small, small.size, P.frame.w - P.headerReserve); small.height = small.before + small.lines.length * small.size * LH + small.after; return small;
    };
    const startPage = withHead => {
      flush(); const c = continued(); cur = [c]; used = c.height;
      if (withHead && theadB) { cur.push(theadB); used += theadB.height; }
    };
    measured.forEach(b => {
      if (used + b.height > P.frame.h && cur.length && !(isTbl(b) && b.kind === 'trow' && b.height > P.frame.h / 2)) {
        // un titre, un bandeau ou une étiquette ne reste jamais seul en bas de page
        const carry = []; while (cur.length > 1 && cur[cur.length - 1].keep) carry.unshift(cur.pop());
        startPage(isTbl(b)); carry.filter(x => x.kind !== 'thead').forEach(x => { cur.push(x); used += x.height; });
      }
      let blk = b;
      // ligne de tableau plus haute que le reste de la page : on la répartit sur plusieurs pages
      while (blk.kind === 'trow' && used + blk.height > P.frame.h) {
        const room = P.frame.h - used;
        if (room < 2 * blk.padY + 10 && cur.length > 1) { startPage(true); continue; }
        const [head, rest] = splitRow(blk, room);
        cur.push(head); used += head.height;
        if (!rest) { blk = null; break; }
        startPage(true); blk = rest;
      }
      if (!blk) return;
      // paragraphe trop long pour le reste de la page : on le coupe ligne par ligne
      while (blk.lines && blk.kind !== 'trow' && used + blk.height > P.frame.h && blk.lines.length > 2) {
        const room = Math.floor((P.frame.h - used - blk.before) / (blk.size * LH));
        if (room < 2) break;
        const head = { ...blk, lines: blk.lines.slice(0, room), after: 0, height: blk.before + room * blk.size * LH };
        cur.push(head); startPage(false);
        blk = { ...blk, before: 0, lines: blk.lines.slice(room), height: (blk.lines.length - room) * blk.size * LH + blk.after };
      }
      cur.push(blk); used += blk.height;
    });
    flush();
  }
  return { version, scale, pageCount: pages.length, fitsOnOnePage: pages.length === 1, frame: P.frame, page: P.page, margin: P.margin, logoSize: P.logo, copies: P.copies, pages, lineHeight: LH };
}

module.exports = { layoutDocument, makeMeasurer, LH };
