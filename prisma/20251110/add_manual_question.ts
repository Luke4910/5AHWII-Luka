import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const difficulty = await prisma.difficulty.upsert({ where: { level: 'Easy' } as any, update: {}, create: { level: 'Easy' } });
  const category = await prisma.category.upsert({ where: { name: 'Manual' } as any, update: {}, create: { name: 'Manual', opentdb_id: 0 } });
  const type = await prisma.type.upsert({ where: { type: 'Multiple Choice' } as any, update: {}, create: { type: 'Multiple Choice' } });

  const correct = await prisma.answer.create({ data: { answer: '42' } });
  const wrong1 = await prisma.answer.create({ data: { answer: '24' } });
  const wrong2 = await prisma.answer.create({ data: { answer: '0' } });

  const q = await prisma.question.create({ data: {
    question: 'Was ist die Antwort auf alles? (manuell eingefügt)',
    difficultyId: difficulty.id,
    categoryId: category.id,
    typeId: type.id,
    correct_answer_id: correct.id,
    incorrect_answers: { connect: [{ id: wrong1.id }, { id: wrong2.id }] }
  }});
  console.log('Created question id:', q.id);
}

main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
