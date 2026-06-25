ALTER TABLE public.labs
ADD COLUMN IF NOT EXISTS portal_settings jsonb NOT NULL DEFAULT jsonb_build_object(
  'welcome_note', '',
  'updates_enabled', true,
  'updates_title', 'Partner Portal Updates',
  'update_slides', '[]'::jsonb,
  'hide_lims_branding', false
);

COMMENT ON COLUMN public.labs.portal_settings IS
  'Common B2B partner portal content and display options for all accounts in the lab.';
