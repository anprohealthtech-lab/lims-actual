-- Drop the trigger and function that auto-insert all global analytes into
-- lab_analytes when a new lab is created. This was creating unwanted null-name
-- lab_analyte rows for every global analyte in every lab.

DROP TRIGGER IF EXISTS on_lab_insert_create_lab_analytes ON public.labs;
DROP FUNCTION IF EXISTS public.create_lab_analytes_for_new_lab();
DROP FUNCTION IF EXISTS public.add_global_analytes_to_existing_labs();
