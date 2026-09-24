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

/** Dessine le logo de l'établissement en haut à droite de la page courante, si fourni. */
function drawLogo(doc, logoBuffer) {
  if (!logoBuffer) return;
  try { doc.image(logoBuffer, doc.page.width - 100, 30, { width: 60 }); } catch (e) { /* format non supporté — on continue sans */ }
}

/* =========================================================
   Export Excel — résultats de toute une classe
   ========================================================= */
async function buildResultsXlsx({ examTitle, matiere, teacherName, rows, sectionStats, logoBuffer, logoExt }) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Résultats');
  ws.columns = [{ width: 24 }, { width: 12 }, { width: 12 }, { width: 10 }, { width: 10 }, { width: 10 }, { width: 12 }];

  if (logoBuffer) {
    try {
      const imgId = wb.addImage({ buffer: logoBuffer, extension: logoExt || 'png' });
      ws.addImage(imgId, { tl: { col: 5.2, row: 0.1 }, ext: { width: 60, height: 60 } });
    } catch (e) { /* logo optionnel — ne bloque jamais l'export */ }
  }

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
function buildResultsPdf({ examTitle, matiere, teacherName, rows, sectionStats, logoBuffer }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 40, size: 'A4' });
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    drawLogo(doc, logoBuffer);

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

/** Fetches a remote image and returns a Buffer, or null on any failure (never
    throws — a broken image link must not break the whole PDF). */
async function fetchImageBuffer(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const arrayBuf = await res.arrayBuffer();
    return Buffer.from(arrayBuf);
  } catch (e) {
    return null;
  }
}

/** Draws one student's full detailed sheet (header, total, chart, and every
    question with the student's answer + correct answer + embedded image when
    the question had one) onto an already-open pdfkit document at the current
    page. Used by both the single-student export and the combined bulk export. */
async function drawStudentSheet(doc, { examTitle, matiere, teacherName, student, total, max, pct, sections, logoBuffer }) {
  drawLogo(doc, logoBuffer);
  doc.fontSize(18).font('Helvetica-Bold').fillColor('#000').text(examTitle);
  doc.fontSize(10).font('Helvetica').fillColor('#555')
    .text(`Matière : ${matiere}`)
    .text(`Élève : ${student.nom}`)
    .text(student.isSecondaire ? `Niveau : ${student.niveau || '—'}` : `Classe : ${student.classe || '—'} · Groupe : ${student.groupe || '—'}`)
    .text(`Professeur : ${teacherName || '—'}`);
  doc.moveDown(0.5);

  doc.fillColor('#000').font('Helvetica-Bold').fontSize(15).text(`Total : ${total}/${max}`, { continued: true });
  doc.fillColor(scoreColorHex(pct)).text(`  (${pct !== null ? pct + '%' : 'Non corrigé'})`);
  doc.fillColor('#000');
  doc.moveDown(0.4);

  // Diagramme de réussite par section
  let y = doc.y;
  const barMaxWidth = 260;
  sections.forEach(sec => {
    if (y > 740) { doc.addPage(); y = 40; }
    doc.font('Helvetica').fontSize(9).fillColor('#000').text(sec.titre, 40, y, { width: 140 });
    doc.rect(190, y, barMaxWidth, 10).fill('#EEEEEE');
    doc.rect(190, y, barMaxWidth * (sec.pct / 100), 10).fill(scoreColorHex(sec.pct));
    doc.fillColor('#000').fontSize(9).text(sec.pct + '%', 190 + barMaxWidth + 8, y);
    y += 16;
  });
  doc.y = y + 12;
  doc.x = 40;

  // Détail question par question, avec l'image de la question si elle en avait une
  for (const sec of sections) {
    if (doc.y > 700) doc.addPage();
    doc.font('Helvetica-Bold').fontSize(11).fillColor('#000').text(sec.titre, 40, doc.y, { width: 500 });
    for (const q of (sec.questions || [])) {
      if (doc.y > 740) doc.addPage();
      doc.font('Helvetica-Bold').fontSize(9).fillColor('#000').text(q.enonce || '(question)', 40, doc.y, { width: 500 });
      if (q.media) {
        const buf = await fetchImageBuffer(q.media);
        if (buf) {
          if (doc.y > 620) doc.addPage();
          try { doc.image(buf, 40, doc.y, { fit: [200, 150] }); doc.y += 155; doc.x = 40; }
          catch (e) { /* format non supporté par pdfkit — on continue sans planter */ }
        }
      }
      doc.font('Helvetica').fontSize(9).fillColor(q.isCorrect === true ? '#2F7D46' : q.isCorrect === false ? '#B3261E' : '#555')
        .text(q.detail || '', 40, doc.y, { width: 500 });
      doc.fillColor('#000').moveDown(0.4);
      doc.x = 40;
    }
    doc.moveDown(0.4);
  }
}

