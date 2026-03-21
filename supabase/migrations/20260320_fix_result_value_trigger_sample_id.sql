-- Fix: v_sample_id was declared as uuid but samples.id is text (custom IDs like "DUM8710-...")
create or replace function fill_result_value_links()
returns trigger language plpgsql as $$
declare
  v_sample_id           text;   -- was uuid, samples.id is text
  v_order_test_group_id uuid;
  v_test_group_id       uuid;
  v_order_test_id       uuid;
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
  if NEW.test_group_id is null
     and NEW.analyte_id is not null
     and NEW.order_id is not null
  then
    -- Primary: order_test_groups
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

    -- Last resort: order_tests
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
