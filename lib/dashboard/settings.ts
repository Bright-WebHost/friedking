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
  delivery_note: '',
  payment_methods: 'Cash or UPI at the counter or on delivery.',
  auto_print: 'false',
  undo_passcode: '0000',
  low_stock_threshold: '5',
  expiry_warn_days: '7',
  margin_alert_pct: '20',
  unknown_policy: 'Say you will check with the branch and ask a staff member to reply.',
  google_review_url: '',
  blast_header_image: '',
  blast_template: 'friedking_promo_en',
  whatsapp_number: '',
}

export type SettingKey = keyof typeof SETTING_DEFAULTS
export const SETTING_KEYS = Object.keys(SETTING_DEFAULTS) as SettingKey[]

/** Monthly blast cap per branch (same as Oceana). */
export const MONTHLY_BLAST_CAP = 1000
