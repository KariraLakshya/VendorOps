/**
 * A tiny in-memory stand-in for the Prisma client, used by integration
 * tests that need several real controllers/services to agree on the same
 * data across a multi-step flow (e.g. a profile created by one endpoint
 * must be the exact row a later endpoint reads and updates) without a
 * real Postgres instance.
 *
 * Only implements the query shapes this codebase's `opening`/`hiringProfile`
 * queries actually use: flat equality where-clauses, an `{ in: [...] }`
 * operator, and `include: { opening: true }`. Not a general Prisma mock.
 */
type WhereCondition = Record<string, unknown>;

function matchesWhere(row: Record<string, any>, where: WhereCondition = {}): boolean {
  return Object.entries(where).every(([key, condition]) => {
    if (condition && typeof condition === "object" && "in" in (condition as any)) {
      return (condition as { in: unknown[] }).in.includes(row[key]);
    }
    return row[key] === condition;
  });
}

export function createFakePrisma(seed: { openings?: Record<string, any>[] } = {}) {
  let nextProfileId = 1;
  const openings = new Map<string, any>();
  const profiles = new Map<number, any>();

  (seed.openings ?? []).forEach((opening) => openings.set(opening.id, { ...opening }));

  function attachOpening(row: Record<string, any>, include?: { opening?: boolean }) {
    return include?.opening ? { ...row, opening: openings.get(row.openingId) } : row;
  }

  const client: any = {
    opening: {
      findFirst: async ({ where }: { where: WhereCondition }) => {
        for (const opening of openings.values()) {
          if (matchesWhere(opening, where)) return { ...opening };
        }
        return null;
      },
    },
    hiringProfile: {
      create: async ({ data }: { data: Record<string, any> }) => {
        const row = {
          id: nextProfileId++,
          isDeleted: false,
          submittedAt: new Date(),
          recommended: null,
          recommendationScore: null,
          recommendationConfidence: null,
          recommendationReason: null,
          recommendationLatencyMs: null,
          recommendationVersion: null,
          recommendationMetadata: null,
          recommendationError: null,
          recommendedAt: null,
          shortlistedBy: null,
          shortlistedAt: null,
          rejectedBy: null,
          rejectedAt: null,
          ...data,
        };
        profiles.set(row.id, row);
        return { ...row };
      },
      findUnique: async ({ where, include }: { where: { id: number }; include?: { opening?: boolean } }) => {
        const row = profiles.get(where.id);
        return row ? attachOpening({ ...row }, include) : null;
      },
      findFirst: async ({ where, include }: { where: WhereCondition; include?: { opening?: boolean } }) => {
        for (const row of profiles.values()) {
          if (matchesWhere(row, where)) return attachOpening({ ...row }, include);
        }
        return null;
      },
      update: async ({ where, data }: { where: { id: number }; data: Record<string, any> }) => {
        const row = profiles.get(where.id);
        if (!row) throw new Error(`fakePrisma: no hiringProfile with id ${where.id}`);
        Object.assign(row, data);
        return { ...row };
      },
      updateMany: async ({ where, data }: { where: WhereCondition; data: Record<string, any> }) => {
        let count = 0;
        for (const row of profiles.values()) {
          if (matchesWhere(row, where)) {
            Object.assign(row, data);
            count++;
          }
        }
        return { count };
      },
    },
    $transaction: async (fn: (tx: unknown) => unknown) => fn(client),
  };

  return client;
}

export type FakePrismaClient = ReturnType<typeof createFakePrisma>;
