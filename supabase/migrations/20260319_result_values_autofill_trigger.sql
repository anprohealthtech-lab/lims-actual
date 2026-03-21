-- Trigger: auto-fill missing linking fields on result_values after INSERT
-- Fills: sample_id, order_test_group_id, test_group_id, order_test_id, units

create or replace function fill_result_value_links()
returns trigger language plpgsql as $$
declare
  v_sample_id         uuid;
  v_order_test_group_id uuid;
  v_test_group_id     uuid;
  v_order_test_id     uuid;
begin
  -- 1. Fill sample_id from samples table
  if NEW.sample_id is null and NEW.order_id is not null then
    select id into v_sample_id
    from samples
    where order_id = NEW.order_id
    limit 1;

    NEW.sample_id := v_sample_id;
  end if;

  -- 2. Fill test_group_id scoped to this order
  --    Try order_test_groups first, then order_tests, then global fallback
  if NEW.test_group_id is null
     and NEW.analyte_id is not null
     and NEW.order_id is not null
  then
    -- Primary: order_test_groups (most labs use this)
    select tga.test_group_id, otg.id
    into v_test_group_id, v_order_test_group_id
    from test_group_analytes tga
    join order_test_groups otg on otg.test_group_id = tga.test_group_id
                              and otg.order_id = NEW.order_id
    where tga.analyte_id = NEW.analyte_id
    limit 1;

    -- Secondary: order_tests
    if v_test_group_id is null then
      select tga.test_group_id, ot.id
      into v_test_group_id, v_order_test_id
      from test_group_analytes tga
      join order_tests ot on ot.test_group_id = tga.test_group_id
                         and ot.order_id = NEW.order_id
      where tga.analyte_id = NEW.analyte_id
      limit 1;
    end if;

    -- Last resort: just use the order's own test group from order_tests
    if v_test_group_id is null then
      select test_group_id, id
      into v_test_group_id, v_order_test_id
      from order_tests
      where order_id = NEW.order_id
        and test_group_id is not null
      limit 1;
    end if;

    -- Final fallback: order_test_groups
    if v_test_group_id is null then
      select test_group_id, id
      into v_test_group_id, v_order_test_group_id
      from order_test_groups
      where order_id = NEW.order_id
        and test_group_id is not null
      limit 1;
    end if;

    if v_test_group_id is not null then
      NEW.test_group_id := v_test_group_id;

      if v_order_test_group_id is not null then
        NEW.order_test_group_id := v_order_test_group_id;
      end if;

      -- order_test_id: look up order_tests if not already found
      if v_order_test_id is null then
        select id into v_order_test_id
        from order_tests
        where order_id = NEW.order_id
          and test_group_id = v_test_group_id
        limit 1;
      end if;

      if v_order_test_id is not null then
        NEW.order_test_id := v_order_test_id;
      end if;

      -- Fix parent results record so all views find it
      UPDATE results
        SET
          test_group_id = COALESCE(test_group_id, v_test_group_id),
          order_test_id = COALESCE(order_test_id, v_order_test_id)
        WHERE id = NEW.result_id
          AND (test_group_id IS NULL OR order_test_id IS NULL);
    end if;
  end if;

  -- 3. Copy unit → units if units is null
  if NEW.units is null and NEW.unit is not null then
    NEW.units := NEW.unit;
  end if;

  return NEW;
end;
$$;

-- Drop if exists then recreate
drop trigger if exists trg_fill_result_value_links on result_values;

create trigger trg_fill_result_value_links
  before insert on result_values
  for each row
  execute function fill_result_value_links();

-- Backfill existing rows: set test_group_id + order_test_id from order_tests
UPDATE result_values rv
SET
  test_group_id = ot.test_group_id,
  order_test_id = ot.id
FROM order_tests ot
WHERE ot.order_id = rv.order_id
  AND ot.test_group_id IS NOT NULL
  AND rv.test_group_id IS NULL;

-- Backfill from order_test_groups for labs that use that table
UPDATE result_values rv
SET
  test_group_id    = otg.test_group_id,
  order_test_group_id = otg.id
FROM order_test_groups otg
WHERE otg.order_id = rv.order_id
  AND otg.test_group_id IS NOT NULL
  AND rv.test_group_id IS NULL;

-- Backfill sample_id where missing
UPDATE result_values rv
SET sample_id = s.id
FROM samples s
WHERE s.order_id = rv.order_id
  AND rv.sample_id IS NULL;

-- Backfill units from unit
UPDATE result_values
SET units = unit
WHERE units IS NULL AND unit IS NOT NULL;

-- Backfill results header: test_group_id + order_test_id from order_tests
UPDATE results r
SET
  test_group_id = ot.test_group_id,
  order_test_id = ot.id
FROM order_tests ot
WHERE ot.order_id = r.order_id
  AND ot.test_group_id IS NOT NULL
  AND r.test_group_id IS NULL;

-- Backfill results header from order_test_groups
UPDATE results r
SET test_group_id = otg.test_group_id
FROM order_test_groups otg
WHERE otg.order_id = r.order_id
  AND otg.test_group_id IS NOT NULL
  AND r.test_group_id IS NULL;
