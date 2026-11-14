'use client'

import { useCallback, useEffect, useState } from 'react'

type Settings = { id: string; name: string; slug: string; address: string | null; phone: string | null; opens_at: string | null; closes_at: string | null }
type Promotion = { id: string; title: string; description: string | null; image_url: string | null; is_active: boolean; starts_at: string | null; ends_at: string | null }

export default function DashboardSettings({ branchSlug }: { branchSlug: string | null }) {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [role, setRole] = useState('')
  const [message, setMessage] = useState('')
  const [saving, setSaving] = useState(false)
  const [promotions, setPromotions] = useState<Promotion[]>([])
  const load = useCallback(async () => {
    const response = await fetch(`/api/dashboard/settings${branchSlug ? `?branch=${encodeURIComponent(branchSlug)}` : ''}`, { cache: 'no-store' })
    const data = await response.json()
    if (!response.ok) throw new Error(data.message ?? 'Could not load settings')
    setSettings(data.branch); setRole(data.role)
  }, [branchSlug])
  const loadPromotions = useCallback(async () => {
    if (!branchSlug) return
    const response = await fetch(`/api/dashboard/promotions?branch=${encodeURIComponent(branchSlug)}`, { cache: 'no-store' })
    const data = await response.json()
    if (!response.ok) throw new Error(data.message ?? 'Could not load offer banners')
    setPromotions(data.promotions ?? [])
  }, [branchSlug])
  useEffect(() => {
    load().catch((error) => setMessage(error instanceof Error ? error.message : 'Could not load settings'))
    loadPromotions().catch((error) => setMessage(error instanceof Error ? error.message : 'Could not load offer banners'))
  }, [load, loadPromotions])
  const save = async (form: HTMLFormElement) => {
    const values = new FormData(form); setSaving(true); setMessage('')
    try {
      const response = await fetch('/api/dashboard/settings', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ branch: branchSlug, name: values.get('name'), address: values.get('address'), phone: values.get('phone'), opensAt: values.get('opensAt') || null, closesAt: values.get('closesAt') || null }) })
      const data = await response.json()
      if (!response.ok) throw new Error(data.message ?? 'Could not save settings')
      setSettings(data.branch); setMessage('Branch settings saved.')
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not save settings') } finally { setSaving(false) }
  }
  return (
    <section>
      <div className="mb-5">
        <h1 className="font-display text-3xl font-extrabold uppercase">Settings</h1>
        <p className="text-sm text-fk-muted">Manage the branch profile, opening hours, and customer offers.</p>
      </div>
      {message && <p className="mb-4 rounded-xl bg-fk-tint px-3 py-2 text-sm font-medium">{message}</p>}
      {settings && (
        <form onSubmit={(event) => { event.preventDefault(); void save(event.currentTarget) }} className="max-w-2xl space-y-4 rounded-2xl border border-fk-line bg-white p-5">
          <Field label="Branch name" name="name" defaultValue={settings.name} disabled={role === 'staff'} />
          <Field label="Address" name="address" defaultValue={settings.address ?? ''} disabled={role === 'staff'} />
          <Field label="Phone" name="phone" defaultValue={settings.phone ?? ''} disabled={role === 'staff'} />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Opens at" name="opensAt" type="time" defaultValue={settings.opens_at?.slice(0, 5) ?? ''} disabled={role === 'staff'} />
            <Field label="Closes at" name="closesAt" type="time" defaultValue={settings.closes_at?.slice(0, 5) ?? ''} disabled={role === 'staff'} />
          </div>
          {role !== 'staff' && <button disabled={saving} className="rounded-lg bg-fk-red px-4 py-2 text-sm font-bold text-white">{saving ? 'Saving…' : 'Save settings'}</button>}
        </form>
      )}
      <OfferBanners branchSlug={branchSlug} role={role} promotions={promotions} onChange={setPromotions} />
    </section>
  )
}

