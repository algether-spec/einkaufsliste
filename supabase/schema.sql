create table if not exists public.shopping_items (
  id bigint generated always as identity primary key,
  device_token text not null,
  text text not null,
  erledigt boolean not null default false,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists shopping_items_device_token_idx
  on public.shopping_items (device_token);

create index if not exists shopping_items_device_token_position_idx
  on public.shopping_items (device_token, position);
