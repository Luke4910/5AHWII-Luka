import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

(async function() {
  try {
    const count = await prisma.question.count();
    console.log('QUESTION_COUNT:' + count);
    const sample = await prisma.question.findMany({ take: 5, select: { question: true } });
    console.log('SAMPLE_QS:');
    sample.forEach((q, i) => console.log(`${i+1}. ${q.question}`));
  } catch (e) {
    console.error('VERIFY_ERROR:', e);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
})();
