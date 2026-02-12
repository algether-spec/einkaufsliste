create table if not exists public.shopping_items (
  id bigint generated always as identity primary key,
  sync_code text not null,
  text text not null,
  erledigt boolean not null default false,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists shopping_items_sync_code_idx
  on public.shopping_items (sync_code);

create index if not exists shopping_items_sync_code_position_idx
  on public.shopping_items (sync_code, position);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_shopping_items_updated_at on public.shopping_items;
create trigger trg_shopping_items_updated_at
before update on public.shopping_items
for each row execute function public.set_updated_at();

grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on public.shopping_items to anon, authenticated;
grant usage, select on sequence public.shopping_items_id_seq to anon, authenticated;

alter table public.shopping_items enable row level security;

drop policy if exists "shopping_items_select_by_code" on public.shopping_items;
create policy "shopping_items_select_by_code"
on public.shopping_items
for select
using (true);

drop policy if exists "shopping_items_insert_by_code" on public.shopping_items;
create policy "shopping_items_insert_by_code"
on public.shopping_items
for insert
with check (sync_code is not null and length(sync_code) > 0);

drop policy if exists "shopping_items_update_by_code" on public.shopping_items;
create policy "shopping_items_update_by_code"
on public.shopping_items
for update
using (true)
with check (sync_code is not null and length(sync_code) > 0);

drop policy if exists "shopping_items_delete_by_code" on public.shopping_items;
create policy "shopping_items_delete_by_code"
on public.shopping_items
for delete
using (true);
