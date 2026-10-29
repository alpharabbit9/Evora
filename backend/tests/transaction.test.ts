import { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/** Only the Prisma client is stubbed; the retry policy under test is the real one. */
const { $transaction } = vi.hoisted(() => ({ $transaction: vi.fn() }));

vi.mock('../src/lib/prisma.js', () => ({ prisma: { $transaction } }));

const { TRANSACTION_DEFAULTS, withSerializableTransaction, withTransaction } =
  await import('../src/lib/transaction.js');

function prismaError(code: string): Error {
  return new Prisma.PrismaClientKnownRequestError(`simulated ${code}`, {
    code,
    clientVersion: 'test',
  });
}

const fast = { attempts: 3, label: 'test.transaction' } as const;

beforeEach(() => {
  $transaction.mockReset();
});

describe('withTransaction', () => {
  it('runs the callback and returns its value', async () => {
    $transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({ marker: 'tx' }),
    );

    const seen: unknown[] = [];
    const result = await withTransaction(async (tx) => {
      seen.push(tx);
      await Promise.resolve();
      return 'order_1';
    });

    expect(result).toBe('order_1');
    expect(seen).toEqual([{ marker: 'tx' }]);
  });

  it('bounds the transaction with short default limits', async () => {
    $transaction.mockResolvedValue('ok');

    await withTransaction(() => Promise.resolve('ok'));

    expect($transaction).toHaveBeenCalledWith(expect.any(Function), {
      maxWait: TRANSACTION_DEFAULTS.maxWaitMs,
      timeout: TRANSACTION_DEFAULTS.timeoutMs,
    });
    expect(TRANSACTION_DEFAULTS.timeoutMs).toBeLessThanOrEqual(5_000);
  });

  it('retries a write conflict, because nothing was committed', async () => {
    $transaction
      .mockRejectedValueOnce(prismaError('P2034'))
      .mockRejectedValueOnce(prismaError('P2034'))
      .mockResolvedValueOnce('claimed');

    await expect(withTransaction(() => Promise.resolve('claimed'), fast)).resolves.toBe('claimed');
    expect($transaction).toHaveBeenCalledTimes(3);
  });

  it('gives up after the configured attempts', async () => {
    $transaction.mockRejectedValue(prismaError('P2034'));

    await expect(withTransaction(() => Promise.resolve('never'), fast)).rejects.toThrow('P2034');
    expect($transaction).toHaveBeenCalledTimes(3);
  });

  it('does not retry a domain conflict such as a unique violation', async () => {
    $transaction.mockRejectedValue(prismaError('P2002'));

    await expect(withTransaction(() => Promise.resolve('never'), fast)).rejects.toThrow('P2002');
    expect($transaction).toHaveBeenCalledTimes(1);
  });

  it('does not retry an application error thrown inside the callback', async () => {
    $transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn({}));

    await expect(
      withTransaction(async () => {
        await Promise.resolve();
        throw new Error('insufficient stock');
      }, fast),
    ).rejects.toThrow('insufficient stock');
    expect($transaction).toHaveBeenCalledTimes(1);
  });

  it('passes the isolation level through for the serializable variant', async () => {
    $transaction.mockResolvedValue('ok');

    await withSerializableTransaction(() => Promise.resolve('ok'));

    expect($transaction).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ isolationLevel: Prisma.TransactionIsolationLevel.Serializable }),
    );
  });
});
