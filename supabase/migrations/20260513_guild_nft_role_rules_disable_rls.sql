-- Bot uses SUPABASE_ANON_KEY (PostgREST as anon). With RLS enabled and no policies,
-- inserts/updates fail. Match other guild-scoped bot tables: no RLS on this table.
ALTER TABLE guild_nft_role_rules DISABLE ROW LEVEL SECURITY;
