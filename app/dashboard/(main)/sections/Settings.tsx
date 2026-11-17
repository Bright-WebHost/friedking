'use client'

import { useState } from 'react'
import type { DBranch } from '@/lib/dashboard/types'
import type { SettingKey } from '@/lib/dashboard/settings'
import { ROLE_LABEL, type StaffRole } from '@/lib/dashboard/access'
import { Img, Loading, Modal, Switch, todayIST, useDash, useLoad } from '../kit'

interface Banner { id: string; title: string; description: string | null; image_url: string | null; is_active: boolean; starts_at: string | null; ends_at: string | null }
interface StaffRow { user_id: string; name: string | null; email: string | null; role: StaffRole; branch_id: string | null; is_active: boolean }
interface SettingsData {
  branch: DBranch; settings: Record<SettingKey, string>; me: string
  pincodes: Array<{ pincode: string; area: string | null }>
  staff: StaffRow[]
  categories: Array<{ id: string; name: string; image_url: string | null }>
  promotions: Banner[]
}

export default function Settings() {
  const { api, toast, reloadMeta } = useDash()
  const { data, error, reload } = useLoad(() => api.get<SettingsData>('settings'), [api])
  const [s, setS] = useState<Record<string, string> | null>(null)
  const [b, setB] = useState<Record<string, string> | null>(null)
  const [saving, setSaving] = useState(false)
  const [pin, setPin] = useState({ pincode: '', area: '' })
  const [newStaff, setNewStaff] = useState({ name: '', email: '', password: '', role: 'staff' })
  const [modal, setModal] = useState<React.ReactNode>(null)
  if (!data) return <Loading error={error} onRetry={reload} />

  const st = s ?? data.settings
  const br = b ?? { name: data.branch.name, address: data.branch.address ?? '', phone: data.branch.phone ?? '', opensAt: (data.branch.opens_at ?? '').slice(0, 5), closesAt: (data.branch.closes_at ?? '').slice(0, 5) }
  const setSet = (k: SettingKey) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setS({ ...st, [k]: e.target.value })
  const setBr = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => setB({ ...br, [k]: e.target.value })
  const types = st.order_types.toLowerCase()
  const setType = (label: string, on: boolean) => {
    const all = ['Delivery', 'Pickup', 'Dine-in'].filter((t) => (t === label ? on : types.includes(t.toLowerCase())))
    setS({ ...st, order_types: all.join(', ') })
  }
  const close = () => setModal(null)
  const dirty = s !== null || b !== null
  const fail = (e: unknown) => toast(e instanceof Error ? e.message : 'Could not save')

  const save = async () => {
    setSaving(true)
    try { await api.post('settings', 'save', { ...br, settings: st }); toast('Settings saved'); setS(null); setB(null); void reload(); void reloadMeta() } catch (e) { fail(e) } finally { setSaving(false) }
  }
  const upload = async (action: string, file: File | undefined, extra: Record<string, string> = {}) => {
    if (!file) return
    try { const f = new FormData(); f.set('image', file); for (const [k, v] of Object.entries(extra)) f.set(k, v); await api.form(action === 'logo' ? 'settings' : 'settings', action, f); toast('Image saved'); void reload(); void reloadMeta() } catch (e) { fail(e) }
  }

  const field = (label: string, el: React.ReactNode) => <><label className="lbl">{label}</label>{el}</>
  return (
    <section>
      <div className="panel"><h3>Restaurant profile</h3>
        <div className="mimgpick"><Img src={st.logo_url || null} /><input type="file" accept="image/*" onChange={(e) => void upload('logo', e.target.files?.[0])} /></div>
        {field('Branch name', <input className="f" value={br.name} onChange={setBr('name')} />)}
        {field('Tagline', <input className="f" value={st.tagline} onChange={setSet('tagline')} />)}
        {field('Address', <input className="f" value={br.address} onChange={setBr('address')} />)}
        {field('Phone', <input className="f" value={br.phone} onChange={setBr('phone')} />)}
        {field('WhatsApp number (table QR codes and invoices)', <input className="f" inputMode="numeric" value={st.whatsapp_number} onChange={setSet('whatsapp_number')} placeholder="e.g. 7337687522" />)}
      </div>

      <details className="panel fold"><summary><h3>Category images</h3><span className="foldhint">{data.categories.length} categories · tap to open</span></summary><p className="asub" style={{ marginTop: -6 }}>Shown as the round category icons on the ordering page. Leave blank to keep the default.</p>
        {data.categories.map((c) => <div className="catimg-row" key={c.id}><Img src={c.image_url} /><div className="grow">{c.name}</div>
          <input type="file" accept="image/*" style={{ maxWidth: 190, fontSize: 11 }} onChange={(e) => void upload('categoryImage', e.target.files?.[0], { categoryId: c.id })} /></div>)}
      </details>

      <div className="panel"><h3>Banners (customer app carousel)</h3><p className="asub" style={{ marginTop: -6 }}>Every active banner rotates on the ordering page. Add as many as you like.</p>
        {data.promotions.length ? data.promotions.map((p) => {
          const today = todayIST(), live = p.is_active && (!p.starts_at || p.starts_at <= today) && (!p.ends_at || p.ends_at >= today)
          return <div className="bannerrow" key={p.id}><Img src={p.image_url} /><div className="grow">{p.title}<span>{live ? '🟢 Live now' : p.is_active ? '⏳ Scheduled / expired' : '⏸ Inactive'}{p.starts_at ? ` · from ${p.starts_at}` : ''}{p.ends_at ? ` to ${p.ends_at}` : ''}</span></div>
            <button className="btn sm ghost" onClick={() => setModal(<BannerModal b={p} onClose={close} onSaved={() => { close(); void reload() }} />)}>Edit</button>
            <button className="btn sm ghost danger" onClick={() => setModal(<Modal onClose={close}><h3>Delete this banner?</h3><p>{p.title}</p><div className="mrow"><button onClick={close}>Cancel</button><button className="x" onClick={async () => { close(); try { await api.post('settings', 'deleteBanner', { id: p.id }); toast('Banner deleted'); void reload() } catch (e) { fail(e) } }}>Delete</button></div></Modal>)}>Delete</button></div>
        }) : <div className="none">No banners yet</div>}
        <button className="btn sm ghost" style={{ marginTop: 6 }} onClick={() => setModal(<BannerModal b={null} onClose={close} onSaved={() => { close(); void reload() }} />)}>+ Add banner</button>
      </div>

      <div className="panel"><h3>Tax (GST)</h3>
        <div style={{ display: 'flex', gap: 12 }}>
          <div style={{ flex: 1 }}>{field('GST %', <input className="f" inputMode="decimal" value={st.gst_percent} onChange={setSet('gst_percent')} />)}</div>
          <div style={{ flex: 2 }}>{field('GSTIN (registration number)', <input className="f" value={st.gstin} onChange={setSet('gstin')} placeholder="29ABCDE1234F1Z5" />)}</div>
        </div>
        <div style={{ fontSize: 12, color: 'var(--muted)' }}>Shown as the CGST/SGST split on printed bills. GST is added to the menu subtotal.</div>
      </div>

      <div className="panel"><h3>Hours</h3>
        <div style={{ display: 'flex', gap: 12 }}>
          <div style={{ flex: 1 }}>{field('Opens', <input className="f" type="time" value={br.opensAt} onChange={setBr('opensAt')} />)}</div>
          <div style={{ flex: 1 }}>{field('Closes', <input className="f" type="time" value={br.closesAt} onChange={setBr('closesAt')} />)}</div>
        </div>
        {field('Hours shown to customers & the AI', <input className="f" value={st.hours} onChange={setSet('hours')} placeholder="e.g. 12 noon to 10 pm, all days" />)}
      </div>

      <div className="panel"><h3>Order types accepted</h3>
        {['Delivery', 'Pickup', 'Dine-in'].map((t) => <label className="avrow" key={t}><input type="checkbox" className="cbox" checked={types.includes(t.toLowerCase())} onChange={(e) => setType(t, e.target.checked)} /> {t === 'Pickup' ? 'Takeaway' : t}</label>)}
      </div>

      <div className="panel"><h3>Order &amp; delivery</h3>
        <div style={{ display: 'flex', gap: 12 }}>
          <div style={{ flex: 1 }}>{field('Minimum delivery order (₹)', <input className="f" inputMode="numeric" value={st.min_order} onChange={setSet('min_order')} />)}</div>
          <div style={{ flex: 1 }}>{field('Delivery fee (₹)', <input className="f" inputMode="numeric" value={st.delivery_fee} onChange={setSet('delivery_fee')} />)}</div>
        </div>
        <label className="avrow" style={{ marginTop: 4 }}>
          <input type="checkbox" className="cbox" checked={st.free_delivery_enabled === 'true'} onChange={(e) => setS({ ...st, free_delivery_enabled: e.target.checked ? 'true' : 'false' })} />
          <span><b>Free delivery offer</b> (customers see a progress bar and a celebration when they unlock it)</span>
        </label>
        {st.free_delivery_enabled === 'true' && (
          <div style={{ marginTop: 8 }}>
            {field('Delivery is free when the food subtotal before GST is at least (₹)', <input className="f" inputMode="numeric" value={st.free_delivery_above} onChange={setSet('free_delivery_above')} />)}
            {(!Number(st.delivery_fee) || !Number(st.free_delivery_above)) && <div style={{ fontSize: 12, color: 'var(--red)' }}>The offer only works when both the delivery fee and this amount are above 0.</div>}
          </div>
        )}
        {field('Delivery note shown to customers', <input className="f" value={st.delivery_note} onChange={setSet('delivery_note')} />)}
        <div style={{ fontSize: 12, color: 'var(--muted)' }}>Saved per branch. The website uses the fee, the free-delivery offer, the minimum order, the pincodes below and the order types above.</div>
      </div>

      <div className="panel"><h3>Delivery pincodes</h3>
        <div className="pickbar">
          <input className="f grow" style={{ margin: 0 }} placeholder="Pincode" inputMode="numeric" maxLength={6} value={pin.pincode} onChange={(e) => setPin({ ...pin, pincode: e.target.value.replace(/\D/g, '') })} />
          <input className="f grow" style={{ margin: 0 }} placeholder="Area (optional)" value={pin.area} onChange={(e) => setPin({ ...pin, area: e.target.value })} />
          <button className="btn sm" onClick={async () => { try { await api.post('settings', 'addPincode', pin); toast(`${pin.pincode} added`); setPin({ pincode: '', area: '' }); void reload() } catch (e) { fail(e) } }}>Add</button>
        </div>
        {data.pincodes.length ? data.pincodes.map((p) => <div className="histrow" key={p.pincode}><span>{p.pincode}{p.area ? ` · ${p.area}` : ''}</span>
          <button className="btn sm ghost danger" onClick={async () => { try { await api.post('settings', 'removePincode', { pincode: p.pincode }); toast('Pincode removed'); void reload() } catch (e) { fail(e) } }}>Remove</button></div>)
          : <div className="none">No delivery pincodes added</div>}
      </div>

      <div className="panel"><h3>Promotion messages</h3>
        {field('Monthly WhatsApp blast limit', <input className="f" type="number" min="0" max="1000000" inputMode="numeric" value={st.blast_monthly_limit} onChange={setSet('blast_monthly_limit')} />)}
        <div style={{ fontSize: 12, color: 'var(--muted)' }}>Owner-only setting. Failed messages do not count; the limit resets on the first day of each month. Changes are audit logged.</div>
      </div>

      <div className="panel"><h3>Payment methods</h3><input className="f" value={st.payment_methods} onChange={setSet('payment_methods')} placeholder="e.g. Cash or UPI on delivery" /></div>

      <div className="panel"><h3>Printing &amp; security</h3>
        <label className="avrow"><input type="checkbox" className="cbox" checked={st.auto_print === 'true'} onChange={(e) => setS({ ...st, auto_print: e.target.checked ? 'true' : 'false' })} /> Auto-print on accept (80 mm receipt)</label>
        {field('Undo passcode (managers enter it to move an order backwards or restore a cancelled one)', <input className="f" inputMode="numeric" maxLength={6} style={{ maxWidth: 160 }} value={st.undo_passcode} onChange={setSet('undo_passcode')} />)}
        {field('Staff discount passcode', <input className="f" type="password" inputMode="numeric" maxLength={6} style={{ maxWidth: 160 }} value={st.discount_passcode} onChange={setSet('discount_passcode')} />)}
        <div style={{ fontSize: 12, color: 'var(--muted)' }}>Required before applying a staff discount. Default: 0000.</div>
      </div>

      <div className="panel"><h3>AI &amp; WhatsApp</h3>
        {field("If the AI doesn't know something, it should…", <textarea className="f" rows={2} value={st.unknown_policy} onChange={setSet('unknown_policy')} />)}
        {field('Google review link', <input className="f" value={st.google_review_url} onChange={setSet('google_review_url')} />)}
      </div>

      <div className="panel"><h3>Stock alerts</h3>
        {field('Default low-stock threshold', <input className="f" inputMode="numeric" value={st.low_stock_threshold} onChange={setSet('low_stock_threshold')} />)}
        <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: -4 }}>Used for any tracked item without its own alert level.</div>
        {field('Warn when an ingredient expires within (days)', <input className="f" inputMode="numeric" value={st.expiry_warn_days} onChange={setSet('expiry_warn_days')} />)}
        {field('Margin alert threshold (%)', <input className="f" inputMode="numeric" value={st.margin_alert_pct} onChange={setSet('margin_alert_pct')} />)}
        <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: -4 }}>Flags any recipe-costed dish whose margin falls below this.</div>
      </div>

      <div className="panel"><h3>Staff &amp; roles</h3>
        <div className="pickbar">
          <input className="f grow" style={{ margin: 0 }} placeholder="Name" value={newStaff.name} onChange={(e) => setNewStaff({ ...newStaff, name: e.target.value })} />
          <input className="f grow" style={{ margin: 0 }} placeholder="Login email" type="email" value={newStaff.email} onChange={(e) => setNewStaff({ ...newStaff, email: e.target.value })} />
          <input className="f grow" style={{ margin: 0 }} placeholder="Temporary password (8+)" type="text" value={newStaff.password} onChange={(e) => setNewStaff({ ...newStaff, password: e.target.value })} />
          <select className="f" style={{ margin: 0, maxWidth: 140 }} value={newStaff.role} onChange={(e) => setNewStaff({ ...newStaff, role: e.target.value })}>
            <option value="staff">Staff</option><option value="manager">Manager</option><option value="owner">Owner</option>
          </select>
          <button className="btn sm" onClick={async () => { try { await api.post('settings', 'addStaff', newStaff); toast(`${newStaff.name} added. Share the email and temporary password with them.`); setNewStaff({ name: '', email: '', password: '', role: 'staff' }); void reload() } catch (e) { fail(e) } }}>Add</button>
        </div>
        <div style={{ fontSize: 12, color: 'var(--muted)', margin: '-4px 0 10px' }}>This creates their login. Staff see POS, Orders and Tables; managers also see money, stock and reports; owners see everything and every branch.</div>
        <div className="tblwrap"><table><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>On duty</th><th /></tr></thead><tbody>
          {data.staff.map((m) => <tr key={m.user_id}><td><b>{m.name || '—'}</b>{m.user_id === data.me ? ' (you)' : ''}</td><td>{m.email || '—'}</td>
            <td>{m.user_id === data.me ? ROLE_LABEL[m.role] : <select className="f2" style={{ margin: 0, padding: '6px 8px' }} value={m.role} onChange={async (e) => { try { await api.post('settings', 'staffRole', { userId: m.user_id, role: e.target.value }); toast('Role updated'); void reload() } catch (x) { fail(x) } }}>
              <option value="staff">Staff</option><option value="manager">Manager</option><option value="owner">Owner</option></select>}</td>
            <td><Switch on={m.is_active} label="On duty" onClick={async () => { try { await api.post('settings', 'staffActive', { userId: m.user_id, active: !m.is_active }); void reload() } catch (x) { fail(x) } }} /></td>
            <td>{m.user_id !== data.me && <button className="btn sm ghost danger" onClick={() => setModal(<Modal onClose={close}><h3>Remove {m.name || m.email}?</h3><p>They lose access to the dashboard straight away.</p><div className="mrow"><button onClick={close}>Cancel</button><button className="x" onClick={async () => { close(); try { await api.post('settings', 'removeStaff', { userId: m.user_id }); toast('Staff member removed'); void reload() } catch (x) { fail(x) } }}>Remove</button></div></Modal>)}>Remove</button>}</td>
          </tr>)}
        </tbody></table></div>
      </div>
      {dirty && (
        <div className="savebar" role="status">
          <span>● You have unsaved changes</span>
          <button className="btn sm ghost" disabled={saving} onClick={() => { setS(null); setB(null) }}>Discard</button>
          <button className="btn sm" disabled={saving} onClick={() => void save()}>{saving ? 'Saving…' : 'Save changes'}</button>
        </div>
      )}
      {modal}
    </section>
  )
}

