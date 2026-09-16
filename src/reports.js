const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');
const { scoreColorArgb, scoreColorHex, scoreLabel } = require('./scoreColors');

/* =========================================================
   Filename helper — encodes classe/groupe (or niveau for
   secondaire) automatically, as requested.
   ========================================================= */
function reportFilename(base, { classe, groupe, niveau, isSecondaire }) {
  const parts = [base];
  if (isSecondaire) {
    if (niveau) parts.push(niveau);
  } else {
    if (classe) parts.push(classe);
    if (groupe) parts.push(groupe);
  }
  return parts
    .join('_')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // enlève les accents
    .replace(/[^a-zA-Z0-9_\-]+/g, '-')
    .replace(/-+/g, '-')
    .toLowerCase();
}

/* =========================================================
   Export Excel — résultats de toute une classe
   ========================================================= */
async function buildResultsXlsx({ examTitle, matiere, teacherName, rows, sectionStats }) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Résultats');
  ws.columns = [{ width: 24 }, { width: 12 }, { width: 12 }, { width: 10 }, { width: 10 }, { width: 10 }, { width: 12 }];

  ws.mergeCells('A1:G1');
  ws.getCell('A1').value = examTitle;
  ws.getCell('A1').font = { size: 16, bold: true };
  ws.getCell('A2').value = `Matière : ${matiere}`;
  ws.getCell('A3').value = `Professeur : ${teacherName || '—'}`;
  ws.getCell('A4').value = `${rows.length} élève(s)`;

  const headerRowIdx = 6;
  const header = ws.getRow(headerRowIdx);
  header.values = ['Élève', 'Classe', 'Groupe', 'Total', 'Max', '%', 'Statut'];
  header.font = { bold: true };
  header.eachCell(c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE3EAFB' } }; });

  rows.forEach((r, i) => {
    const row = ws.getRow(headerRowIdx + 1 + i);
    row.values = [r.nom, r.classe || '', r.groupe || '', r.total, r.max, r.pct !== null ? r.pct + '%' : '—', scoreLabel(r.pct)];
    const pctCell = row.getCell(6);
    pctCell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    pctCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: scoreColorArgb(r.pct) } };
    pctCell.alignment = { horizontal: 'center' };
  });

  // Diagramme de réussite — barres de cellules colorées (fiable, sans dépendance
  // graphique externe) représentant le pourcentage de réussite par section.
  if (sectionStats && sectionStats.length) {
    let r = headerRowIdx + rows.length + 3;
    ws.getCell(`A${r}`).value = 'Diagramme de réussite par section';
    ws.getCell(`A${r}`).font = { bold: true, size: 13 };
    r++;
    sectionStats.forEach(s => {
      ws.getCell(`A${r}`).value = s.titre;
      const barWidth = Math.max(1, Math.round(s.pct / 5)); // 20 cases = 100%
      for (let c = 0; c < 20; c++) {
        const cell = ws.getRow(r).getCell(2 + c);
        if (c < barWidth) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: scoreColorArgb(s.pct) } };
      }
      ws.getCell(`W${r}`).value = s.pct + '%';
      r++;
    });
  }

  return wb.xlsx.writeBuffer();
}

/* =========================================================
   Export PDF — résultats de toute une classe
   ========================================================= */
function buildResultsPdf({ examTitle, matiere, teacherName, rows, sectionStats }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 40, size: 'A4' });
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.fontSize(20).font('Helvetica-Bold').text(examTitle);
    doc.fontSize(11).font('Helvetica').fillColor('#555')
      .text(`Matière : ${matiere}`)
      .text(`Professeur : ${teacherName || '—'}`)
      .text(`${rows.length} élève(s)`);
    doc.moveDown();
    doc.fillColor('#000');

    const colX = [40, 220, 300, 370, 420, 470];
    const headers = ['Élève', 'Classe', 'Groupe', 'Total', 'Max', '%'];
    let y = doc.y + 10;
    doc.font('Helvetica-Bold').fontSize(10);
    headers.forEach((h, i) => doc.text(h, colX[i], y));
    y += 16;
    doc.font('Helvetica').fontSize(10);
    rows.forEach(r => {
      if (y > 760) { doc.addPage(); y = 40; }
      doc.fillColor('#000').text(r.nom, colX[0], y, { width: 170 });
      doc.text(r.classe || '—', colX[1], y);
      doc.text(r.groupe || '—', colX[2], y);
      doc.text(String(r.total), colX[3], y);
      doc.text(String(r.max), colX[4], y);
      doc.fillColor(scoreColorHex(r.pct)).font('Helvetica-Bold').text(r.pct !== null ? r.pct + '%' : '—', colX[5], y);
      doc.font('Helvetica').fillColor('#000');
      y += 16;
    });

    if (sectionStats && sectionStats.length) {
      y += 20;
      if (y > 700) { doc.addPage(); y = 40; }
      doc.font('Helvetica-Bold').fontSize(13).text('Diagramme de réussite par section', 40, y);
      y += 22;
      const barMaxWidth = 300;
      sectionStats.forEach(s => {
        if (y > 760) { doc.addPage(); y = 40; }
        doc.font('Helvetica').fontSize(10).fillColor('#000').text(s.titre, 40, y, { width: 150 });
        doc.rect(200, y, barMaxWidth, 12).fill('#EEEEEE');
        doc.rect(200, y, barMaxWidth * (s.pct / 100), 12).fill(scoreColorHex(s.pct));
        doc.fillColor('#000').text(s.pct + '%', 200 + barMaxWidth + 8, y);
        y += 20;
      });
    }

    doc.end();
  });
}

