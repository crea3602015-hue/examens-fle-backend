// Examen au format Word (.docx) : feuille de l'élève, ou version professeur avec les réponses.
// Le logo propre à l'examen et les images des questions sont intégrés au fichier.
const {
  Document, Packer, Paragraph, TextRun, ImageRun, Table, TableRow, TableCell, WidthType, BorderStyle, AlignmentType, ShadingType,
} = require('docx');
const { sectionPoints, examTotalPoints } = require('./grading');
const { imageInfo } = require('./peda/renderPdf');
const { noDash } = require('./peda/text');

const LABELS = {
  choix_unique: 'Choix unique', choix_multiple: 'Choix multiples', vrai_faux: 'Vrai ou faux', texte_court: 'Réponse courte', texte_long: 'Réponse rédigée',
  texte_trous: 'Texte à trous', association: 'Relier', association_images: 'Relier les images', classement: 'Remettre dans l\'ordre',
  classification: 'Classer', image_choix: 'Choix d\'image', production_orale: 'Production orale', correction_manuelle: 'Réponse rédigée', dessin: 'Dessin',
};
const t = s => noDash(String(s == null ? '' : s));
const F = 'Calibri';
function run(text, o = {}) { return new TextRun({ text: t(text), font: F, size: o.size || 22, bold: !!o.bold, italics: !!o.italics, color: o.color }); }
function para(text, o = {}) {
  const lines = t(text).split('\n');
  return new Paragraph({
    spacing: { before: o.before || 0, after: o.after === undefined ? 80 : o.after }, indent: o.indent ? { left: o.indent } : undefined, alignment: o.align,
    border: o.border, children: lines.flatMap((l, i) => [run(l, o), ...(i < lines.length - 1 ? [new TextRun({ break: 1 })] : [])]),
  });
}
const NB = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
const NOB = { top: NB, bottom: NB, left: NB, right: NB };

function imgRun(entry, info, maxW, maxH) {
  if (!entry || !info) return null;
  const k = Math.min(maxW / info.width, maxH / info.height, 1);
  return new ImageRun({ type: /png/i.test(entry.mime) ? 'png' : 'jpg', data: entry.buffer, transformation: { width: Math.max(1, Math.round(info.width * k)), height: Math.max(1, Math.round(info.height * k)) } });
}

