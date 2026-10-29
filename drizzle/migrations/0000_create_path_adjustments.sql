CREATE TABLE public.path_adjustments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  path_id UUID NOT NULL REFERENCES public.learning_paths(id) ON DELETE CASCADE,
  trigger TEXT NOT NULL DEFAULT 'check',
  reason TEXT NOT NULL DEFAULT '',
  detail TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.path_adjustments TO authenticated;
GRANT ALL ON public.path_adjustments TO service_role;
ALTER TABLE public.path_adjustments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "path_adjustments_own" ON public.path_adjustments FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX path_adjustments_path_idx ON public.path_adjustments(path_id, created_at);