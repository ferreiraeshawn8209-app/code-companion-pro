CREATE TABLE public.vercel_deployments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  vercel_project_id TEXT,
  vercel_project_name TEXT,
  deployment_id TEXT,
  deployment_url TEXT,
  target TEXT NOT NULL DEFAULT 'preview',
  state TEXT NOT NULL DEFAULT 'QUEUED',
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.vercel_deployments TO authenticated;
GRANT ALL ON public.vercel_deployments TO service_role;

ALTER TABLE public.vercel_deployments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "owners view deployments"
  ON public.vercel_deployments FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = vercel_deployments.project_id AND p.owner_id = auth.uid()));

CREATE POLICY "owners insert deployments"
  ON public.vercel_deployments FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND EXISTS (SELECT 1 FROM public.projects p WHERE p.id = vercel_deployments.project_id AND p.owner_id = auth.uid()));

CREATE POLICY "owners update deployments"
  ON public.vercel_deployments FOR UPDATE TO authenticated
  USING (user_id = auth.uid());

CREATE TRIGGER update_vercel_deployments_updated_at
  BEFORE UPDATE ON public.vercel_deployments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS vercel_project_id TEXT,
  ADD COLUMN IF NOT EXISTS vercel_project_name TEXT,
  ADD COLUMN IF NOT EXISTS mobile_app_id TEXT,
  ADD COLUMN IF NOT EXISTS mobile_app_name TEXT,
  ADD COLUMN IF NOT EXISTS mobile_live_reload BOOLEAN NOT NULL DEFAULT true;