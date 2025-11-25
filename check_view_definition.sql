-- Query to get the v_report_template_context view definition
SELECT 
  schemaname,
  viewname,
  definition
FROM pg_views
WHERE viewname = 'v_report_template_context'
  AND schemaname = 'public';