/* =========================================================
   Export Excel/PDF — copie détaillée d'un seul élève
   ========================================================= */
async function buildAttemptXlsx({ examTitle, matiere, teacherName, student, total, max, pct, sections }) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Copie');
  ws.columns = [{ width: 40 }, { width: 40 }];

  ws.mergeCells('A1:B1');
  ws.getCell('A1').value = examTitle;
  ws.getCell('A1').font = { size: 16, bold: true };
  ws.getCell('A2').value = `Matière : ${matiere}`;
  ws.getCell('A3').value = `Élève : ${student.nom}`;
  ws.getCell('A4').value = student.isSecondaire ? `Niveau : ${student.niveau || '—'}` : `Classe : ${student.classe || '—'} · Groupe : ${student.groupe || '—'}`;
  ws.getCell('A5').value = `Professeur : ${teacherName || '—'}`;

  const totalCell = ws.getCell('A7');
  totalCell.value = `Total : ${total}/${max}`;
  totalCell.font = { bold: true, size: 13 };
  const pctCell = ws.getCell('B7');
  pctCell.value = pct !== null ? pct + '%' : 'Non corrigé';
  pctCell.font = { bold: true, size: 13, color: { argb: 'FFFFFFFF' } };
  pctCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: scoreColorArgb(pct) } };

  let r = 9;
  sections.forEach(sec => {
    ws.getCell(`A${r}`).value = `${sec.titre} — ${sec.pct}%`;
    ws.getCell(`A${r}`).font = { bold: true };
    const barWidth = Math.max(0, Math.round(sec.pct / 5));
    for (let c = 0; c < 20; c++) {
      const cell = ws.getRow(r).getCell(3 + c);
      if (c < barWidth) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: scoreColorArgb(sec.pct) } };
    }
    r += 1;
    (sec.questions || []).forEach(q => {
      ws.getCell(`A${r}`).value = q.enonce;
      ws.getCell(`B${r}`).value = q.detail;
      if (q.isCorrect === true) ws.getCell(`B${r}`).font = { color: { argb: 'FF2F7D46' } };
      else if (q.isCorrect === false) ws.getCell(`B${r}`).font = { color: { argb: 'FFB3261E' } };
      r += 1;
    });
    r += 1;
  });

  return wb.xlsx.writeBuffer();
}

function buildAttemptPdf({ examTitle, matiere, teacherName, student, total, max, pct, sections }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 40, size: 'A4' });
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.fontSize(20).font('Helvetica-Bold').text(examTitle);
    doc.fontSize(11).font('Helvetica').fillColor('#555')
      .text(`Matière : ${matiere}`)
      .text(`Élève : ${student.nom}`)
      .text(student.isSecondaire ? `Niveau : ${student.niveau || '—'}` : `Classe : ${student.classe || '—'} · Groupe : ${student.groupe || '—'}`)
      .text(`Professeur : ${teacherName || '—'}`);
    doc.moveDown();

    doc.fillColor('#000').font('Helvetica-Bold').fontSize(16).text(`Total : ${total}/${max}`, { continued: true });
    doc.fillColor(scoreColorHex(pct)).text(`  (${pct !== null ? pct + '%' : 'Non corrigé'})`);
    doc.fillColor('#000');
    doc.moveDown();

    doc.font('Helvetica-Bold').fontSize(13).text('Points à travailler');
    doc.moveDown(0.3);
    let y = doc.y;
    const barMaxWidth = 300;
    sections.forEach(sec => {
      if (y > 720) { doc.addPage(); y = 40; }
      doc.font('Helvetica').fontSize(10).fillColor('#000').text(sec.titre, 40, y, { width: 150 });
      doc.rect(200, y, barMaxWidth, 12).fill('#EEEEEE');
      doc.rect(200, y, barMaxWidth * (sec.pct / 100), 12).fill(scoreColorHex(sec.pct));
      doc.fillColor('#000').text(sec.pct + '%', 200 + barMaxWidth + 8, y);
      y += 20;
    });
    doc.y = y + 15;

    sections.forEach(sec => {
      if (doc.y > 700) doc.addPage();
      doc.font('Helvetica-Bold').fontSize(12).text(sec.titre);
      (sec.questions || []).forEach(q => {
        if (doc.y > 750) doc.addPage();
        doc.font('Helvetica-Bold').fontSize(10).fillColor('#000').text(q.enonce || '(question)', { width: 500 });
        doc.font('Helvetica').fontSize(9).fillColor(q.isCorrect === true ? '#2F7D46' : q.isCorrect === false ? '#B3261E' : '#555')
          .text(q.detail || '', { width: 500 });
        doc.fillColor('#000').moveDown(0.4);
      });
      doc.moveDown(0.4);
    });

    doc.end();
  });
}

module.exports = { reportFilename, buildResultsXlsx, buildResultsPdf, buildAttemptXlsx, buildAttemptPdf };