function BannerModal({ b, onClose, onSaved }: { b: Banner | null; onClose: () => void; onSaved: () => void }) {
  const { api, toast } = useDash()
  const [f, setF] = useState({ title: b?.title ?? '', description: b?.description ?? '', startsAt: b?.starts_at ?? '', endsAt: b?.ends_at ?? '', isActive: b?.is_active ?? true })
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState(b?.image_url ?? null)
  const [fileName, setFileName] = useState('')
  const [busy, setBusy] = useState(false)
  return <Modal onClose={onClose}><h3>{b ? 'Edit banner' : 'Add banner'}</h3>
    <div className="mimgpick">
      <Img src={preview} />
      <div style={{ minWidth: 0 }}>
        <label className="btn sm ghost" style={{ display: 'inline-block', cursor: 'pointer' }}>
          Choose banner image
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            hidden
            onChange={(e) => {
              const x = e.target.files?.[0]
              if (!x) return
              setFile(x)
              setFileName(x.name)
              setPreview(URL.createObjectURL(x))
            }}
          />
        </label>
        <div style={{ marginTop: 4, fontSize: 11, color: 'var(--muted)' }}>
          {fileName || (preview ? 'Current image' : 'PNG, JPG, or WebP · max 5 MB')}
        </div>
      </div>
    </div>
    <label className="lbl">Title</label><input className="f2" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="e.g. Spicy deals await!" />
    <label className="lbl">Description</label><input className="f2" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="e.g. 5 pcs combo at ₹249" />
    <div style={{ display: 'flex', gap: 10 }}>
      <div style={{ flex: 1 }}><label className="lbl">Start date (optional)</label><input className="f2" type="date" value={f.startsAt} onChange={(e) => setF({ ...f, startsAt: e.target.value })} /></div>
      <div style={{ flex: 1 }}><label className="lbl">End date (optional)</label><input className="f2" type="date" value={f.endsAt} onChange={(e) => setF({ ...f, endsAt: e.target.value })} /></div>
    </div>
    <label className="avrow"><input type="checkbox" className="cbox" checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} /> Active</label>
    <div className="mrow"><button onClick={onClose}>Cancel</button><button className="go" disabled={busy} onClick={async () => {
      if (!f.title.trim()) { toast('A title is required'); return }
      setBusy(true)
      const fd = new FormData()
      if (b) fd.set('id', b.id)
      fd.set('title', f.title); fd.set('description', f.description); fd.set('startsAt', f.startsAt); fd.set('endsAt', f.endsAt); fd.set('isActive', String(f.isActive))
      if (file) fd.set('image', file)
      try { await api.form('settings', 'banner', fd); toast('Banner saved'); onSaved() } catch (e) { toast(e instanceof Error ? e.message : 'Could not save'); setBusy(false) }
    }}>Save</button></div>
  </Modal>
}
