-- Add package_id column to order_tests to link tests from packages
-- This allows tracking which tests came from which package

ALTER TABLE public.order_tests 
ADD COLUMN IF NOT EXISTS package_id uuid REFERENCES public.packages(id);

-- Add comment for documentation
COMMENT ON COLUMN public.order_tests.package_id IS 'Reference to the package this test belongs to (if added as part of a package)';

-- Create index for faster package-based queries
CREATE INDEX IF NOT EXISTS idx_order_tests_package_id ON public.order_tests(package_id);
