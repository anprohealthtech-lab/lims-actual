-- =====================================================
-- EXTENDED AUDIT - ADDITIONAL DATA CLEANUP CHECKS
-- =====================================================
-- Lab ID: 113bf166-ca18-40cd-9b5e-552958be0d58
-- Use this for more detailed analysis of unused data
-- =====================================================

\set lab_id '113bf166-ca18-40cd-9b5e-552958be0d58'

-- =====================================================
-- Check 1: Account Prices with No Active Test Groups
-- =====================================================

SELECT 
  'ACCOUNT_PRICES' AS category,
  ap.id,
  acc.name AS account_name,
  tg.name AS test_group_name,
  tg.is_active,
  ap.is_active,
  COUNT(DISTINCT o.id) AS recent_orders_30days,
  'Delete if marked inactive' AS recommendation
FROM account_prices ap
JOIN accounts acc ON acc.id = ap.account_id
LEFT JOIN test_groups tg ON tg.id = ap.test_group_id
LEFT JOIN orders o ON o.test_group_id = tg.id 
  AND o.created_at > NOW() - INTERVAL '30 days'
WHERE acc.lab_id = :'lab_id'
  AND tg.is_active = false
GROUP BY ap.id, acc.name, tg.name, tg.is_active, ap.is_active;

-- =====================================================
-- Check 2: Orders with Deleted or Inactive Test Groups
-- =====================================================

SELECT 
  'ORPHANED_ORDERS' AS category,
  o.id,
  o.order_number,
  o.test_group_id,
  COUNT(DISTINCT r.id) AS result_count,
  MAX(o.created_at) AS order_date,
  'Review before any action' AS recommendation
FROM orders o
LEFT JOIN results r ON r.order_id = o.id
WHERE o.lab_id = :'lab_id'
  AND o.test_group_id NOT IN (SELECT id FROM test_groups WHERE lab_id = :'lab_id')
GROUP BY o.id, o.order_number, o.test_group_id;

-- =====================================================
-- Check 3: Invoices with Deleted Test Groups
-- =====================================================

SELECT 
  'INVOICES_ORPHANED_DATA' AS category,
  inv.id,
  inv.invoice_number,
  COUNT(DISTINCT ii.id) AS invoice_item_count,
  'Check item validity' AS recommendation
FROM invoices inv
LEFT JOIN invoice_items ii ON ii.invoice_id = inv.id
WHERE inv.lab_id = :'lab_id'
  AND ii.test_group_id NOT IN (SELECT id FROM test_groups WHERE lab_id = :'lab_id')
GROUP BY inv.id, inv.invoice_number;

-- =====================================================
-- Check 4: Lab Test Group Customizations for Deleted Groups
-- =====================================================

SELECT 
  'LAB_TEST_GROUP_CUSTOM' AS category,
  ltgc.id,
  ltgc.lab_id,
  ltgc.test_group_id,
  tg.name AS test_group_name,
  CASE WHEN tg.id IS NULL THEN 'TEST_GROUP_DELETED' ELSE 'VALID' END AS status,
  'Delete if test group deleted' AS recommendation
FROM lab_test_group_customization ltgc
LEFT JOIN test_groups tg ON tg.id = ltgc.test_group_id
WHERE ltgc.lab_id = :'lab_id'
  AND tg.id IS NULL;

-- =====================================================
-- Check 5: Results with Invalid Test Group References
-- =====================================================

SELECT 
  'RESULTS_INVALID_REF' AS category,
  COUNT(DISTINCT r.id) AS orphaned_result_count,
  'Critical - Results should never be orphaned' AS recommendation
FROM results r
WHERE r.lab_id = :'lab_id'
  AND r.test_group_id NOT IN (SELECT id FROM test_groups WHERE lab_id = :'lab_id');

-- =====================================================
-- Check 6: Test Group Analytes with Invalid Analytes
-- =====================================================

SELECT 
  'TESTGROUP_ANALYTES_INVALID' AS category,
  COUNT(DISTINCT tga.id) AS orphaned_mapping_count,
  'These mappings reference non-existent analytes' AS recommendation
FROM test_group_analytes tga
WHERE tga.test_group_id IN (SELECT id FROM test_groups WHERE lab_id = :'lab_id')
  AND tga.analyte_id NOT IN (SELECT id FROM analytes)
  AND tga.analyte_id NOT IN (SELECT analyte_id FROM lab_analytes WHERE lab_id = :'lab_id');

-- =====================================================
-- Check 7: Result Values Referencing Deleted Analytes
-- =====================================================

SELECT 
  'RESULT_VALUES_INVALID' AS category,
  COUNT(DISTINCT rv.id) AS count_with_deleted_analytes,
  'CRITICAL - These should be investigated' AS recommendation
FROM result_values rv
WHERE rv.result_id IN (SELECT id FROM results WHERE lab_id = :'lab_id')
  AND rv.analyte_id NOT IN (SELECT id FROM analytes)
  AND rv.analyte_id NOT IN (SELECT analyte_id FROM lab_analytes WHERE lab_id = :'lab_id');

-- =====================================================
-- Check 8: Workflow Map Invalid References
-- =====================================================

SELECT 
  'WORKFLOW_MAP_INVALID' AS category,
  COUNT(DISTINCT twm.id) AS count_invalid,
  'Test groups or workflows no longer exist' AS recommendation
FROM test_workflow_map twm
WHERE twm.lab_id = :'lab_id'
  AND (twm.test_group_id NOT IN (SELECT id FROM test_groups WHERE lab_id = :'lab_id')
       OR twm.workflow_id NOT IN (SELECT id FROM workflows WHERE lab_id = :'lab_id'));

-- =====================================================
-- FINAL CLEANUP SUGGESTION REPORT
-- =====================================================

WITH cleanup_items AS (
  -- Unmapped test groups
  SELECT 'Unmapped Test Groups' AS item_type, COUNT(*) AS count, 'Safe to delete' AS safety
  FROM test_groups tg
  WHERE tg.lab_id = :'lab_id'
    AND NOT EXISTS (SELECT 1 FROM test_group_analytes tga WHERE tga.test_group_id = tg.id)
    AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.test_group_id = tg.id)
    AND NOT EXISTS (SELECT 1 FROM results r WHERE r.test_group_id = tg.id)
  
  UNION ALL
  
  -- Orphaned lab analytes
  SELECT 'Orphaned Lab Analytes', COUNT(*), 'Safe to delete'
  FROM lab_analytes la
  WHERE la.lab_id = :'lab_id'
    AND NOT EXISTS (SELECT 1 FROM test_group_analytes tga WHERE tga.analyte_id = la.analyte_id)
    AND NOT EXISTS (SELECT 1 FROM result_values rv WHERE rv.analyte_id = la.analyte_id)
  
  UNION ALL
  
  -- Inactive account prices
  SELECT 'Inactive Account Prices', COUNT(*), 'Consider deletion'
  FROM account_prices ap
  WHERE ap.is_active = false
    AND ap.test_group_id IN (SELECT id FROM test_groups WHERE lab_id = :'lab_id')
)
SELECT 
  'CLEANUP_SUMMARY' AS report,
  item_type,
  count,
  safety
FROM cleanup_items
WHERE count > 0
ORDER BY count DESC;
