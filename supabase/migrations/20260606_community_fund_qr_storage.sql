-- Supabase Storage bucket for auto-generated Community Fund QR codes
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'community-fund-qr',
  'community-fund-qr',
  true,
  1048576,
  ARRAY['image/png']::text[]
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'Public read community fund QR'
  ) THEN
    CREATE POLICY "Public read community fund QR"
    ON storage.objects FOR SELECT
    TO public
    USING (bucket_id = 'community-fund-qr');
  END IF;
END $$;
