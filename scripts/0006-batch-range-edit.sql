-- Manual batch slab-range edits: range confirmations + manually-added slabs.
create table if not exists batch_range_edit (
  id text primary key,
  batch_key text not null,
  slab_number double precision,         -- null for a 'confirm' row
  kind text not null,                   -- 'confirm' | 'add'
  entered_by text,
  created_at timestamp not null default now(),
  unique (batch_key, kind, slab_number)
);
create index if not exists idx_bre_batch on batch_range_edit(batch_key);
