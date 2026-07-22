// Hand-written types mirroring the Supabase schema in supabase/migrations.
// Once a live Supabase project exists, this can be replaced by output from
// `supabase gen types typescript`.

export type AccountType = 'checking' | 'savings' | 'wallet' | 'credit_card' | 'investment';
export type CategoryType = 'income' | 'expense';
export type RecurrenceInterval = 'weekly' | 'monthly' | 'yearly';
export type TransactionStatus = 'realized' | 'projected';
export type TransactionForm = 'cash' | 'installment';
export type GoalType = 'budget' | 'savings';
export type GoalPeriod = 'monthly' | 'yearly' | 'custom';
export type TenantRole = 'owner' | 'member';
export type WhatsappLinkStatus = 'pending' | 'active' | 'revoked';

export interface Tenant {
  id: string;
  name: string;
  is_active: boolean;
  created_at: string;
}

export interface TenantUser {
  id: string;
  tenant_id: string;
  user_id: string;
  role: TenantRole;
  created_at: string;
}

export interface Account {
  id: string;
  tenant_id: string;
  name: string;
  type: AccountType;
  initial_balance: number;
  is_active: boolean;
  closing_day: number | null;
  due_day: number | null;
  credit_limit: number | null;
  created_at: string;
}

export interface Category {
  id: string;
  tenant_id: string | null;
  name: string;
  type: CategoryType;
  icon: string | null;
  color: string | null;
  parent_category_id: string | null;
  created_at: string;
}

export interface Recurrence {
  id: string;
  tenant_id: string;
  account_id: string;
  category_id: string | null;
  description: string;
  amount: number;
  type: CategoryType;
  interval: RecurrenceInterval;
  reference_day: number;
  reference_month: number | null;
  start_date: string;
  end_date: string | null;
  is_active: boolean;
  created_at: string;
}

export interface Transaction {
  id: string;
  tenant_id: string;
  account_id: string;
  category_id: string | null;
  description: string;
  amount: number;
  type: CategoryType;
  date: string;
  status: TransactionStatus;
  form: TransactionForm;
  installment_group_id: string | null;
  installment_number: number | null;
  installment_total: number | null;
  linked_transaction_id: string | null;
  settled_by: string | null;
  recurrence_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface Goal {
  id: string;
  tenant_id: string;
  type: GoalType;
  category_id: string | null;
  account_id: string | null;
  target_amount: number;
  period: GoalPeriod;
  start_date: string;
  end_date: string | null;
  description: string | null;
  created_at: string;
}

export interface TenantWhatsappLink {
  id: string;
  tenant_id: string;
  phone_number: string | null;
  status: WhatsappLinkStatus;
  verification_code: string;
  code_expires_at: string;
  verified_at: string | null;
  created_at: string;
}

// Shape returned by the admin_list_tenants() RPC.
export interface AdminTenantSummary {
  tenant_id: string;
  name: string;
  is_active: boolean;
  created_at: string;
  member_count: number;
  account_count: number;
  transaction_count: number;
  whatsapp_status: WhatsappLinkStatus | null;
  whatsapp_phone_number: string | null;
}

// Shape returned by the admin_tenant_users(p_tenant_id) RPC.
export interface AdminTenantUser {
  user_id: string;
  email: string;
  role: TenantRole;
  joined_at: string;
}
