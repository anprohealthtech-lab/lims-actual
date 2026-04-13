-- Enable RLS on accounts
ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;

-- Drop existing policies to ensure clean slate
DROP POLICY IF EXISTS "Enable read access for authenticated users" ON public.accounts;
DROP POLICY IF EXISTS "Enable write access for authenticated users" ON public.accounts;
DROP POLICY IF EXISTS "Enable update for authenticated users" ON public.accounts;
DROP POLICY IF EXISTS "Enable delete for authenticated users" ON public.accounts;
DROP POLICY IF EXISTS "Accounts are viewable by users in same lab" ON public.accounts;
DROP POLICY IF EXISTS "Accounts are insertable by users in same lab" ON public.accounts;
DROP POLICY IF EXISTS "Accounts are updatable by users in same lab" ON public.accounts;
DROP POLICY IF EXISTS "Accounts are deletable by users in same lab" ON public.accounts;


-- Create strict policies for accounts based on lab_id
CREATE POLICY "Accounts are viewable by users in same lab"
ON public.accounts FOR SELECT
TO authenticated
USING (
  lab_id IN (
    SELECT lab_id FROM public.users
    WHERE id = auth.uid()
  )
);

CREATE POLICY "Accounts are insertable by users in same lab"
ON public.accounts FOR INSERT
TO authenticated
WITH CHECK (
  lab_id IN (
    SELECT lab_id FROM public.users
    WHERE id = auth.uid()
  )
);

CREATE POLICY "Accounts are updatable by users in same lab"
ON public.accounts FOR UPDATE
TO authenticated
USING (
  lab_id IN (
    SELECT lab_id FROM public.users
    WHERE id = auth.uid()
  )
)
WITH CHECK (
  lab_id IN (
    SELECT lab_id FROM public.users
    WHERE id = auth.uid()
  )
);

CREATE POLICY "Accounts are deletable by users in same lab"
ON public.accounts FOR DELETE
TO authenticated
USING (
  lab_id IN (
    SELECT lab_id FROM public.users
    WHERE id = auth.uid()
  )
);


-- Fix RLS for account_prices (which I just created incorrectly with USING true)
ALTER TABLE public.account_prices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Enable read access for authenticated users" ON public.account_prices;
DROP POLICY IF EXISTS "Enable write access for authenticated users" ON public.account_prices;
DROP POLICY IF EXISTS "Enable update for authenticated users" ON public.account_prices;
DROP POLICY IF EXISTS "Enable delete for authenticated users" ON public.account_prices;
DROP POLICY IF EXISTS "Account prices are viewable by users in same lab" ON public.account_prices;
DROP POLICY IF EXISTS "Account prices are insertable by users in same lab" ON public.account_prices;
DROP POLICY IF EXISTS "Account prices are updatable by users in same lab" ON public.account_prices;
DROP POLICY IF EXISTS "Account prices are deletable by users in same lab" ON public.account_prices;

CREATE POLICY "Account prices are viewable by users in same lab"
ON public.account_prices FOR SELECT
TO authenticated
USING (
  account_id IN (
    SELECT id FROM public.accounts
    WHERE lab_id IN (
      SELECT lab_id FROM public.users
      WHERE id = auth.uid()
    )
  )
);

CREATE POLICY "Account prices are insertable by users in same lab"
ON public.account_prices FOR INSERT
TO authenticated
WITH CHECK (
  account_id IN (
    SELECT id FROM public.accounts
    WHERE lab_id IN (
       SELECT lab_id FROM public.users
       WHERE id = auth.uid()
    )
  )
);

CREATE POLICY "Account prices are updatable by users in same lab"
ON public.account_prices FOR UPDATE
TO authenticated
USING (
  account_id IN (
    SELECT id FROM public.accounts
    WHERE lab_id IN (
       SELECT lab_id FROM public.users
       WHERE id = auth.uid()
    )
  )
);

CREATE POLICY "Account prices are deletable by users in same lab"
ON public.account_prices FOR DELETE
TO authenticated
USING (
  account_id IN (
    SELECT id FROM public.accounts
    WHERE lab_id IN (
       SELECT lab_id FROM public.users
       WHERE id = auth.uid()
    )
  )
);
