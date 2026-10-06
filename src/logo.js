// Récupère le logo officiel de l'école (enregistré dans les réglages) : { buffer, mime } ou null.
const prisma = require('./db');
async function getSchoolLogo() {
  try {
    const settings = await prisma.settings.findUnique({ where: { id: 'singleton' } });
    if (!settings || !settings.schoolLogoId) return null;
    const file = await prisma.uploadedFile.findUnique({ where: { id: settings.schoolLogoId } });
    if (!file) return null;
    return { buffer: Buffer.from(file.data, 'base64'), mime: file.mimeType, id: file.id };
  } catch (e) { return null; }
}
module.exports = { getSchoolLogo };
