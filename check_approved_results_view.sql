SELECT 
  schemaname,
  viewname,
  definition
FROM pg_views
WHERE viewname = 'view_approved_results'
  AND schemaname = 'public';
