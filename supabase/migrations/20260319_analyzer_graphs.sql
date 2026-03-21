-- Stores decoded histogram/graph data from analyzer raw messages
-- One row per graph (WBC histogram, RBC histogram, PLT histogram, etc.)

create table if not exists analyzer_graphs (
  id              uuid primary key default gen_random_uuid(),
  lab_id          uuid not null references labs(id) on delete cascade,
  order_id        uuid not null references orders(id) on delete cascade,
  result_id       uuid references results(id) on delete set null,
  raw_message_id  uuid references analyzer_raw_messages(id) on delete set null,

  test_code       text not null,          -- e.g. "15000", "15050", "15100"
  name            text not null,          -- e.g. "WBC Histogram"
  associated_test text,                   -- LOINC/local code of the main analyte, e.g. "6690-2"

  histogram_data  jsonb,                  -- raw numeric array: [0, 4, 10, 15, ...]
  boundaries      jsonb,                  -- { leftLine, rightLine, divisionLines: [] }
  svg_data        text,                   -- pre-rendered inline SVG

  created_at      timestamptz not null default now()
);

-- Indexes for common lookups
create index on analyzer_graphs (order_id);
create index on analyzer_graphs (result_id);
create index on analyzer_graphs (lab_id, created_at desc);

-- RLS: lab members can read their own lab's graphs
alter table analyzer_graphs enable row level security;

create policy "Lab members can read analyzer graphs"
  on analyzer_graphs for select
  using (
    lab_id = (select lab_id from users where id = auth.uid())
  );

create policy "Service role full access"
  on analyzer_graphs for all
  using (auth.role() = 'service_role');
