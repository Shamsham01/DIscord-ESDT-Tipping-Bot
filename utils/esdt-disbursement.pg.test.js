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
  path.join(__dirname, '../supabase/migrations/20261102180000_esdt_disbursement_reservations.sql'),
  'utf8'
);
const NFT_SETTLEMENT = fs.readFileSync(
  path.join(__dirname, '../supabase/migrations/20261106203000_nft_disbursement_settlement.sql'),
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

CREATE TABLE IF NOT EXISTS house_balance (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    guild_id TEXT NOT NULL,
    token_identifier TEXT NOT NULL,
    betting_earnings JSONB DEFAULT '{}',
    betting_spending JSONB DEFAULT '{}',
    betting_pnl JSONB DEFAULT '{}',
    auction_earnings JSONB DEFAULT '{}',
    auction_spending JSONB DEFAULT '{}',
    auction_pnl JSONB DEFAULT '{}',
    lottery_earnings JSONB DEFAULT '{}',
    lottery_spending JSONB DEFAULT '{}',
    lottery_pnl JSONB DEFAULT '{}',
    drop_earnings JSONB DEFAULT '{}',
    drop_spending JSONB DEFAULT '{}',
    drop_pnl JSONB DEFAULT '{}',
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(guild_id, token_identifier)
);

CREATE TABLE IF NOT EXISTS virtual_account_nft_balances (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    collection TEXT NOT NULL,
    identifier TEXT NOT NULL,
    nonce INTEGER NOT NULL,
    nft_name TEXT,
    amount INTEGER DEFAULT 1,
    token_type TEXT DEFAULT 'NFT',
    staked BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(guild_id, user_id, collection, nonce)
);

CREATE TABLE IF NOT EXISTS virtual_account_nft_transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    transaction_id TEXT NOT NULL,
    type TEXT NOT NULL,
    collection TEXT NOT NULL,
    identifier TEXT NOT NULL,
    nonce INTEGER NOT NULL,
    nft_name TEXT,
    amount INTEGER DEFAULT 1,
    token_type TEXT DEFAULT 'NFT',
    tx_hash TEXT,
    source TEXT,
    timestamp BIGINT NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(guild_id, user_id, transaction_id)
);
`;

function quoteIdent(value) {
  if (!/^dstest_[0-9]+$/.test(value)) throw new Error('unsafe database name');
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
  const name = quoteIdent(`dstest_${Date.now()}${Math.floor(Math.random() * 1000)}`);
  await admin.query(`CREATE DATABASE ${name}`);
  await admin.end();
  const client = new Client(pgConfig(name));
  await client.connect();
  try {
    await client.query(SCHEMA);
    await client.query(MIGRATION);
    await client.query(NFT_SETTLEMENT);
    await fn(client);
  } finally {
    await client.end();
    const drop = new Client(pgConfig('esdt_withdrawal_test'));
    await drop.connect();
    await drop.query(`DROP DATABASE ${name}`);
    await drop.end();
  }
}

async function seed(client, balance, userId = 'u', guildId = 'g') {
  const now = Date.now();
  await client.query(
    `INSERT INTO virtual_accounts (guild_id, user_id, username, balances, created_at, last_updated)
     VALUES ($1, $2, 'tester', $3::jsonb, $4, $4)`,
    [guildId, userId, JSON.stringify({ 'DROP-1fc8cc': balance }), now]
  );
}

function reserveArgs(id, amountHuman, amountRaw, extra = {}) {
  return [
    id,
    extra.kind || 'mass_refund',
    extra.business || id,
    extra.interaction || id.replace(/\D/g, '').slice(0, 18).padEnd(18, '1'),
    extra.guild || 'g',
    extra.user || 'u',
    extra.counterpartyGuild || null,
    extra.counterpartyUser || null,
    'DROP-1fc8cc',
    'DROP',
    amountHuman,
    amountRaw,
    8,
    extra.recipient || RECIPIENT,
    SENDER,
    extra.memo || null,
    extra.reserves != null ? extra.reserves : true,
    extra.replayable != null ? extra.replayable : true,
    extra.feeExempt != null ? extra.feeExempt : true,
    extra.effectRequired === true,
    JSON.stringify(extra.payload || {}),
    extra.block || 'other-interaction'
  ];
}

test('postgres refund reservation is idempotent and blocks a second interaction', async () => {
  await withDatabase(async (client) => {
    await seed(client, '10');
    const first = await client.query(
      `SELECT reserve_esdt_disbursement($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21::jsonb,$22) AS result`,
      reserveArgs('mr_100000000000000301_u_DROP-1fc8cc', '4', '400000000', { interaction: '100000000000000301' })
    );
    assert.equal(first.rows[0].result.created, true);
    const retry = await client.query(
      `SELECT reserve_esdt_disbursement($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21::jsonb,$22) AS result`,
      reserveArgs('mr_100000000000000301_u_DROP-1fc8cc', '4', '400000000', { interaction: '100000000000000301' })
    );
    assert.equal(retry.rows[0].result.created, false);
    const balance = await client.query(`SELECT balances->>'DROP-1fc8cc' AS balance FROM virtual_accounts`);
    assert.equal(balance.rows[0].balance, '6');
    await assert.rejects(
      () => client.query(
        `SELECT reserve_esdt_disbursement($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21::jsonb,$22)`,
        reserveArgs('mr_100000000000000302_u_DROP-1fc8cc', '4', '400000000', { interaction: '100000000000000302' })
      ),
      (error) => /unresolved_disbursement/.test(error.message)
    );
    const debits = await client.query(`SELECT count(*)::int AS n FROM virtual_account_transactions WHERE type = 'deduction'`);
    assert.equal(debits.rows[0].n, 1);
  });
});

test('postgres restores a disbursement once and a stale lease cannot settle it', async () => {
  await withDatabase(async (client) => {
    await seed(client, '8');
    await client.query(
      `SELECT reserve_esdt_disbursement($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21::jsonb,$22)`,
      reserveArgs('mr_100000000000000303_u_DROP-1fc8cc', '3', '300000000', { interaction: '100000000000000303' })
    );
    const first = await client.query(
      `SELECT claim_esdt_disbursement_lease('mr_100000000000000303_u_DROP-1fc8cc', 'worker-a', 150) AS result`
    );
    const fenceA = first.rows[0].result.fence;
    await client.query(
      `UPDATE esdt_disbursements SET processing_lease_until = clock_timestamp() - interval '1 second'
       WHERE disbursement_id = 'mr_100000000000000303_u_DROP-1fc8cc'`
    );
    const second = await client.query(
      `SELECT claim_esdt_disbursement_lease('mr_100000000000000303_u_DROP-1fc8cc', 'worker-b', 150) AS result`
    );
    const fenceB = second.rows[0].result.fence;
    await assert.rejects(
      () => client.query(
        `SELECT confirm_esdt_disbursement($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        ['mr_100000000000000303_u_DROP-1fc8cc', 'worker-a', fenceA, HASH, 'op', 200, true, '0', null, '20']
      ),
      (error) => /lease_lost/.test(error.message)
    );
    await client.query(
      `SELECT fail_esdt_disbursement($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      ['mr_100000000000000303_u_DROP-1fc8cc', 'worker-b', fenceB, true, 'EXECUTION_FAILED', 'reverted', 422, 'op', HASH]
    );
    await client.query(
      `SELECT fail_esdt_disbursement($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      ['mr_100000000000000303_u_DROP-1fc8cc', 'worker-b', fenceB, true, 'EXECUTION_FAILED', 'again', 422, 'op', HASH]
    );
    const balance = await client.query(`SELECT balances->>'DROP-1fc8cc' AS balance FROM virtual_accounts`);
    assert.equal(balance.rows[0].balance, '8');
    const restores = await client.query(
      `SELECT count(*)::int AS n FROM virtual_account_transactions WHERE transaction_id = 'esdt-disburse-restore:mr_100000000000000303_u_DROP-1fc8cc'`
    );
    assert.equal(restores.rows[0].n, 1);
  });
});

