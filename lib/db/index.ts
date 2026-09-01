import 'server-only';
import { drizzle } from 'drizzle-orm/neon-serverless';
import { drizzle as drizzleNode } from 'drizzle-orm/node-postgres';
import { Pool as NeonPool } from '@neondatabase/serverless';
import * as schema from './schema.ts';

export * as schema from './schema.ts';

/**
 * The one place that opens a database connection.
 *
 * Route handlers use the POOLED Neon string (the `-pooler` host): serverless
 * invocations open many short-lived connections and would exhaust a direct
 * one. The direct string is for migrations only and is never read here.
 *
 * Tests point DATABASE_URL at a plain Postgres, so a `postgres://` host that
 * is not Neon falls back to node-postgres rather than the Neon driver.
 */
let cached: ReturnType<typeof drizzle> | ReturnType<typeof drizzleNode> | null = null;

export function db() {
  if (cached) return cached;
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      'DATABASE_URL is not set. Route handlers need the pooled Neon connection string.',
    );
  }
  if (url.includes('neon.tech')) {
    if (!url.includes('-pooler')) {
      // Loud on purpose: using the direct string here works until traffic
      // arrives, then fails as connections run out.
      console.warn(
        '[db] DATABASE_URL is a direct Neon connection. Route handlers should use the -pooler host.',
      );
    }
    cached = drizzle(new NeonPool({ connectionString: url }), { schema });
  } else {
    // Local/CI Postgres.
    const { Pool } = require('pg') as typeof import('pg');
    cached = drizzleNode(new Pool({ connectionString: url }), { schema });
  }
  return cached;
}

/** Test seam: lets integration tests inject a connection and reset it. */
export function __setDb(instance: typeof cached) {
  cached = instance;
}
