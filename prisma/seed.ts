import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

const STAGES = [
  { stage: 1, price: 0.003, bonus: 45, target: 200000 },
  { stage: 2, price: 0.0032, bonus: 42, target: 400000 },
  { stage: 3, price: 0.0034, bonus: 40, target: 600000 },
  { stage: 4, price: 0.0036, bonus: 38, target: 800000 },
  { stage: 5, price: 0.0039, bonus: 35, target: 1000000 },
  { stage: 6, price: 0.0042, bonus: 33, target: 1200000 },
  { stage: 7, price: 0.0045, bonus: 30, target: 1400000 },
  { stage: 8, price: 0.0048, bonus: 28, target: 1600000 },
  { stage: 9, price: 0.0052, bonus: 26, target: 1800000 },
  { stage: 10, price: 0.0056, bonus: 25, target: 2000000 },
  { stage: 11, price: 0.006, bonus: 24, target: 2200000 },
  { stage: 12, price: 0.0065, bonus: 23, target: 2400000 },
  { stage: 13, price: 0.007, bonus: 22, target: 2600000 },
  { stage: 14, price: 0.0076, bonus: 20, target: 2800000 },
  { stage: 15, price: 0.0082, bonus: 19, target: 3000000 },
  { stage: 16, price: 0.0088, bonus: 18, target: 3200000 },
  { stage: 17, price: 0.0095, bonus: 17, target: 3400000 },
  { stage: 18, price: 0.0102, bonus: 16, target: 3600000 },
  { stage: 19, price: 0.011, bonus: 15, target: 3800000 },
  { stage: 20, price: 0.0119, bonus: 14, target: 4000000 },
  { stage: 21, price: 0.0128, bonus: 13, target: 4200000 },
  { stage: 22, price: 0.0138, bonus: 12, target: 4400000 },
  { stage: 23, price: 0.0149, bonus: 12, target: 4500000 },
  { stage: 24, price: 0.0161, bonus: 11, target: 4600000 },
  { stage: 25, price: 0.0174, bonus: 10, target: 4700000 },
  { stage: 26, price: 0.0188, bonus: 10, target: 4750000 },
  { stage: 27, price: 0.0203, bonus: 9, target: 4800000 },
  { stage: 28, price: 0.0219, bonus: 9, target: 4850000 },
  { stage: 29, price: 0.0236, bonus: 8, target: 4900000 },
  { stage: 30, price: 0.0254, bonus: 8, target: 4950000 },
  { stage: 31, price: 0.0273, bonus: 7, target: 4970000 },
  { stage: 32, price: 0.0294, bonus: 7, target: 4980000 },
  { stage: 33, price: 0.0316, bonus: 6, target: 4985000 },
  { stage: 34, price: 0.0339, bonus: 6, target: 4990000 },
  { stage: 35, price: 0.0363, bonus: 5, target: 4995000 },
  { stage: 36, price: 0.0389, bonus: 5, target: 4997000 },
  { stage: 37, price: 0.0416, bonus: 4, target: 4998000 },
  { stage: 38, price: 0.0445, bonus: 4, target: 4999000 },
  { stage: 39, price: 0.0475, bonus: 3, target: 4999500 },
  { stage: 40, price: 0.0507, bonus: 3, target: 5000000 },
  { stage: 41, price: 0.054, bonus: 2, target: 5000000 },
  { stage: 42, price: 0.0576, bonus: 2, target: 5000000 },
  { stage: 43, price: 0.0613, bonus: 1, target: 5000000 },
  { stage: 44, price: 0.0652, bonus: 1, target: 5000000 },
  { stage: 45, price: 0.0693, bonus: 1, target: 5000000 },
  { stage: 46, price: 0.0736, bonus: 0, target: 5000000 },
  { stage: 47, price: 0.0781, bonus: 0, target: 5000000 },
  { stage: 48, price: 0.0828, bonus: 0, target: 5000000 },
  { stage: 49, price: 0.095, bonus: 0, target: 5000000 },
  { stage: 50, price: 0.35, bonus: 0, target: 5000000 },
];

async function main() {
  console.log('Seeding presale stages...');
  for (const stage of STAGES) {
    await prisma.presaleStage.upsert({
      where: { stage: stage.stage },
      update: { price: stage.price, bonus: stage.bonus, target: stage.target },
      create: {
        stage: stage.stage,
        price: stage.price,
        bonus: stage.bonus,
        target: stage.target,
        isActive: stage.stage === 1,
      },
    });
  }
  console.log(`Seeded ${STAGES.length} presale stages.`);

  console.log('Seeding admin user...');
  const hashedPassword = await bcrypt.hash('admin123', 10);
  await prisma.user.upsert({
    where: { email: 'admin@savex.ai' },
    update: {},
    create: {
      email: 'admin@savex.ai',
      password: hashedPassword,
      firstName: 'Admin',
      lastName: 'SaveX',
      role: 'ADMIN',
    },
  });
  console.log('Admin user created: admin@savex.ai / admin123');

  console.log('Seeding promo code...');
  await prisma.promoCode.upsert({
    where: { code: 'SAVEX10' },
    update: {},
    create: {
      code: 'SAVEX10',
      value: 10,
      maxUses: 1000,
      isActive: true,
    },
  });
  console.log('Promo code SAVEX10 created (10% bonus).');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
