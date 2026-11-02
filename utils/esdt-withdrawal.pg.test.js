'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const SENDER = 'erd18x0qllr9h9xy4xvdd6pycg8px3jh8dk66x0kq2g3eyq4meyp6must0qqzs';
const RECIPIENT = 'erd1japdfaw0n6hqsxmswart26j0zrhn0cvf3fvpz5lfg3tlmr5ljrss2awj4n';
const OTHER = 'erd1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq6gq4hv';
const HASH = 'abc123abc123abc123abc123abc123abc123abc123abc123abc123abc123abcd';
const MIGRATION = fs.readFileSync(
  path.join(__dirname, '../supabase/migrations/20261101120000_esdt_withdrawal_reservations.sql'),
  'utf8'
);

const SCHEMA = `
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
DO $$ BEGIN CREATE ROLE anon NOLOGIN; EXCEPTION WHEN duplicate_object OR unique_violation THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object OR unique_violation THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role NOLOGIN; EXCEPTION WHEN duplicate_object OR unique_violation THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS virtual_accounts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    username TEXT,
    balances JSONB DEFAULT '{}',
    created_at BIGINT NOT NULL,
    last_updated BIGINT NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(guild_id, user_id)
);

CREATE TABLE IF NOT EXISTS virtual_account_transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    transaction_id TEXT NOT NULL,
    type TEXT NOT NULL,
    token TEXT NOT NULL,
    amount TEXT NOT NULL,
    balance_before TEXT NOT NULL,
    balance_after TEXT NOT NULL,
    tx_hash TEXT,
    source TEXT,
    timestamp BIGINT NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(guild_id, user_id, transaction_id)
);

CREATE TABLE IF NOT EXISTS auction_bid_reservations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    auction_id TEXT,
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    token_identifier TEXT NOT NULL,
    reserved_amount TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
`;

function quoteIdent(value) {
  if (!/^wdtest_[0-9]+$/.test(value)) throw new Error('unsafe database name');
  return value;
}

function pgConfig(database) {
  return {
    host: process.env.ESDT_TEST_PGHOST || '/var/run/postgresql',
    user: process.env.ESDT_TEST_PGUSER || 'ubuntu',
    database
  };
}

async function withDatabase(fn) {
  const admin = new Client(pgConfig('esdt_withdrawal_test'));
  await admin.connect();
  const name = quoteIdent(`wdtest_${Date.now()}${Math.floor(Math.random() * 1000)}`);
  await admin.query(`CREATE DATABASE ${name}`);
  await admin.end();
  const client = new Client(pgConfig(name));
  await client.connect();
  try {
    await client.query(SCHEMA);
    await client.query(MIGRATION);
    await fn(client);
  } finally {
    await client.end();
    const drop = new Client(pgConfig('esdt_withdrawal_test'));
    await drop.connect();
    await drop.query(`DROP DATABASE ${name}`);
    await drop.end();
  }
}

async function seed(client, balance) {
  const now = Date.now();
  await client.query(
    `INSERT INTO virtual_accounts (guild_id, user_id, username, balances, created_at, last_updated)
     VALUES ('g', 'u', 'tester', $1::jsonb, $2, $2)`,
    [JSON.stringify({ 'DROP-1fc8cc': balance }), now]
  );
}

function reserveArgs(id, amountHuman, amountRaw, recipient = RECIPIENT) {
  return [
    id,
    id.slice(3),
    'g',
    'u',
    'DROP-1fc8cc',
    'DROP',
    amountHuman,
    amountRaw,
    8,
    recipient,
    SENDER,
    null
  ];
}