function OfferBanners({ branchSlug, role, promotions, onChange }: { branchSlug: string | null; role: string; promotions: Promotion[]; onChange: (promotions: Promotion[]) => void }) {
  const [editing, setEditing] = useState<Promotion | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const save = async (form: HTMLFormElement) => {
    if (!branchSlug) return
    const values = new FormData(form)
    values.set('branch', branchSlug)
    if (editing) values.set('id', editing.id)
    values.set('isActive', values.get('isActive') === 'on' ? 'true' : 'false')
    setSaving(true); setError('')
    try {
      const response = await fetch('/api/dashboard/promotions', { method: 'POST', body: values })
      const data = await response.json()
      if (!response.ok) throw new Error(data.message ?? 'Could not save offer banner')
      onChange([data.promotion, ...promotions.filter((promotion) => promotion.id !== data.promotion.id)])
      setEditing(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save offer banner')
    } finally {
      setSaving(false)
    }
  }

  const remove = async (id: string) => {
    if (!window.confirm('Delete this offer banner?')) return
    const response = await fetch('/api/dashboard/promotions', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) })
    const data = await response.json()
    if (!response.ok) { setError(data.message ?? 'Could not delete offer banner'); return }
    onChange(promotions.filter((promotion) => promotion.id !== id))
  }

  return (
    <section className="mt-6 max-w-2xl rounded-2xl border border-fk-line bg-white p-5">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-xl font-extrabold uppercase">Offer banners</h2>
          <p className="text-sm text-fk-muted">Active banners rotate below the customer menu hero.</p>
        </div>
        {role !== 'staff' && branchSlug && <button onClick={() => setEditing({ id: '', title: '', description: '', image_url: null, is_active: true, starts_at: null, ends_at: null })} className="rounded-lg bg-fk-red px-3 py-2 text-xs font-bold text-white">Add banner</button>}
      </div>
      {error && <p className="mb-3 rounded-lg bg-fk-tint px-3 py-2 text-xs font-medium text-fk-nonveg">{error}</p>}
      {editing && (
        <form onSubmit={(event) => { event.preventDefault(); void save(event.currentTarget) }} className="mb-4 grid gap-3 rounded-xl border border-fk-line bg-fk-bg p-3">
          <input name="title" defaultValue={editing.title} placeholder="Banner title" required className="rounded-lg border border-fk-line bg-white px-3 py-2 text-sm font-bold" />
          <textarea name="description" defaultValue={editing.description ?? ''} placeholder="Short description" rows={2} className="resize-none rounded-lg border border-fk-line bg-white px-3 py-2 text-sm" />
          <input name="image" type="file" accept="image/png,image/jpeg,image/webp" className="text-xs" />
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs font-bold">Starts <input name="startsAt" type="date" defaultValue={editing.starts_at ?? ''} className="mt-1 w-full rounded-lg border border-fk-line bg-white px-2 py-2 font-normal" /></label>
            <label className="text-xs font-bold">Ends <input name="endsAt" type="date" defaultValue={editing.ends_at ?? ''} className="mt-1 w-full rounded-lg border border-fk-line bg-white px-2 py-2 font-normal" /></label>
          </div>
          <label className="flex items-center gap-2 text-xs font-bold"><input name="isActive" type="checkbox" defaultChecked={editing.is_active} /> Show on customer menu</label>
          <div className="flex gap-2"><button disabled={saving} className="rounded-lg bg-fk-red px-3 py-2 text-xs font-bold text-white">{saving ? 'Saving…' : 'Save banner'}</button><button type="button" onClick={() => setEditing(null)} className="rounded-lg border border-fk-line px-3 py-2 text-xs font-bold">Cancel</button></div>
        </form>
      )}
      <div className="space-y-2">
        {promotions.length === 0 && <p className="text-sm text-fk-muted">No offer banners yet.</p>}
        {promotions.map((promotion) => (
          <div key={promotion.id} className="flex items-center gap-3 rounded-xl border border-fk-line p-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={promotion.image_url ?? '/brand/mark-red.png'} alt="" className="h-14 w-24 rounded-lg bg-fk-tint object-cover" />
            <div className="min-w-0 flex-1"><p className="truncate text-sm font-bold">{promotion.title}</p><p className="text-xs text-fk-muted">{promotion.is_active ? 'Active' : 'Hidden'}{promotion.starts_at ? ` · from ${promotion.starts_at}` : ''}</p></div>
            {role !== 'staff' && <><button onClick={() => setEditing(promotion)} className="rounded-lg border border-fk-line px-2.5 py-1.5 text-xs font-bold">Edit</button><button onClick={() => void remove(promotion.id)} className="rounded-lg border border-red-200 px-2.5 py-1.5 text-xs font-bold text-fk-nonveg">Delete</button></>}
          </div>
        ))}
      </div>
    </section>
  )
}

function Field({ label, name, type = 'text', defaultValue, disabled }: { label: string; name: string; type?: string; defaultValue: string; disabled: boolean }) {
  return <label className="block text-sm font-bold">{label}<input name={name} type={type} defaultValue={defaultValue} disabled={disabled} className="mt-1 w-full rounded-lg border border-fk-line px-3 py-2 font-normal outline-none focus:border-fk-red disabled:bg-fk-bg" /></label>
}
