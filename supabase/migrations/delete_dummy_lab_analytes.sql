-- Delete lab_analytes for MediLab Central (dummy lab)
DELETE FROM lab_analytes
WHERE lab_id IN (
  SELECT id FROM labs WHERE name = 'MediLab Central'
);

-- Verify deletion
SELECT 
  COUNT(*) as remaining_lab_analytes,
  'After deleting MediLab Central' as status
FROM lab_analytes;
