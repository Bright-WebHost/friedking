/** Per-branch dashboard settings (branch_settings key/value). Defaults apply until a value is saved. */
export const SETTING_DEFAULTS = {
  tagline: 'Growing the crispiest bites',
  logo_url: '',
  gst_percent: '5',
  gstin: '',
  hours: '',
  order_types: 'Delivery, Pickup, Dine-in',
  min_order: '0',
  delivery_fee: '0',
  free_delivery_enabled: 'false',
  free_delivery_above: '0',
  // Daily shift closing report on WhatsApp (sent by n8n "Fried King | Shift Report", see supabase/friedking_shift_report.sql)
  shift_report_enabled: 'false',
  shift_report_time: '23:45',
  shift_report_numbers: '',
  delivery_note: '',
  payment_methods: 'Cash or UPI at the counter or on delivery.',
  auto_print: 'false',
  undo_passcode: '0000',
  discount_passcode: '0000',
  low_stock_threshold: '5',
  expiry_warn_days: '7',
  margin_alert_pct: '20',
  unknown_policy: 'Say you will check with the branch and ask a staff member to reply.',
  google_review_url: '',
  blast_header_image: '',
  blast_header_video: '',
  blast_name_params: '{}',
  blast_template: 'friedking_promo_en',
  blast_monthly_limit: '1000',
  whatsapp_number: '',
  // Help line shown in the strip above the dashboard header (10-digit mobile). Empty = no strip.
  help_phone: '',
}

export type SettingKey = keyof typeof SETTING_DEFAULTS
export const SETTING_KEYS = Object.keys(SETTING_DEFAULTS) as SettingKey[]

/** Fallback for branches that have not saved the owner-controlled limit yet. */
export const DEFAULT_MONTHLY_BLAST_LIMIT = 1000
