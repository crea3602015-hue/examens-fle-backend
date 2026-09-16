const { PrismaClient } = require('@prisma/client');

// Un seul client Prisma réutilisé dans toute l'application (bonne pratique
// pour éviter d'épuiser les connexions à la base de données).
const prisma = new PrismaClient();

module.exports = prisma;
