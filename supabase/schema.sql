create table if not exists public.shopping_items (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  text text not null,
  erledigt boolean not null default false,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists shopping_items_user_id_idx
  on public.shopping_items (user_id);

create index if not exists shopping_items_user_id_position_idx
  on public.shopping_items (user_id, position);

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

alter table public.shopping_items enable row level security;

drop policy if exists "shopping_items_select_own" on public.shopping_items;
create policy "shopping_items_select_own"
on public.shopping_items
for select
using (auth.uid() = user_id);

drop policy if exists "shopping_items_insert_own" on public.shopping_items;
create policy "shopping_items_insert_own"
on public.shopping_items
for insert
with check (auth.uid() = user_id);

drop policy if exists "shopping_items_update_own" on public.shopping_items;
create policy "shopping_items_update_own"
on public.shopping_items
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "shopping_items_delete_own" on public.shopping_items;
create policy "shopping_items_delete_own"
on public.shopping_items
for delete
using (auth.uid() = user_id);
