require('dotenv').config();
const bcrypt = require('bcryptjs');
const prisma = require('./db');

async function main() {
  const email = (process.env.SEED_ADMIN_EMAIL || 'admin@ecole.fr').toLowerCase().trim();
  const password = process.env.SEED_ADMIN_PASSWORD;
  const name = process.env.SEED_ADMIN_NAME || 'Coordination FLE';

  if (!password) {
    console.error('SEED_ADMIN_PASSWORD manquant dans .env — abandon.');
    process.exit(1);
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log(`Un compte existe déjà pour ${email} — rien à faire.`);
    return;
  }

  const passwordHash = await bcrypt.hash(password, 10);
  await prisma.user.create({ data: { role: 'ADMIN', email, name, passwordHash, status: 'active' } });
  console.log(`Compte administrateur créé : ${email}`);
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