async function buildAttemptPdf(data) {
  const doc = new PDFDocument({ margin: 40, size: 'A4' });
  const chunks = [];
  doc.on('data', c => chunks.push(c));
  const done = new Promise((resolve, reject) => { doc.on('end', () => resolve(Buffer.concat(chunks))); doc.on('error', reject); });
  await drawStudentSheet(doc, data);
  doc.end();
  return done;
}

async function buildBulkAttemptsPdf({ examTitle, matiere, teacherName, attempts, logoBuffer }) {
  const doc = new PDFDocument({ margin: 40, size: 'A4' });
  const chunks = [];
  doc.on('data', c => chunks.push(c));
  const done = new Promise((resolve, reject) => { doc.on('end', () => resolve(Buffer.concat(chunks))); doc.on('error', reject); });
  for (let i = 0; i < attempts.length; i++) {
    if (i > 0) doc.addPage();
    await drawStudentSheet(doc, { examTitle, matiere, teacherName, logoBuffer, ...attempts[i] });
  }
  doc.end();
  return done;
}

function buildProjectDescriptionPdf({ project, logoBuffer }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 40, size: 'A4' });
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    drawLogo(doc, logoBuffer);

    doc.fontSize(20).font('Helvetica-Bold').fillColor('#000').text(project.titre);
    doc.fontSize(10).font('Helvetica').fillColor('#555').text(`Niveau : ${project.niveau} · Matière : ${project.matiere} — Total : ${project.maxTotal} points`);
    doc.moveDown(0.6);
    if (project.description) {
      doc.font('Helvetica').fontSize(11).fillColor('#000').text(project.description, { width: 500 });
      doc.moveDown(0.6);
    }

    doc.font('Helvetica-Bold').fontSize(13).text('Grille d\'évaluation');
    doc.moveDown(0.4);
    // En-tête de tableau
    let y = doc.y;
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#555');
    doc.text('Critère', 40, y, { width: 320 });
    doc.text('Points', 380, y, { width: 100 });
    y += 18;
    doc.moveTo(40, y).lineTo(500, y).strokeColor('#DDD').stroke();
    y += 10;
    doc.font('Helvetica').fontSize(10).fillColor('#000');
    (project.criteria || []).forEach(c => {
      if (y > 740) { doc.addPage(); y = 40; }
      doc.text(c.titre, 40, y, { width: 320 });
      doc.text(`/ ${c.points}`, 380, y, { width: 100 });
      y += 26;
    });
    doc.y = y;

    doc.end();
  });
}

module.exports = { reportFilename, buildResultsXlsx, buildResultsPdf, buildAttemptXlsx, buildAttemptPdf, buildBulkAttemptsPdf, buildProjectEntryPdf, buildBulkProjectEntriesPdf, buildGlobalReportPdf, buildProjectDescriptionPdf };

/* =========================================================
   Export PDF — copie d'un projet (grille d'évaluation) pour un élève
   Espacement généreux entre les critères (contrairement à un tableau
   serré) pour rester lisible.
   ========================================================= */
async function drawProjectEntrySheet(doc, { projectTitle, matiere, teacherName, student, total, max, pct, criteriaScores, logoBuffer }) {
  drawLogo(doc, logoBuffer);
  doc.fontSize(18).font('Helvetica-Bold').fillColor('#000').text(projectTitle);
  doc.fontSize(10).font('Helvetica').fillColor('#555')
    .text(`Matière : ${matiere}`)
    .text(`Élève : ${student.nom}`)
    .text(student.isSecondaire ? `Niveau : ${student.niveau || '—'}` : `Classe : ${student.classe || '—'} · Groupe : ${student.groupe || '—'}`)
    .text(`Professeur : ${teacherName || '—'}`);
  doc.moveDown(0.6);

  doc.fillColor('#000').font('Helvetica-Bold').fontSize(15).text(`Total : ${total}/${max}`, { continued: true });
  doc.fillColor(scoreColorHex(pct)).text(`  (${pct !== null ? pct + '%' : 'Non corrigé'})`);
  doc.fillColor('#000');
  doc.moveDown(1);

  doc.font('Helvetica-Bold').fontSize(12).text('Grille d\'évaluation');
  doc.moveDown(0.4);
  const rowH = 34; // espacement généreux — corrige le chevauchement signalé
  const barMaxWidth = 220;
  criteriaScores.forEach(c => {
    if (doc.y > 730) { doc.addPage(); doc.y = 40; }
    const y = doc.y;
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#000').text(c.titre, 40, y, { width: 220 });
    doc.font('Helvetica').fontSize(10).fillColor('#000').text(`${c.given !== null && c.given !== undefined ? c.given : '—'} / ${c.points}`, 270, y, { width: 60 });
    const pctC = c.points ? Math.round((100 * (c.given || 0)) / c.points) : 0;
    doc.rect(340, y + 2, barMaxWidth, 10).fill('#EEEEEE');
    doc.rect(340, y + 2, barMaxWidth * (pctC / 100), 10).fill(scoreColorHex(pctC));
    doc.y = y + rowH;
    doc.x = 40;
  });
}