test('postgres credits a cross-guild counterparty once and applies house spending once', async () => {
  await withDatabase(async (client) => {
    await seed(client, '5', 'u', 'g1');
    await seed(client, '1', 'u', 'g2');
    const reserved = await client.query(
      `SELECT reserve_esdt_disbursement($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21::jsonb,$22) AS result`,
      reserveArgs('xg_100000000000000304', '2', '200000000', {
        kind: 'cross_guild',
        interaction: '100000000000000304',
        guild: 'g1',
        counterpartyGuild: 'g2',
        counterpartyUser: 'u',
        block: 'none'
      })
    );
    assert.equal(reserved.rows[0].result.created, true);
    const lease = await client.query(
      `SELECT claim_esdt_disbursement_lease('xg_100000000000000304', 'worker-a', 150) AS result`
    );
    await client.query(
      `SELECT confirm_esdt_disbursement($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      ['xg_100000000000000304', 'worker-a', lease.rows[0].result.fence, HASH, 'op', 200, true, '0', null, '9']
    );
    await client.query(
      `SELECT confirm_esdt_disbursement($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      ['xg_100000000000000304', 'worker-a', lease.rows[0].result.fence, HASH, 'op', 200, true, '0', null, '9']
    );
    const source = await client.query(`SELECT balances->>'DROP-1fc8cc' AS balance FROM virtual_accounts WHERE guild_id = 'g1'`);
    const dest = await client.query(`SELECT balances->>'DROP-1fc8cc' AS balance FROM virtual_accounts WHERE guild_id = 'g2'`);
    assert.equal(source.rows[0].balance, '3');
    assert.equal(dest.rows[0].balance, '3');
    const credits = await client.query(
      `SELECT count(*)::int AS n FROM virtual_account_transactions WHERE transaction_id = 'esdt-disburse-credit:xg_100000000000000304'`
    );
    assert.equal(credits.rows[0].n, 1);

    await client.query(
      `SELECT reserve_esdt_disbursement($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21::jsonb,$22)`,
      reserveArgs('hw_100000000000000305', '1', '100000000', {
        kind: 'house_withdraw',
        interaction: '100000000000000305',
        guild: 'g1',
        recipient: OTHER,
        reserves: false,
        effectRequired: true,
        payload: { source: 'betting' },
        block: 'guild-kind'
      })
    );
    const houseLease = await client.query(
      `SELECT claim_esdt_disbursement_lease('hw_100000000000000305', 'worker-a', 150) AS result`
    );
    await client.query(
      `SELECT confirm_esdt_disbursement($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      ['hw_100000000000000305', 'worker-a', houseLease.rows[0].result.fence, HASH, 'op-house', 200, true, '0', null, '10']
    );
    await client.query(`SELECT note_esdt_disbursement_effect('hw_100000000000000305')`);
    await client.query(`SELECT note_esdt_disbursement_effect('hw_100000000000000305')`);
    const spending = await client.query(
      `SELECT betting_spending->>'DROP-1fc8cc' AS spent FROM house_balance WHERE guild_id = 'g1'`
    );
    assert.equal(spending.rows[0].spent, '100000000');
  });
});

const RESERVE_SQL = `SELECT reserve_esdt_disbursement($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21::jsonb,$22) AS result`;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForLockWaiter(client) {
  const started = Date.now();
  while (Date.now() - started < 5000) {
    const seen = await client.query(`
      SELECT count(*)::int AS n
      FROM pg_stat_activity
      WHERE datname = current_database()
        AND pid <> pg_backend_pid()
        AND wait_event_type = 'Lock'
    `);
    if (seen.rows[0].n > 0) return;
    await delay(20);
  }
  throw new Error('the overlapping reservation did not wait on the disbursement lock');
}

async function overlapReserve(client, argsA, argsB) {
  const dbName = (await client.query('SELECT current_database() AS name')).rows[0].name;
  const other = new Client(pgConfig(dbName));
  await other.connect();
  try {
    await client.query('BEGIN');
    const first = await client.query(RESERVE_SQL, argsA);
    const pending = other.query('BEGIN').then(() => other.query(RESERVE_SQL, argsB));
    try {
      await waitForLockWaiter(client);
      await client.query('COMMIT');
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch { /* transaction already closed */ }
      pending.catch(() => {});
      throw error;
    }
    try {
      const second = await pending;
      await other.query('COMMIT');
      return { first: first.rows[0].result, second: second.rows[0].result, secondError: null };
    } catch (error) {
      await other.query('ROLLBACK');
      return { first: first.rows[0].result, second: null, secondError: error };
    }
  } finally {
    await other.end();
  }
}

test('overlapping reservations for one block scope create a single payment', async () => {
  await withDatabase(async (client) => {
    await seed(client, '10', 'u1');
    await seed(client, '10', 'u2');

    const house = await overlapReserve(
      client,
      reserveArgs('hw_100000000000000401', '1', '100000000', {
        kind: 'house_withdraw',
        interaction: '100000000000000401',
        reserves: false,
        effectRequired: true,
        payload: { source: 'betting' },
        block: 'guild-kind'
      }),
      reserveArgs('hw_100000000000000402', '1', '100000000', {
        kind: 'house_withdraw',
        interaction: '100000000000000402',
        reserves: false,
        effectRequired: true,
        payload: { source: 'betting' },
        block: 'guild-kind'
      })
    );
    assert.equal(house.first.created, true);
    assert.match(house.secondError.message, /unresolved_disbursement/);

    const subscription = await overlapReserve(
      client,
      reserveArgs('sub_100000000000000411', '4', '400000000', {
        kind: 'subscription',
        interaction: '100000000000000411',
        user: 'u1',
        effectRequired: true,
        payload: { planMonths: 1 },
        block: 'guild-kind'
      }),
      reserveArgs('sub_100000000000000412', '4', '400000000', {
        kind: 'subscription',
        interaction: '100000000000000412',
        user: 'u2',
        effectRequired: true,
        payload: { planMonths: 1 },
        block: 'guild-kind'
      })
    );
    assert.equal(subscription.first.created, true);
    assert.match(subscription.secondError.message, /unresolved_disbursement/);
    const subBalances = await client.query(
      `SELECT user_id, balances->>'DROP-1fc8cc' AS balance FROM virtual_accounts WHERE user_id IN ('u1', 'u2') ORDER BY user_id`
    );
    assert.deepEqual(subBalances.rows.map((row) => row.balance), ['6', '10']);

    const refund = await overlapReserve(
      client,
      reserveArgs('mr_100000000000000421_u1_DROP-1fc8cc', '2', '200000000', {
        interaction: '100000000000000421',
        user: 'u1',
        block: 'other-interaction'
      }),
      reserveArgs('mr_100000000000000422_u2_DROP-1fc8cc', '2', '200000000', {
        interaction: '100000000000000422',
        user: 'u2',
        block: 'other-interaction'
      })
    );
    assert.equal(refund.first.created, true);
    assert.match(refund.secondError.message, /unresolved_disbursement/);

    const admin = await overlapReserve(
      client,
      reserveArgs('send_100000000000000431', '1', '100000000', {
        kind: 'admin_send',
        interaction: '100000000000000431',
        reserves: false,
        feeExempt: false,
        block: 'recipient'
      }),
      reserveArgs('send_100000000000000432', '1', '100000000', {
        kind: 'admin_send',
        interaction: '100000000000000432',
        reserves: false,
        feeExempt: false,
        block: 'recipient'
      })
    );
    assert.equal(admin.first.created, true);
    assert.match(admin.secondError.message, /unresolved_disbursement/);

    const nft = await overlapReserve(
      client,
      reserveArgs('nr_100000000000000441_asset000000000001', '1', '100000000', {
        kind: 'nft_transfer',
        interaction: '100000000000000441',
        user: 'nft-holder',
        reserves: false,
        replayable: false,
        feeExempt: false,
        block: 'asset'
      }),
      reserveArgs('nr_100000000000000442_asset000000000002', '1', '100000000', {
        kind: 'nft_transfer',
        interaction: '100000000000000442',
        user: 'nft-holder',
        reserves: false,
        replayable: false,
        feeExempt: false,
        block: 'asset'
      })
    );
    assert.equal(nft.first.created, true);
    assert.match(nft.secondError.message, /unresolved_disbursement/);

    const rows = await client.query(
      `SELECT operation_kind, count(*)::int AS n FROM esdt_disbursements GROUP BY operation_kind ORDER BY operation_kind`
    );
    assert.deepEqual(rows.rows, [
      { operation_kind: 'admin_send', n: 1 },
      { operation_kind: 'house_withdraw', n: 1 },
      { operation_kind: 'mass_refund', n: 1 },
      { operation_kind: 'nft_transfer', n: 1 },
      { operation_kind: 'subscription', n: 1 }
    ]);
    const debits = await client.query(`SELECT count(*)::int AS n FROM virtual_account_transactions WHERE type = 'deduction'`);
    assert.equal(debits.rows[0].n, 2);
  });
});

test('the same disbursement id reserves once even when two transactions overlap', async () => {
  await withDatabase(async (client) => {
    await seed(client, '10');
    const args = reserveArgs('mr_100000000000000451_u_DROP-1fc8cc', '4', '400000000', {
      interaction: '100000000000000451'
    });
    const raced = await overlapReserve(client, args, args);
    assert.equal(raced.first.created, true);
    assert.equal(raced.secondError, null);
    assert.equal(raced.second.created, false);
    const balance = await client.query(`SELECT balances->>'DROP-1fc8cc' AS balance FROM virtual_accounts`);
    assert.equal(balance.rows[0].balance, '6');
    const debits = await client.query(`SELECT count(*)::int AS n FROM virtual_account_transactions WHERE type = 'deduction'`);
    assert.equal(debits.rows[0].n, 1);
  });
});

test('a confirmed payment cannot be restored and a subscription effect is applied once', async () => {
  await withDatabase(async (client) => {
    await seed(client, '8');
    await client.query(RESERVE_SQL, reserveArgs('mr_100000000000000461_u_DROP-1fc8cc', '3', '300000000', {
      interaction: '100000000000000461'
    }));
    const lease = await client.query(
      `SELECT claim_esdt_disbursement_lease('mr_100000000000000461_u_DROP-1fc8cc', 'worker-a', 150) AS result`
    );
    await client.query(
      `SELECT confirm_esdt_disbursement($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      ['mr_100000000000000461_u_DROP-1fc8cc', 'worker-a', lease.rows[0].result.fence, HASH, 'op', 200, true, '0', null, '11']
    );
    await assert.rejects(
      () => client.query(
        `SELECT fail_esdt_disbursement($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        ['mr_100000000000000461_u_DROP-1fc8cc', 'worker-a', lease.rows[0].result.fence, true, 'EXECUTION_FAILED', 'too late', 422, 'op', HASH]
      ),
      (error) => /invalid_transition/.test(error.message)
    );
    const balance = await client.query(`SELECT balances->>'DROP-1fc8cc' AS balance FROM virtual_accounts`);
    assert.equal(balance.rows[0].balance, '5');
    const restores = await client.query(
      `SELECT count(*)::int AS n FROM virtual_account_transactions WHERE transaction_id LIKE 'esdt-disburse-restore:%'`
    );
    assert.equal(restores.rows[0].n, 0);

    await client.query(RESERVE_SQL, reserveArgs('sub_100000000000000462', '1', '100000000', {
      kind: 'subscription',
      interaction: '100000000000000462',
      effectRequired: true,
      payload: { planMonths: 1, amountUsdc: '1' },
      block: 'guild-kind'
    }));
    const subLease = await client.query(
      `SELECT claim_esdt_disbursement_lease('sub_100000000000000462', 'worker-a', 150) AS result`
    );
    await client.query(
      `SELECT confirm_esdt_disbursement($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      ['sub_100000000000000462', 'worker-a', subLease.rows[0].result.fence, HASH, 'op-sub', 200, true, '0', null, '12']
    );
    const firstEffect = await client.query(`SELECT note_esdt_disbursement_effect('sub_100000000000000462') AS result`);
    const secondEffect = await client.query(`SELECT note_esdt_disbursement_effect('sub_100000000000000462') AS result`);
    assert.equal(firstEffect.rows[0].result.claimed, true);
    assert.equal(secondEffect.rows[0].result.claimed, false);
    const houses = await client.query(`SELECT count(*)::int AS n FROM house_balance`);
    assert.equal(houses.rows[0].n, 0);
    const after = await client.query(`SELECT balances->>'DROP-1fc8cc' AS balance FROM virtual_accounts`);
    assert.equal(after.rows[0].balance, '4');
    await assert.rejects(
      () => client.query(
        `SELECT fail_esdt_disbursement($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        ['sub_100000000000000462', 'worker-a', subLease.rows[0].result.fence, true, 'EXECUTION_FAILED', 'too late', 422, 'op-sub', HASH]
      ),
      (error) => /invalid_transition/.test(error.message)
    );
    assert.equal((await client.query(`SELECT balances->>'DROP-1fc8cc' AS balance FROM virtual_accounts`)).rows[0].balance, '4');
  });
});

test('postgres NFT settlement removes one inventory row and a repeated call does not', async () => {
  await withDatabase(async (client) => {
    const id = 'nr_1568347763505373234_32717ded09f1771d208c3666';
    await client.query(
      `INSERT INTO virtual_account_nft_balances
        (guild_id, user_id, collection, identifier, nonce, nft_name, amount, token_type)
       VALUES
        ('g', 'u', 'EMP-897b49', 'EMP-897b49-105c', 4188, 'Empyreans #1679', 1, 'NFT'),
        ('g', 'other', 'EMP-897b49', 'EMP-897b49-105c', 4188, 'someone else', 1, 'NFT')`
    );
    await client.query(RESERVE_SQL, [
      id, 'nft_transfer', id, '1568347763505373234', 'g', 'u', null, null,
      'EMP-897b49-105c', 'EMP', '1', '1', 0, RECIPIENT, SENDER, 'NFT withdrawal',
      false, true, false, false,
      JSON.stringify({ assets: [{ collection: 'EMP-897b49', nonce: 4188, quantity: 1, identifier: 'EMP-897b49-105c' }] }),
      'asset'
    ]);
    const lease = await client.query(
      `SELECT claim_esdt_disbursement_lease($1, 'worker-a', 150) AS result`,
      [id]
    );
    const fence = lease.rows[0].result.fence;
    const args = [id, 'worker-a', fence, HASH, 'op', 200, true, null, null, '1825', 'g', 'u', RECIPIENT];
    await assert.rejects(
      () => client.query(
        `SELECT settle_nft_disbursement_withdrawal($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [id, 'worker-a', fence, HASH, 'op', 200, true, null, null, '1825', 'g', 'someone-else', RECIPIENT]
      ),
      (error) => /nft_settlement_mismatch/.test(error.message)
    );
    const settled = await client.query(
      `SELECT settle_nft_disbursement_withdrawal($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) AS result`,
      args
    );
    assert.equal(settled.rows[0].result.idempotent, false);
    assert.equal(settled.rows[0].result.record.status, 'CONFIRMED');
    const again = await client.query(
      `SELECT settle_nft_disbursement_withdrawal($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) AS result`,
      args
    );
    assert.equal(again.rows[0].result.idempotent, true);
    const mine = await client.query(`SELECT count(*)::int AS n FROM virtual_account_nft_balances WHERE user_id = 'u'`);
    assert.equal(mine.rows[0].n, 0);
    const other = await client.query(`SELECT amount FROM virtual_account_nft_balances WHERE user_id = 'other'`);
    assert.equal(other.rows[0].amount, 1);
    const audits = await client.query(
      `SELECT tx_hash, count(*)::int AS n FROM virtual_account_nft_transactions GROUP BY tx_hash`
    );
    assert.equal(audits.rows.length, 1);
    assert.equal(audits.rows[0].n, 1);
    assert.equal(audits.rows[0].tx_hash, HASH);
  });
});
