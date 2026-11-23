import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { prisma } from '../../src/lib/prisma.js';
import { prepareTurn, runTurn } from '../../src/modules/assistant/assistant.service.js';
import { assistantProviders } from '../../src/modules/assistant/providers/registry.js';

/**
 * Asks the configured providers every question in `evals/assistant/questions.jsonl` and checks the
 * answers (`npm run assistant:eval -- --yes`). It spends real API credit, so it refuses to run
 * without `--yes`. Run it against the development database, with the catalog imported and
 * `npm run assistant:index` done; set ASSISTANT_EVAL_USER_EMAIL to a customer for the signed-in
 * questions.
 *
 * The checks are deliberately coarse (a tool was used, a word appears, a phrase does not): they
 * catch regressions after a prompt or model change. Read the printed answers as well.
 */
interface Question {
  readonly id: string;
  readonly question: string;
  readonly signedIn?: boolean;
  /** Passes if any of these tools ran; empty means no tool is required. */
  readonly expectTools: readonly string[];
  /** Each entry is a case-insensitive regular expression that must match the answer. */
  readonly mustMention: readonly string[];
  /** Case-insensitive substrings that must not appear. */
  readonly mustNotMention: readonly string[];
}

if (!process.argv.includes('--yes')) {
  process.stderr.write(
    'This sends every eval question to the real providers and costs API credit.\n' +
      'Run it with: npm run assistant:eval -- --yes\n',
  );
  process.exit(1);
}

if (!assistantProviders()) {
  process.stderr.write('The assistant is not configured (docs/assistant-setup.md).\n');
  process.exit(1);
}

const here = path.dirname(fileURLToPath(import.meta.url));
const file = path.resolve(here, '../../evals/assistant/questions.jsonl');
const questions = (await readFile(file, 'utf8'))
  .split('\n')
  .filter((line) => line.trim() !== '')
  .map((line) => JSON.parse(line) as Question);

const evalEmail = process.env.ASSISTANT_EVAL_USER_EMAIL;
const evalUser = evalEmail
  ? await prisma.user.findUnique({
      where: { email: evalEmail.toLowerCase() },
      select: { id: true },
    })
  : null;

let passed = 0;
let tokens = 0;

try {
  for (const question of questions) {
    if (question.signedIn && !evalUser) {
      process.stdout.write(`SKIP ${question.id}: set ASSISTANT_EVAL_USER_EMAIL\n`);
      continue;
    }

    let answer = '';
    let messageId: string | null = null;
    let failure: string | null = null;

    try {
      const turn = await prepareTurn({
        userId: question.signedIn ? (evalUser?.id ?? null) : null,
        message: question.question,
        ip: `eval:${question.id}`,
      });
      for await (const event of runTurn(turn)) {
        if (event.type === 'delta') answer += event.text;
        if (event.type === 'done') {
          messageId = event.messageId;
          tokens += event.usage.inputTokens + event.usage.outputTokens;
        }
        if (event.type === 'error') failure = event.message;
      }
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error);
    }

    const toolNames = messageId
      ? ((
          await prisma.assistantMessage.findUnique({
            where: { id: messageId },
            select: { toolNames: true },
          })
        )?.toolNames ?? [])
      : [];

    const problems: string[] = [];
    if (failure) problems.push(`failed: ${failure}`);
    if (
      question.expectTools.length > 0 &&
      !question.expectTools.some((t) => toolNames.includes(t))
    ) {
      problems.push(
        `expected one of [${question.expectTools.join(', ')}], used [${toolNames.join(', ')}]`,
      );
    }
    for (const pattern of question.mustMention) {
      if (!new RegExp(pattern, 'i').test(answer)) problems.push(`does not mention /${pattern}/`);
    }
    for (const phrase of question.mustNotMention) {
      if (answer.toLowerCase().includes(phrase.toLowerCase()))
        problems.push(`mentions "${phrase}"`);
    }

    if (problems.length === 0) passed += 1;
    process.stdout.write(
      `${problems.length === 0 ? 'PASS' : 'FAIL'} ${question.id}\n  Q: ${question.question}\n  A: ${answer.replace(/\s+/g, ' ').slice(0, 400)}\n${problems.map((problem) => `  ! ${problem}\n`).join('')}`,
    );
  }
} finally {
  await prisma.$disconnect();
}

process.stdout.write(
  `\n${String(passed)}/${String(questions.length)} passed, ${String(tokens)} tokens\n`,
);