async function buildProjectEntryPdf(data) {
  const doc = new PDFDocument({ margin: 40, size: 'A4' });
  const chunks = [];
  doc.on('data', c => chunks.push(c));
  const done = new Promise((resolve, reject) => { doc.on('end', () => resolve(Buffer.concat(chunks))); doc.on('error', reject); });
  await drawProjectEntrySheet(doc, data);
  doc.end();
  return done;
}

async function buildBulkProjectEntriesPdf({ projectTitle, matiere, teacherName, entries, logoBuffer }) {
  const doc = new PDFDocument({ margin: 40, size: 'A4' });
  const chunks = [];
  doc.on('data', c => chunks.push(c));
  const done = new Promise((resolve, reject) => { doc.on('end', () => resolve(Buffer.concat(chunks))); doc.on('error', reject); });
  for (let i = 0; i < entries.length; i++) {
    if (i > 0) doc.addPage();
    await drawProjectEntrySheet(doc, { projectTitle, matiere, teacherName, logoBuffer, ...entries[i] });
  }
  doc.end();
  return done;
}

/* =========================================================
   Export PDF — rapport pédagogique global (pour la direction)
   ========================================================= */
function buildGlobalReportPdf({ stats, byLevel, classBreakdown, logoBuffer }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 40, size: 'A4' });
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    drawLogo(doc, logoBuffer);

    doc.fontSize(22).font('Helvetica-Bold').fillColor('#000').text('Rapport pédagogique global');
    doc.fontSize(10).font('Helvetica').fillColor('#555').text(new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' }));
    doc.moveDown(1);

    doc.font('Helvetica-Bold').fontSize(13).fillColor('#000').text('Vue d\'ensemble');
    doc.moveDown(0.3);
    const statLine = [
      ['Examens', stats.examCount], ['Professeurs', stats.teacherCount], ['Copies soumises', stats.submittedCount],
      ['Moyenne générale', stats.avgPct + '%'], ['Taux de réussite', stats.successRate + '%'],
    ];
    doc.font('Helvetica').fontSize(10);
    statLine.forEach(([label, val]) => doc.text(`${label} : ${val}`));
    doc.moveDown(1);

    doc.font('Helvetica-Bold').fontSize(13).text('Résultats par niveau');
    doc.moveDown(0.3);
    let y = doc.y;
    const barW = 260;
    ['Préscolaire', 'Primaire', 'Secondaire'].forEach(niv => {
      const pct = byLevel[niv];
      if (pct === null || pct === undefined) return;
      if (y > 740) { doc.addPage(); y = 40; }
      doc.font('Helvetica').fontSize(10).fillColor('#000').text(niv, 40, y, { width: 120 });
      doc.rect(170, y + 2, barW, 12).fill('#EEEEEE');
      doc.rect(170, y + 2, barW * (pct / 100), 12).fill(scoreColorHex(pct));
      doc.fillColor('#000').text(pct + '%', 170 + barW + 8, y);
      y += 24;
    });
    doc.y = y + 16;
    doc.x = 40;

    if (classBreakdown && classBreakdown.length) {
      doc.font('Helvetica-Bold').fontSize(13).text('Compétences par classe');
      doc.moveDown(0.3);
      classBreakdown.forEach(cls => {
        if (doc.y > 700) doc.addPage();
        doc.font('Helvetica-Bold').fontSize(11).fillColor('#000').text(`Classe ${cls.classe}`, 40, doc.y, { width: 500 });
        let yy = doc.y + 4;
        cls.sections.forEach(s => {
          if (yy > 750) { doc.addPage(); yy = 40; }
          doc.font('Helvetica').fontSize(9).fillColor('#000').text(s.titre, 50, yy, { width: 150 });
          doc.rect(210, yy + 1, 220, 10).fill('#EEEEEE');
          doc.rect(210, yy + 1, 220 * (s.pct / 100), 10).fill(scoreColorHex(s.pct));
          doc.fillColor('#000').fontSize(9).text(s.pct + '%', 210 + 220 + 8, yy);
          yy += 18;
        });
        doc.y = yy + 10;
        doc.x = 40;
      });
    }

    doc.end();
  });
}
