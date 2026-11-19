'use client'

import { useMemo, useState } from 'react'
import { Loading, minsSince, phoneShort, rs, useTick } from '../kit'
import { useOrderActions } from './orderParts'
import { TABLE_LABEL, useFloor, type TableState } from './Tables'

type Filter = 'all' | 'free' | 'busy' | 'attention'

/** Phone-only page: every table as a card, two per row. Tap a card for the table popup (rounds, close & pay, move, merge, QR). */
export default function TablesPage() {
  const floor = useFloor()
  const act = useOrderActions(() => void floor.reload())
  const [filter, setFilter] = useState<Filter>('all')
  useTick()
  const { data } = floor

  const counts = useMemo(() => {
    const out = { all: 0, free: 0, busy: 0, attention: 0 }
    for (const t of data?.tables ?? []) {
      const st = floor.stateOf(floor.sessionOf(t))
      out.all += 1
      if (st === 'free') out.free += 1
      else out.busy += 1
      if (st === 'new' || st === 'ready' || st === 'pay') out.attention += 1
    }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data])

  if (!data && floor.error) return <Loading error={floor.error} onRetry={floor.reload} />
  if (!data) return <Loading />

  const shown = floor.sorted.filter((t) => {
    const st = floor.stateOf(floor.sessionOf(t))
    if (filter === 'free') return st === 'free'
    if (filter === 'busy') return st !== 'free'
    if (filter === 'attention') return st === 'new' || st === 'ready' || st === 'pay'
    return true
  })
  const openTabs = data.sessions.reduce((sum, s) => sum + floor.totalOf(s), 0)
  const chips: Array<[Filter, string]> = [['all', 'All'], ['attention', 'Needs action'], ['busy', 'Occupied'], ['free', 'Free']]

  return (
    <section>
      <div className="ministats tblstats">
        <div className="mstat c-blue"><span>Occupied</span><b>{data.sessions.length}/{data.tables.length}</b></div>
        <div className="mstat c-green"><span>Open tabs</span><b>{rs(openTabs)}</b></div>
      </div>
      <div className="tblbar">
        <div className="tblchips" role="group" aria-label="Filter tables">
          {chips.map(([k, label]) => (
            <button key={k} type="button" className={`chip ${filter === k ? 'on' : ''}`} aria-pressed={filter === k} onClick={() => setFilter(k)}>
              {label} <span className="chipn">{counts[k]}</span>
            </button>
          ))}
        </div>
        <button className="btn sm" onClick={floor.addTable}>+ Table</button>
      </div>
      <div className="tblgrid">
        {shown.map((t) => {
          const s = floor.sessionOf(t)
          const st: TableState = floor.stateOf(s)
          const rounds = s ? floor.roundsOf(s) : []
          return (
            <button key={t.id} type="button" className={`tblcard ${st}`} onClick={() => floor.setOpenId(t.id)}>
              <span className="tblhead"><span className="tblno">{t.table_number}</span><span className="tblstate">{TABLE_LABEL[st]}</span></span>
              <span className="tblmeta">{t.seats} seats{t.section ? ` · ${t.section}` : ''}</span>
              {s ? (
                <>
                  <b className="tblamt">{rs(floor.totalOf(s))}</b>
                  <span className="tblguest">{s.customer_name || (s.phone ? phoneShort(s.phone) : 'Guest')}</span>
                  <span className="tblmeta">{rounds.length} {rounds.length === 1 ? 'round' : 'rounds'} · {minsSince(s.opened_at)}m</span>
                </>
              ) : <span className="tblfree">Tap to start an order</span>}
            </button>
          )
        })}
      </div>
      {!shown.length && <div className="none">{data.tables.length ? 'No tables match this filter' : 'No tables yet. Tap + Table to add one.'}</div>}
      {floor.popup(act)}{floor.modal}{act.modal}
    </section>
  )
}
