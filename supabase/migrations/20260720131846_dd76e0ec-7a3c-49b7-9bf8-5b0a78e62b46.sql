
-- Admins manage role assignments; regular users cannot self-assign roles.
CREATE POLICY "Admins can insert user_roles" ON public.user_roles
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can update user_roles" ON public.user_roles
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can delete user_roles" ON public.user_roles
  FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- Owners can delete their own deployment records for cleanup.
CREATE POLICY "Owners can delete their vercel_deployments" ON public.vercel_deployments
  FOR DELETE TO authenticated
  USING (auth.uid() = user_id);
