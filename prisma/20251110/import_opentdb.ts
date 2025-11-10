import minimist from 'minimist';
import fetch from 'node-fetch';
import { PrismaClient } from '@prisma/client';

const argv = minimist(process.argv.slice(2));
const prisma = new PrismaClient();

function decodeHtml(str?: string): string {
  if (!str) return '';
  return str.replace(/&quot;|&apos;|&amp;|&lt;|&gt;|&#(\d+);/g, (m: string, num: string) => {
    if (m === '&quot;') return '"';
    if (m === '&apos;') return "'";
    if (m === '&amp;') return '&';
    if (m === '&lt;') return '<';
    if (m === '&gt;') return '>';
    if (num) return String.fromCharCode(Number(num));
    return m;
  });
}

async function main() {
  const token = argv.token || argv.t;
  const amount = Number(argv.amount || argv.a || 10);

  const catRes = await fetch('https://opentdb.com/api_category.php');
  const catJson = await catRes.json();
  const categoryMap = new Map((catJson.trivia_categories || []).map((c: any) => [c.name, c.id]));

  const url = new URL('https://opentdb.com/api.php');
  url.searchParams.set('amount', String(amount));
  if (token) url.searchParams.set('token', token as string);

  console.log('Fetching questions from OpenTDB:', url.toString());
  const res = await fetch(url.toString());
  const data = await res.json();
  if (!data.results || data.results.length === 0) return console.log('No results', data);

  let imported = 0;
  for (const item of data.results) {
    const qText = decodeHtml(item.question).trim();
    if (await prisma.question.findUnique({ where: { question: qText } })) continue;

    const catName = decodeHtml(item.category).trim();
    const opentdb_id = categoryMap.get(catName) || null;
    const category = await prisma.category.upsert({ where: { name: catName } as any, update: {}, create: { name: catName, opentdb_id: opentdb_id || 0 } });

    const level = (item.difficulty || '').charAt(0).toUpperCase() + (item.difficulty || '').slice(1);
    let difficulty = await prisma.difficulty.findUnique({ where: { level } as any });
    if (!difficulty) difficulty = await prisma.difficulty.create({ data: { level } });

    const typeLabel = item.type === 'multiple' ? 'Multiple Choice' : item.type === 'boolean' ? 'True/False' : item.type;
    let type = await prisma.type.findUnique({ where: { type: typeLabel } as any });
    if (!type) type = await prisma.type.create({ data: { type: typeLabel } });

    async function findOrCreate(text: string) {
      const f = await prisma.answer.findFirst({ where: { answer: text } as any });
      return f || await prisma.answer.create({ data: { answer: text } });
    }

    const correctAnswer = await findOrCreate(decodeHtml(item.correct_answer).trim());
    const incorrectAnswers = [] as any[];
    for (const t of (item.incorrect_answers || [])) incorrectAnswers.push(await findOrCreate(decodeHtml(t).trim()));

    await prisma.question.create({ data: {
      question: qText,
      difficultyId: difficulty.id,
      categoryId: category.id,
      typeId: type.id,
      correct_answer_id: correctAnswer.id,
      incorrect_answers: { connect: incorrectAnswers.map(a => ({ id: a.id })) }
    }});

    imported++; console.log('Imported:', qText.slice(0,80));
  }
  console.log('Imported', imported, 'questions');
}

main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
