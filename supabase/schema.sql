create table if not exists product_candidates (
  id text primary key,
  source_fingerprint text not null unique,
  seller_sku text not null,
  cj_product_id text not null,
  cj_variant_id text not null,
  title text not null,
  normalized_keyword text not null,
  category_path text not null,
  warehouse_country text not null,
  landed_cost numeric(10, 2) not null,
  shipping_cost numeric(10, 2) not null,
  stock integer not null,
  estimated_delivery_business_days integer not null,
  supplier_name text not null,
  image_url text not null,
  tags jsonb not null default '[]'::jsonb,
  target_price numeric(10, 2) not null,
  status text not null,
  policy_state text not null,
  risk_class text not null,
  marketplace text not null,
  managed_by_system boolean not null default true,
  search_snapshot jsonb,
  score_breakdown jsonb,
  policy_matches jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists product_candidates_status_score_idx
  on product_candidates (status, ((score_breakdown->>'totalScore')::numeric) desc, created_at desc);

create table if not exists candidate_scores (
  candidate_id text primary key references product_candidates(id) on delete cascade,
  payload jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists drafts (
  id uuid primary key,
  candidate_id uuid not null,
  marketplace text not null default 'EBAY_US',
  seller_sku text not null,
  title text not null,
  subtitle text,
  description text not null,
  bullets jsonb not null default '[]'::jsonb,
  item_specifics jsonb not null default '{}'::jsonb,
  images jsonb not null default '[]'::jsonb,
  price numeric(10, 2) not null,
  quantity integer not null default 1,
  warning_messages jsonb not null default '[]'::jsonb,
  status text not null check (status in ('needs_review', 'ready_to_publish', 'published', 'rejected')),
  approval_required boolean not null default true,
  overall_score numeric(5, 2),
  validation_status text not null default 'warning',
  publish_ready boolean not null default false,
  ebay_inventory_item_id text,
  ebay_offer_id text,
  offer_category_id text,
  historical_import boolean not null default false,
  open_in_ebay_url text,
  open_in_cj_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists drafts_marketplace_sku_idx
  on drafts (marketplace, seller_sku);

create index if not exists drafts_status_created_idx
  on drafts (status, created_at desc);

create index if not exists drafts_candidate_idx
  on drafts (candidate_id);

create table if not exists ebay_listings (
  id text primary key,
  marketplace text not null,
  seller_sku text not null,
  draft_id text not null,
  ebay_offer_id text,
  created_at timestamptz not null default now()
);

create unique index if not exists ebay_listings_marketplace_sku_idx
  on ebay_listings (marketplace, seller_sku);

create table if not exists orders (
  id text primary key,
  ebay_order_id text not null unique,
  draft_id text not null,
  seller_sku text not null,
  buyer_user_id text not null,
  order_total_usd numeric(10, 2) not null,
  quantity integer not null,
  destination_country text not null,
  address jsonb not null,
  fulfillment_status text not null,
  risk_class text not null,
  tracking_number text,
  carrier text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists orders_created_fulfillment_idx
  on orders (created_at desc, fulfillment_status, risk_class);

create table if not exists fulfillment_jobs (
  id text primary key,
  order_id text not null references orders(id) on delete cascade,
  idempotency_key text not null unique,
  cj_order_id text,
  status text not null,
  attempt_count integer not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists fulfillment_jobs_status_attempt_idx
  on fulfillment_jobs (status, updated_at desc);

create table if not exists tracking_events (
  id text primary key,
  ebay_order_id text not null,
  payload jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists tracking_events_order_created_idx
  on tracking_events (ebay_order_id, created_at desc);

create table if not exists support_threads (
  id text primary key,
  state text not null,
  priority text not null,
  payload jsonb not null,
  updated_at timestamptz not null default now()
);

create index if not exists support_threads_state_priority_idx
  on support_threads (state, priority, updated_at desc);

create table if not exists dead_letters (
  id text primary key,
  resource_type text not null,
  resource_id text not null,
  stage text not null,
  payload jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists dead_letters_resource_stage_idx
  on dead_letters (resource_type, stage, created_at desc);

create table if not exists agent_runs (
  id text primary key,
  job_type text not null,
  status text not null,
  summary text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

create index if not exists agent_runs_job_started_idx
  on agent_runs (job_type, started_at desc, status);

create table if not exists alerts (
  id text primary key,
  status text not null,
  severity text not null,
  message text not null,
  context text not null,
  created_at timestamptz not null default now()
);

create index if not exists alerts_status_severity_idx
  on alerts (status, severity, created_at desc);
