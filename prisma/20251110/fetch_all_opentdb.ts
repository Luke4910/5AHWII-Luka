import minimist from 'minimist';
import fetch from 'node-fetch';
import { PrismaClient } from '@prisma/client';

const argv = minimist(process.argv.slice(2));
const prisma = new PrismaClient();

const AMOUNT = Number(argv.amount || argv.a || 50);
const DELAY = Number(argv.delay || argv.d || 300);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function requestNewToken(): Promise<string> {
  const res = await fetch('https://opentdb.com/api_token.php?command=request');
  const j = await res.json();
  if (j.token) return j.token;
  throw new Error('Could not obtain token: ' + JSON.stringify(j));
}

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

async function fetchBatch(token: string) {
  const url = new URL('https://opentdb.com/api.php');
  url.searchParams.set('amount', String(AMOUNT));
  url.searchParams.set('token', token);
  const res = await fetch(url.toString());
  return res.json();
}

let categoryMap = new Map<string, number>();

async function saveQuestion(item: any): Promise<boolean> {
  const qText = decodeHtml(item.question).trim();
  const exists = await prisma.question.findUnique({ where: { question: qText } });
  if (exists) return false;

  const catNameDecoded = decodeHtml(item.category);
  const knownId = categoryMap.get(catNameDecoded);
  let cat;
  if (knownId) {
    cat = await prisma.category.findUnique({ where: { opentdb_id: knownId } as any });
    if (!cat) {
      const byName = await prisma.category.findUnique({ where: { name: catNameDecoded } as any });
      if (byName) {
        cat = byName;
      } else {
        cat = await prisma.category.create({ data: { name: catNameDecoded, opentdb_id: knownId } });
      }
    }
  } else {
    const fallbackId = Date.now() + Math.floor(Math.random() * 1000000);
    cat = await prisma.category.upsert({ where: { name: catNameDecoded } as any, update: {}, create: { name: catNameDecoded, opentdb_id: fallbackId } });
  }

  const diffLevel = (item.difficulty || 'Unknown').charAt(0).toUpperCase() + (item.difficulty || 'Unknown').slice(1);
  const diff = await prisma.difficulty.upsert({ where: { level: diffLevel } as any, update: {}, create: { level: diffLevel } });
  const typeLabel = item.type === 'multiple' ? 'Multiple Choice' : item.type === 'boolean' ? 'True/False' : item.type;
  const type = await prisma.type.upsert({ where: { type: typeLabel } as any, update: {}, create: { type: typeLabel } });

  async function findOrCreateAnswer(text: string) {
    const t = decodeHtml(text).trim();
    const f = await prisma.answer.findFirst({ where: { answer: t } as any });
    return f || (await prisma.answer.create({ data: { answer: t } }));
  }

  const correct = await findOrCreateAnswer(item.correct_answer);
  const incorrects = [] as any[];
  for (const inc of item.incorrect_answers || []) incorrects.push(await findOrCreateAnswer(inc));

  await prisma.question.create({ data: {
    question: qText,
    difficultyId: diff.id,
    categoryId: cat.id,
    typeId: type.id,
    correct_answer_id: correct.id,
    incorrect_answers: { connect: incorrects.map(a => ({ id: a.id })) }
  }});
  return true;
}

async function main() {
  let token: string = argv.token || argv.t;
  if (!token) {
    console.log('No token provided — requesting a session token from OpenTDB');
    token = await requestNewToken();
    console.log('Got token:', token);
  }

  const seen = new Set<string>();
  let totalImported = 0;
  let rounds = 0;

  while (true) {
    rounds++;
    console.log(`Request round ${rounds} — fetching up to ${AMOUNT} questions`);
    if (rounds === 1 && (!categoryMap || categoryMap.size === 0)) {
      const catRes = await fetch('https://opentdb.com/api_category.php');
      const catJson = await catRes.json();
      categoryMap = new Map((catJson.trivia_categories || []).map((c: any) => [c.name, c.id]));
    }
    const data = await fetchBatch(token);
    if (!data) { console.log('No data returned — stop'); break; }
    const code = data.response_code;
    if (code === 1) { console.log('No results (response_code 1) — stopping'); break; }
    if (code === 2) { console.error('Invalid parameter (response_code 2) — stopping'); break; }
    if (code === 3) { console.error('Token not found (response_code 3) — stopping'); break; }
    if (code === 4) { console.log('Token empty (response_code 4) — session exhausted. Done.'); break; }

    let newThisRound = 0;
    for (const item of data.results || []) {
      const key = decodeHtml(item.question).trim();
      if (seen.has(key)) continue;
      seen.add(key);
      const created = await saveQuestion(item);
      if (created) { newThisRound++; totalImported++; }
    }

    console.log(`Round ${rounds}: new imported ${newThisRound}, total imported this run ${totalImported}`);

    if (newThisRound === 0) {
      console.log('No new questions this round. Trying to request a fresh token and continue...');
      let tried = 0;
      const MAX_TRIES = 5;
      let continued = false;
      while (tried < MAX_TRIES) {
        tried++;
        console.log(`Attempt ${tried}/${MAX_TRIES}: requesting new token...`);
        token = await requestNewToken();
        console.log('New token:', token);
        const newData = await fetchBatch(token);
        const newResults = newData.results || [];
        let newCount = 0;
        for (const item of newResults) {
          const key = decodeHtml(item.question).trim();
          if (seen.has(key)) continue;
          seen.add(key);
          const created = await saveQuestion(item);
          if (created) { newCount++; totalImported++; }
        }
        console.log(`Attempt ${tried}: new imported ${newCount}`);
        if (newCount > 0) { continued = true; break; }
        await sleep(DELAY);
      }
      if (!continued) {
        console.log('No new questions after several token refresh attempts — stopping.');
        break;
      }
    }

    await sleep(DELAY);
  }

  console.log('Finished. Total imported:', totalImported);
}

main().catch(e => { console.error('ERROR:', e); process.exit(1); }).finally(() => prisma.$disconnect());
