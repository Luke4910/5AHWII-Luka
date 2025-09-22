
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {

  // Difficulty
  let difficulty = await prisma.difficulty.findUnique({ where: { level: 'Easy' } });
  if (!difficulty) {
    difficulty = await prisma.difficulty.create({ data: { level: 'Easy' } });
  }

  // Category
  let category = await prisma.category.findUnique({ where: { name: 'General' } });
  if (!category) {
    category = await prisma.category.create({ data: { name: 'General', opentdb_id: 1 } });
  }

  // Type
  let type = await prisma.type.findUnique({ where: { type: 'Multiple Choice' } });
  if (!type) {
    type = await prisma.type.create({ data: { type: 'Multiple Choice' } });
  }

  // Answers
  const correctAnswer = await prisma.answer.create({
    data: { answer: '4' }
  });
  const incorrect1 = await prisma.answer.create({ data: { answer: '3' } });
  const incorrect2 = await prisma.answer.create({ data: { answer: '5' } });
  const incorrect3 = await prisma.answer.create({ data: { answer: '22' } });

  // Question
  await prisma.question.create({
    data: {
      question: 'Was ist 2 + 2?',
      difficultyId: difficulty.id,
      categoryId: category.id,
      typeId: type.id,
      correct_answer_id: correctAnswer.id,
      incorrect_answers: {
        connect: [
          { id: incorrect1.id },
          { id: incorrect2.id },
          { id: incorrect3.id }
        ]
      }
    }
  });
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