/** images : { [id fichier] : { buffer, mime } }  logo : { buffer, mime } | null */
async function buildExamDocx(exam, { images = {}, logo = null, answers = false } = {}) {
  const body = [];
  const infos = {};
  for (const id of Object.keys(images)) infos[id] = await imageInfo(images[id]);
  const logoInfo = logo ? await imageInfo(logo) : null;

  // En-tête : titre à gauche, logo à droite
  const left = [para(exam.titre || 'Examen', { size: 36, bold: true, after: 60 }),
    para(`Niveau : ${exam.niveau || 'N/A'}  |  Matière : ${exam.matiere || 'Français'}  |  Total : ${examTotalPoints(exam)} points${exam.duree ? '  |  Durée : ' + exam.duree + ' min' : ''}${answers ? '  |  VERSION PROFESSEUR (avec les réponses)' : ''}`, { size: 20, color: '555555', after: 40 })];
  const logoRun = logo ? imgRun(logo, logoInfo, 110, 70) : null;
  const right = logoRun ? [new Paragraph({ alignment: AlignmentType.RIGHT, children: [logoRun] })] : [new Paragraph({ children: [] })];
  body.push(new Table({
    width: { size: 9360, type: WidthType.DXA }, columnWidths: [7200, 2160], borders: { ...NOB, insideHorizontal: NB, insideVertical: NB },
    rows: [new TableRow({ children: [
      new TableCell({ width: { size: 7200, type: WidthType.DXA }, borders: NOB, children: left }),
      new TableCell({ width: { size: 2160, type: WidthType.DXA }, borders: NOB, children: right }),
    ] })],
  }));
  if (!answers) body.push(para('Nom : ______________________________   Classe / niveau : ______________   Date : ______________', { before: 160, after: 120, size: 21 }));

  (exam.sections || []).forEach((sec, si) => {
    body.push(para(`${si + 1}. ${sec.titre || ''}  (${sectionPoints(sec)} points)`, { size: 28, bold: true, before: 260, after: 80, color: '14514A',
      border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: '14514A', space: 2 } } }));
    if (sec.consigne) body.push(para(sec.consigne, { italics: true, after: 100 }));
    (sec.questions || []).forEach((q, qi) => {
      if (q.passage) body.push(para(q.passage, { indent: 240, color: '333333', after: 100, border: { left: { style: BorderStyle.SINGLE, size: 12, color: '999999', space: 8 } } }));
      body.push(para(`Question ${qi + 1}  (${q.points} pt${Number(q.points) > 1 ? 's' : ''})  ${LABELS[q.type] ? '- ' + LABELS[q.type] : ''}`, { size: 19, color: '777777', after: 20, before: 100 }));
      body.push(para(q.enonce || '', { bold: true, after: 60 }));
      const mid = (/\/api\/uploads\/([^/?#]+)/.exec(q.media || '') || [])[1];
      if (mid && images[mid]) { const r = imgRun(images[mid], infos[mid], 320, 220); if (r) body.push(new Paragraph({ spacing: { after: 80 }, children: [r] })); }
      switch (q.type) {
        case 'choix_unique': case 'choix_multiple':
          (q.options || []).forEach((o, i) => {
            const good = q.type === 'choix_unique' ? q.correct === i : (q.correct || []).includes(i);
            body.push(para(`${answers && good ? '[X]' : '[  ]'}  ${o}`, { indent: 360, after: 30, bold: answers && good, color: answers && good ? '2F7D46' : undefined }));
          }); break;
        case 'vrai_faux':
          body.push(para(`${answers && q.correct === true ? '[X]' : '[  ]'} Vrai        ${answers && q.correct === false ? '[X]' : '[  ]'} Faux`, { indent: 360, bold: answers, color: answers ? '2F7D46' : undefined })); break;
        case 'texte_court':
          body.push(para(answers ? `Réponse : ${q.correct || ''}` : '________________________________________', { indent: 360, bold: answers, color: answers ? '2F7D46' : undefined })); break;
        case 'texte_trous':
          body.push(para(q.textTemplate || '', { indent: 360 }));
          if (answers) body.push(para(`Réponses : ${(q.correct || '').split(',').map(x => x.trim()).join('  /  ')}`, { indent: 360, bold: true, color: '2F7D46' })); break;
        case 'association': {
          const L = (q.pairs || []).map(p => p.left); const Rr = (q.pairs || []).map(p => p.right);
          const shuf = Rr.map((x, i) => [x, (i * 7 + 3) % Math.max(1, Rr.length)]).sort((a, b) => a[1] - b[1]).map(x => x[0]);
          const cell = (txt, w) => new TableCell({ width: { size: w, type: WidthType.DXA }, borders: NOB, children: [para(txt, { after: 40 })] });
          body.push(new Table({ width: { size: 9000, type: WidthType.DXA }, columnWidths: [4200, 600, 4200], borders: { ...NOB, insideHorizontal: NB, insideVertical: NB },
            rows: L.map((l, i) => new TableRow({ children: [cell(`${i + 1}. ${l}`, 4200), cell('', 600), cell(`${String.fromCharCode(65 + i)}. ${shuf[i] || ''}`, 4200)] })) }));
          if (answers) body.push(para('Réponses : ' + (q.pairs || []).map(p => `${p.left} = ${p.right}`).join(' ; '), { indent: 360, bold: true, color: '2F7D46', before: 60 }));
          break;
        }
        case 'classement':
          body.push(para('Éléments : ' + (q.items || []).join('  |  '), { indent: 360 }));
          if (answers) body.push(para('Ordre correct : ' + (q.items || []).join(' > '), { indent: 360, bold: true, color: '2F7D46' })); break;
        case 'classification':
          body.push(para('Catégories : ' + (q.categories || []).join('  |  '), { indent: 360, italics: true }));
          (q.elements || []).forEach(e => body.push(para(`${e.texte} : ${answers ? e.categorie : '________'}`, { indent: 360, after: 30, bold: answers, color: answers ? '2F7D46' : undefined })));
          break;
        case 'production_orale':
          (q.criteres || []).forEach(c => body.push(para(`${c.titre}  ____ / ${c.points}`, { indent: 360, after: 30 }))); break;
        default:
          if (answers && q.corrige) body.push(para('Corrigé : ' + q.corrige, { indent: 360, bold: true, color: '2F7D46' }));
          else body.push(para('_______________________________________________\n_______________________________________________', { indent: 360 }));
      }
    });
  });
  const doc = new Document({ creator: 'Examens FLE', title: exam.titre || 'Examen', sections: [{ properties: { page: { margin: { top: 1000, bottom: 1000, left: 1100, right: 1100 } } }, children: body }] });
  return Packer.toBuffer(doc);
}
module.exports = { buildExamDocx };
