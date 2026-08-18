-- International Sales module (ported from Shalman's fork): 20 new tables +
-- 11 enum types, namespaced sales_* / proforma_invoices / pi_* (fork @@map
-- spellings kept — raw SQL in the module references these exact names).
-- Fully additive. Column names are snake_case per the fork's @map, EXCEPT
-- sales_port_arrivals."deliveryStatus" (fork model has no @map there).
-- Columns marked "raw-SQL only" exist in the DB but are deliberately absent
-- from the Prisma models (fork keeps them out of the client to avoid P2022).
-- User references (sp_id, manager_id, created_by_id, checked_by_id, user_id,
-- resolved_by_id, override_by_id, overridden_by_id, assigned_to_id) are plain
-- text columns — no FK to users; the core User model is untouched in Phase 1.
-- NOT YET APPLIED to any database.
DO $$ BEGIN
  CREATE TYPE "SalesOrderStatus" AS ENUM ('DRAFT','PENDING_PAYMENT','PENDING_STOCK_CHECK','STOCK_CONFIRMED','PENDING_PRODUCTION','IN_PRODUCTION','PACKING','DISPATCHED','IN_TRANSIT','PORT_ARRIVED','DELIVERED','CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE "PIStatus" AS ENUM ('DRAFT','SENT','UNDER_REVISION','REJECTED','ACCEPTED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE "ProductType" AS ENUM ('QUARTZ','GRANITE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE "PaymentDivisionType" AS ENUM ('ADVANCE','CAD','INSPECTION','RECEIVE_TO_PAY','BL_TO_PAY','CREDIT');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE "PaymentDivisionStatus" AS ENUM ('PENDING','PAID','OVERDUE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE "SalesProductionJobStatus" AS ENUM ('PENDING','IN_PROGRESS','COMPLETED','ON_HOLD');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE "SalesProductionType" AS ENUM ('SLAB','FAB');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE "PackingListStatus" AS ENUM ('PENDING_SEND','SENT','ACCEPTED','REJECTED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE "StockCheckStatus" AS ENUM ('PENDING','AVAILABLE','UNAVAILABLE','PARTIAL');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE "PortDeliveryStatus" AS ENUM ('PENDING','CLEARED','OVERRIDE','DELIVERED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE "CreditNoteStatus" AS ENUM ('PENDING_INSPECTION','INSPECTED','ISSUED','REJECTED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS sales_manager_assignments (
  id text PRIMARY KEY,
  sp_id text NOT NULL,      -- users.id (no hard FK)
  manager_id text NOT NULL, -- users.id (no hard FK)
  is_active boolean NOT NULL DEFAULT true,
  assigned_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  note text
);

CREATE TABLE IF NOT EXISTS sales_clients (
  id text PRIMARY KEY,
  name text NOT NULL,
  email text,
  is_active boolean NOT NULL DEFAULT true,
  phone text,
  address text,
  country text NOT NULL,
  contact_person text,
  created_by_id text NOT NULL, -- users.id (no hard FK)
  default_currency text,
  default_unit text,
  default_port_of_discharge text,
  default_delivery_terms text,
  default_payment_terms text,
  cc_emails text[],
  created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sales_orders (
  id text PRIMARY KEY,
  order_number text NOT NULL,
  client_id text NOT NULL REFERENCES sales_clients(id),
  sp_id text NOT NULL, -- users.id (no hard FK)
  status "SalesOrderStatus" NOT NULL DEFAULT 'PENDING_PAYMENT',
  total_amount double precision,
  currency text DEFAULT 'USD',
  delivery_terms text,
  notes text,
  invoice_number text, -- PESPL/XXXX format
  created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT sales_orders_order_number_key UNIQUE (order_number),
  CONSTRAINT sales_orders_invoice_number_key UNIQUE (invoice_number)
);

CREATE TABLE IF NOT EXISTS proforma_invoices (
  id text PRIMARY KEY,
  pi_number text NOT NULL,
  sp_id text NOT NULL, -- users.id (no hard FK)
  client_id text NOT NULL REFERENCES sales_clients(id),
  order_id text REFERENCES sales_orders(id),
  status "PIStatus" NOT NULL DEFAULT 'DRAFT',
  product_type "ProductType" NOT NULL DEFAULT 'QUARTZ',
  rejection_count integer NOT NULL DEFAULT 0,
  revision_count integer NOT NULL DEFAULT 0,
  items jsonb NOT NULL,
  total_amount double precision NOT NULL,
  currency text NOT NULL DEFAULT 'USD',
  delivery_terms text,
  payment_terms_summary text,
  payment_terms_data jsonb, -- raw-SQL only (not in Prisma model)
  notes text,
  validity_days integer,
  buyer_po_no text,
  delivery_date timestamp(3),
  consignee_details text,
  notify_party_details text,
  buyer_if_not_consignee text,
  country_of_destination text,
  pre_carriage_by text DEFAULT 'By Road',
  place_of_receipt text,
  port_of_loading text DEFAULT 'Chennai Port',
  port_of_discharge text,
  final_destination text,
  gross_weight double precision,
  net_weight double precision,
  discount_amount double precision DEFAULT 0,
  sent_at timestamp(3),
  accepted_at timestamp(3),
  created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT proforma_invoices_pi_number_key UNIQUE (pi_number)
);

CREATE TABLE IF NOT EXISTS pi_revisions (
  id text PRIMARY KEY,
  pi_id text NOT NULL REFERENCES proforma_invoices(id),
  revision_no integer NOT NULL,
  reason text,
  customer_remarks text,
  created_by_id text NOT NULL, -- users.id (no hard FK)
  sent_at timestamp(3),
  created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS pi_rejection_logs (
  id text PRIMARY KEY,
  pi_id text NOT NULL REFERENCES proforma_invoices(id),
  reason text,
  rejected_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sales_payment_terms (
  id text PRIMARY KEY,
  order_id text NOT NULL REFERENCES sales_orders(id),
  advance_pct double precision NOT NULL DEFAULT 0,
  cad_pct double precision NOT NULL DEFAULT 0,
  inspection_pct double precision NOT NULL DEFAULT 0,
  inspection_days integer,
  receive_to_pay_pct double precision NOT NULL DEFAULT 0,
  receive_to_pay_days integer,
  bl_to_pay_pct double precision NOT NULL DEFAULT 0,
  bl_to_pay_days integer,
  credit_pct double precision NOT NULL DEFAULT 0,
  credit_days integer,
  created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT sales_payment_terms_order_id_key UNIQUE (order_id)
);

CREATE TABLE IF NOT EXISTS sales_payment_divisions (
  id text PRIMARY KEY,
  order_id text NOT NULL REFERENCES sales_orders(id),
  terms_id text REFERENCES sales_payment_terms(id),
  type "PaymentDivisionType" NOT NULL,
  percentage double precision NOT NULL,
  amount double precision NOT NULL,
  deadline_days integer,
  due_date timestamp(3),
  paid_at timestamp(3),
  status "PaymentDivisionStatus" NOT NULL DEFAULT 'PENDING',
  notes text,
  created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- raw-SQL only columns (not in Prisma model; fork migrate-payment-reminders.js)
  extended_due_date timestamptz,
  overridden_at timestamptz,
  overridden_by_id text, -- users.id (no hard FK)
  override_note text,
  reminders_sent jsonb NOT NULL DEFAULT '[]'::jsonb
);

CREATE TABLE IF NOT EXISTS sales_stock_checks (
  id text PRIMARY KEY,
  order_id text NOT NULL REFERENCES sales_orders(id),
  status "StockCheckStatus" NOT NULL DEFAULT 'PENDING',
  filter_design text,
  filter_thickness text,
  filter_grade text,
  filter_sku text,
  assigned_slab_ids jsonb NOT NULL DEFAULT '[]',
  result_count integer NOT NULL DEFAULT 0,
  notes text,
  checked_by_id text, -- users.id (no hard FK)
  created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT sales_stock_checks_order_id_key UNIQUE (order_id)
);

CREATE TABLE IF NOT EXISTS sales_production_jobs (
  id text PRIMARY KEY,
  order_id text NOT NULL REFERENCES sales_orders(id),
  type "SalesProductionType" NOT NULL DEFAULT 'SLAB',
  status "SalesProductionJobStatus" NOT NULL DEFAULT 'PENDING',
  fab_project_id text,   -- fab project (string link, as in fork)
  fab_project_code text,
  assigned_to_id text,   -- users.id (no hard FK)
  notes text,
  completed_at timestamp(3),
  created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT sales_production_jobs_order_id_key UNIQUE (order_id)
);

CREATE TABLE IF NOT EXISTS sales_packing_lists (
  id text PRIMARY KEY,
  order_id text NOT NULL REFERENCES sales_orders(id),
  status "PackingListStatus" NOT NULL DEFAULT 'PENDING_SEND',
  sent_at timestamp(3),
  notes text,
  created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT sales_packing_lists_order_id_key UNIQUE (order_id)
);

CREATE TABLE IF NOT EXISTS sales_packages (
  id text PRIMARY KEY,
  order_id text NOT NULL REFERENCES sales_orders(id),
  package_code text,
  slab_ids jsonb NOT NULL DEFAULT '[]',
  total_weight double precision,
  notes text,
  created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  packing_list_id text REFERENCES sales_packing_lists(id)
);

CREATE TABLE IF NOT EXISTS sales_containers (
  id text PRIMARY KEY,
  order_id text NOT NULL REFERENCES sales_orders(id),
  container_number text,
  vessel_name text,
  etd timestamp(3),
  eta timestamp(3),
  stuffing_details jsonb,
  stuffing_sent_at timestamp(3),
  created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT sales_containers_order_id_key UNIQUE (order_id)
);

CREATE TABLE IF NOT EXISTS sales_shipment_docs (
  id text PRIMARY KEY,
  order_id text NOT NULL REFERENCES sales_orders(id),
  bl_doc_url text,
  fumigation_cert_url text,
  invoice_url text,
  bank_details_url text,
  commercial_invoice_no text,
  commercial_invoice_date timestamp(3),
  bl_no text,
  sb_no text,
  bl_date timestamp(3),
  bl_doc_sent_at timestamp(3),
  t15_mail_sent_at timestamp(3),
  container_no text,
  vessel_name text,
  port_of_loading text,
  port_of_discharge text,
  eta_date timestamp(3),
  etd_date timestamp(3),
  liner_otl_no text,
  e_seal_no text,
  vehicle_no text,
  tracking_link text,
  package_description text,
  gross_weight double precision,
  net_weight double precision,
  packing_items jsonb,
  stuffing_photos jsonb NOT NULL DEFAULT '[]',
  stuffing_mail_sent_at timestamp(3),
  combined_pdf_url text,
  shipping_docs_mail_sent_at timestamp(3),
  payment_due_date timestamp(3),
  created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- raw-SQL only columns (not in Prisma model; fork migrate-pending.js)
  packing_list_upload text,
  measurement_list_upload text,
  discount_amount numeric,
  insurance_pct numeric,
  ocean_freight numeric,
  packing_charges numeric,
  marks_nos text,
  item_net_weights jsonb,
  CONSTRAINT sales_shipment_docs_order_id_key UNIQUE (order_id)
);

CREATE TABLE IF NOT EXISTS sales_port_arrivals (
  id text PRIMARY KEY,
  order_id text NOT NULL REFERENCES sales_orders(id),
  arrival_date timestamp(3),
  free_days integer,
  free_days_expiry timestamp(3),
  cad_cleared boolean NOT NULL DEFAULT false,
  "deliveryStatus" "PortDeliveryStatus" NOT NULL DEFAULT 'PENDING', -- fork model has no @map here
  override_by_id text, -- users.id (no hard FK)
  override_at timestamp(3),
  override_note text,
  arrival_notif_sent_at timestamp(3),
  created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT sales_port_arrivals_order_id_key UNIQUE (order_id)
);

CREATE TABLE IF NOT EXISTS sales_admin_alerts (
  id text PRIMARY KEY,
  order_id text NOT NULL REFERENCES sales_orders(id),
  type text NOT NULL,
  message text NOT NULL,
  resolved boolean NOT NULL DEFAULT false,
  resolved_at timestamp(3),
  resolved_by_id text, -- users.id (no hard FK)
  resolution text,
  created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sales_order_logs (
  id text PRIMARY KEY,
  order_id text NOT NULL REFERENCES sales_orders(id),
  user_id text NOT NULL, -- users.id (no hard FK)
  action text NOT NULL,
  note text,
  created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sales_config (
  id text PRIMARY KEY DEFAULT 'global',
  cc_emails text[],
  company_name text NOT NULL DEFAULT 'Pacific Engineered Surface Pvt Ltd',
  company_address text,
  iec_code text,
  gst_no text,
  pan_no text,
  bank_name text,
  bank_branch text,
  account_no text,
  ifsc_code text,
  swift_code text,
  ad_code text,
  logo_url text,
  ceo_email text,
  updated_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- raw-SQL only columns (not in Prisma model; invoice-config route upserts these)
  invoice_config_quartz jsonb,
  invoice_config_granite jsonb
);

CREATE TABLE IF NOT EXISTS sales_credit_notes (
  id text PRIMARY KEY,
  order_id text NOT NULL REFERENCES sales_orders(id),
  credit_number text NOT NULL, -- CN-YYYY-NNNN
  reason text NOT NULL,
  description text,
  amount double precision NOT NULL,
  currency text NOT NULL DEFAULT 'USD',
  status "CreditNoteStatus" NOT NULL DEFAULT 'PENDING_INSPECTION',
  inspected_at timestamp(3),
  issued_at timestamp(3),
  notes text,
  created_by_id text NOT NULL, -- users.id (no hard FK)
  created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT sales_credit_notes_credit_number_key UNIQUE (credit_number)
);

-- Raw-SQL-only table: no Prisma model in the fork either (accessed exclusively
-- via $queryRawUnsafe in src/lib/sales/notifications.ts and
-- /api/sales/notifications). DDL copied from fork prisma/migrate-pending.js.
CREATE TABLE IF NOT EXISTS sales_notifications (
  id          text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id     text NOT NULL, -- users.id (no hard FK)
  order_id    text,
  type        text NOT NULL,
  title       text NOT NULL,
  body        text,
  action_url  text,
  actions     jsonb NOT NULL DEFAULT '[]',
  is_read     boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sales_notifications_user ON sales_notifications (user_id, is_read, created_at DESC);