test('postgres reservation is idempotent and keeps the ledger amount exact', async () => {
  await withDatabase(async (client) => {
    await seed(client, '1000');
    const first = await client.query(
      `SELECT reserve_esdt_withdrawal($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) AS result`,
      reserveArgs('wd_100000000000000101', '800', '80000000000')
    );
    assert.equal(first.rows[0].result.created, true);
    assert.equal(first.rows[0].result.record.amount_raw, '80000000000');
    const second = await client.query(
      `SELECT reserve_esdt_withdrawal($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) AS result`,
      reserveArgs('wd_100000000000000101', '800', '80000000000')
    );
    assert.equal(second.rows[0].result.created, false);
    const balance = await client.query(`SELECT balances->>'DROP-1fc8cc' AS balance FROM virtual_accounts`);
    assert.equal(balance.rows[0].balance, '200');
    const ledger = await client.query(
      `SELECT count(*)::int AS n FROM virtual_account_transactions WHERE type = 'deduction'`
    );
    assert.equal(ledger.rows[0].n, 1);
    await assert.rejects(
      () => client.query(
        `SELECT reserve_esdt_withdrawal($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        reserveArgs('wd_100000000000000101', '800', '80000000000', OTHER)
      ),
      (error) => /idempotency_conflict/.test(error.message)
    );
  });
});

test('postgres rejects a stale lease confirm and restore after another worker claims', async () => {
  await withDatabase(async (client) => {
    await seed(client, '50');
    await client.query(
      `SELECT reserve_esdt_withdrawal($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      reserveArgs('wd_100000000000000102', '5', '500000000')
    );
    const first = await client.query(
      `SELECT claim_esdt_withdrawal_lease('wd_100000000000000102', 'worker-a', 150) AS result`
    );
    const fenceA = first.rows[0].result.fence;
    assert.equal(typeof fenceA, 'string');
    await client.query(
      `UPDATE esdt_withdrawals SET processing_lease_until = clock_timestamp() - interval '1 second' WHERE withdrawal_id = 'wd_100000000000000102'`
    );
    const second = await client.query(
      `SELECT claim_esdt_withdrawal_lease('wd_100000000000000102', 'worker-b', 150) AS result`
    );
    const fenceB = second.rows[0].result.fence;
    assert.notEqual(fenceB, fenceA);
    await assert.rejects(
      () => client.query(
        `SELECT confirm_esdt_withdrawal($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        ['wd_100000000000000102', 'worker-a', fenceA, HASH, 'op', 200, true, '0', null, '20']
      ),
      (error) => /lease_lost/.test(error.message)
    );
    await assert.rejects(
      () => client.query(
        `SELECT fail_esdt_withdrawal($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        ['wd_100000000000000102', 'worker-a', fenceA, true, 'EXECUTION_FAILED', 'stale', 422, 'op', HASH]
      ),
      (error) => /lease_lost/.test(error.message)
    );
    const row = await client.query(`SELECT status, balance_after FROM esdt_withdrawals WHERE withdrawal_id = 'wd_100000000000000102'`);
    assert.equal(row.rows[0].status, 'RESERVED');
    const balance = await client.query(`SELECT balances->>'DROP-1fc8cc' AS balance FROM virtual_accounts`);
    assert.equal(balance.rows[0].balance, '45');
    const restored = await client.query(
      `SELECT count(*)::int AS n FROM virtual_account_transactions WHERE type = 'deposit'`
    );
    assert.equal(restored.rows[0].n, 0);
    const released = await client.query(
      `SELECT release_esdt_withdrawal_lease('wd_100000000000000102', 'worker-a', $1) AS result`,
      [fenceA]
    );
    assert.equal(released.rows[0].result.released, false);
    const owner = await client.query(`SELECT processing_owner, processing_fence FROM esdt_withdrawals`);
    assert.equal(owner.rows[0].processing_owner, 'worker-b');
    assert.equal(owner.rows[0].processing_fence, fenceB);

    const confirmed = await client.query(
      `SELECT confirm_esdt_withdrawal($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) AS result`,
      ['wd_100000000000000102', 'worker-b', fenceB, HASH, 'op', 200, true, '0', null, '20']
    );
    assert.equal(confirmed.rows[0].result.record.status, 'CONFIRMED');
    assert.equal(confirmed.rows[0].result.record.primary_tx_hash, HASH);
  });
});

test('postgres restoration and a second reservation lock the same virtual account', async () => {
  await withDatabase(async (client) => {
    await seed(client, '10');
    await client.query(
      `SELECT reserve_esdt_withdrawal($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      reserveArgs('wd_100000000000000103', '6', '600000000')
    );
    const lease = await client.query(
      `SELECT claim_esdt_withdrawal_lease('wd_100000000000000103', 'worker-a', 150) AS result`
    );
    const fence = lease.rows[0].result.fence;
    const holder = new Client(pgConfig(client.database));
    const other = new Client(pgConfig(client.database));
    await holder.connect();
    await other.connect();
    try {
      await holder.query('BEGIN');
      await holder.query(
        `SELECT fail_esdt_withdrawal($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        ['wd_100000000000000103', 'worker-a', fence, true, 'TX_REJECTED', 'rejected', 503, null, null]
      );
      const competing = other.query(
        `SELECT reserve_esdt_withdrawal($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) AS result`,
        reserveArgs('wd_100000000000000104', '8', '800000000')
      );
      await new Promise((resolve) => setTimeout(resolve, 200));
      let settled = false;
      competing.then(() => { settled = true; }, () => { settled = true; });
      await new Promise((resolve) => setTimeout(resolve, 50));
      assert.equal(settled, false);
      await holder.query('COMMIT');
      const result = await competing;
      assert.equal(result.rows[0].result.created, true);
      const balance = await client.query(`SELECT balances->>'DROP-1fc8cc' AS balance FROM virtual_accounts`);
      assert.equal(balance.rows[0].balance, '2');
      const deposits = await client.query(
        `SELECT count(*)::int AS n FROM virtual_account_transactions WHERE transaction_id = 'esdt-restore:wd_100000000000000103'`
      );
      assert.equal(deposits.rows[0].n, 1);
      await client.query(
        `SELECT fail_esdt_withdrawal($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        ['wd_100000000000000103', 'worker-a', fence, true, 'TX_REJECTED', 'again', 503, null, null]
      );
      const depositsAfter = await client.query(
        `SELECT count(*)::int AS n FROM virtual_account_transactions WHERE type = 'deposit'`
      );
      assert.equal(depositsAfter.rows[0].n, 1);
    } finally {
      await holder.end();
      await other.end();
    }
  });
});

test('postgres keeps an 18-decimal raw amount identical in the ledger', async () => {
  await withDatabase(async (client) => {
    await client.query(
      `INSERT INTO virtual_accounts (guild_id, user_id, balances, created_at, last_updated)
       VALUES ('g', 'u', '{"PREC-abcdef":"2.000000000000000000"}'::jsonb, 1, 1)`
    );
    const result = await client.query(
      `SELECT reserve_esdt_withdrawal(
         'wd_100000000000000105', '100000000000000105', 'g', 'u', 'PREC-abcdef', 'PREC',
         '1.234567890123456789', '1234567890123456789', 18, $1, $2, NULL
       ) AS result`,
      [RECIPIENT, SENDER]
    );
    assert.equal(result.rows[0].result.created, true);
    assert.equal(result.rows[0].result.record.amount_raw, '1234567890123456789');
    const ledger = await client.query(`SELECT amount FROM virtual_account_transactions`);
    assert.equal(ledger.rows[0].amount, '1.234567890123456789');
    const balance = await client.query(`SELECT balances->>'PREC-abcdef' AS balance FROM virtual_accounts`);
    assert.equal(balance.rows[0].balance, '0.765432109876543211');
  });
});
