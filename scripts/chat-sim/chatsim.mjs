// End-to-end chat simulator: the LIVE workflow's Code nodes + the REAL SQL functions (PGlite). Usage: node chatsim.mjs <workflow.json>
import fs from 'node:fs'
import { loadReal } from './realschema.mjs'

const wf = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
const N = Object.fromEntries(wf.nodes.map((n) => [n.name, n]))
const { db, report } = await loadReal()
const bad = report.filter((r) => r.startsWith('FAIL'))
if (bad.length) { console.log(bad.join('\n')); process.exit(2) }
const BRANCH = 'a1b2c3d4-0001-0001-0001-000000000001'
const PHONE = '919035960307'

await db.exec(`insert into menu_categories(id,branch_id,name,sort_order) values ('c0000000-0000-0000-0000-000000000001','${BRANCH}','Burgers',1);
 insert into menu_items(branch_id,category_id,name,price_paise,is_active,sort_order) values
 ('${BRANCH}','c0000000-0000-0000-0000-000000000001','King''s Zinger Burger',15900,true,1),
 ('${BRANCH}','c0000000-0000-0000-0000-000000000001','French Fries – Large',14900,true,2),
 ('${BRANCH}','c0000000-0000-0000-0000-000000000001','Cola',5000,true,3);
 insert into branch_settings(branch_id,key,value) values ('${BRANCH}','min_order','300'),('${BRANCH}','phone','9742175222') on conflict do nothing;`)

let fail = 0
const ok = (c, label, extra = '') => { if (!c) fail++; console.log((c ? '  PASS ' : '  FAIL ') + label + (c ? '' : '\n       ' + String(extra).replace(/\n/g, '\n       ')))}

function runNode(name, input, nodes) {
  const js = N[name].parameters.jsCode
  const $ = (n) => { if (!(n in nodes)) throw new Error(`Node '${n}' hasn't been executed`); return { first: () => ({ json: nodes[n] }), item: { json: nodes[n] } } }
  const $input = { first: () => ({ json: input }), all: () => [{ json: input }] }
  return new Function('$', '$input', js)($, $input)[0].json
}
const rpc = async (fn, args) => {
  const keys = Object.keys(args)
  const sql = `select ${fn}(${keys.map((k, i) => `${k} => $${i + 1}${k === 'p_items' ? '::jsonb' : ''}`).join(', ')}) as r`
  const res = await db.query(sql, keys.map((k) => (k === 'p_items' ? JSON.stringify(args[k]) : args[k])))
  return res.rows[0].r
}
const ordersRow = async (num) => (await db.query(`select * from orders where order_number = $1`, [num])).rows[0]
const num = (fk) => Number(String(fk).replace(/\D/g, ''))

let step = 0
async function say(text, opts = {}) {
  step++
  const { ai = null, label = '' } = opts
  const msgType = opts.msg_type || 'text'
  await db.query(`insert into chat_messages(branch_id, phone, direction, content, message_type) values ($1, $2, 'inbound', $3, $4)`, [BRANCH, '+' + PHONE, text, msgType])
  const ext = { customer_phone: PHONE, customer_name: 'Maithri', message_id: 'm' + step, msg_type: msgType, text, ref_order: '', context_id: '', transcription_failed: false }
  const mm = text.match(/^(?:btn_[a-z]+|cr_[a-z]+|fk_pts_[a-z]+)(?::[a-z]+)?:((?:FK-)?\d+)$/i)
  if (mm) ext.ref_order = mm[1].toUpperCase().startsWith('FK-') ? mm[1].toUpperCase() : 'FK-' + mm[1]
  const ctx = await rpc('chat_context', { p_phone: PHONE, p_order: ext.ref_order || null })
  const nodes = { 'Extract Input': ext }
  const route = runNode('Route', ctx, nodes)
  nodes.Route = route
  let out = null, trace = route.route
  const prep = (builderOut) => builderOut

  if (route.route === 'ignore') return { text: '(no reply)', route: trace }
  if (route.route === 'greeting') { out = { customer_phone: PHONE, outgoing: { type: 'text', text: { body: '[greeting]' } } } }
  else if (route.route === 'cancel_blocked') out = runNode('Build Cancel Blocked', route, nodes)
  else if (route.route === 'setmode') {
    const r = await rpc('customer_set_delivery', { p_phone: route.customer_phone, p_order: route.order_number, p_mode: route.mode, p_address: route.address || null })
    out = runNode('Build Confirm Prompt', r, nodes); trace += ' -> ' + r.result
  } else if (route.route === 'checkout') {
    const r = await rpc('customer_checkout', { p_phone: route.customer_phone, p_order: route.order_number, p_action: route.checkout_action })
    trace += ' -> ' + r.result
    if (r.result === 'ask_points') out = runNode('Build Points Ask', r, nodes)
    else if (r.result === 'final' || r.result === 'needs_address') out = runNode('Build Confirm Prompt', r, nodes)
    else if (r.result === 'confirmed') out = runNode('Build Order Placed Reply', r, nodes)
    else out = runNode('Build Confirm Failed', r, nodes)
  } else if (route.route === 'button') {
    if (route.button === 'cancel_do') {
      const r = await rpc('customer_cancel', { p_phone: route.customer_phone, p_order: route.order_number, p_reason: route.cancel_reason || 'other' })
      out = runNode('Build Cancel Reply', r, nodes); trace += ' -> ' + r.result
    } else if (route.button === 'amend_confirm') {
      const r = await rpc('customer_amend_confirm', { p_phone: route.customer_phone, p_order: route.order_number }); out = runNode('Build Staged Amend Done', r, nodes); trace += ' -> ' + r.result
    } else if (route.button === 'amend_discard') {
      const r = await rpc('customer_amend_discard', { p_phone: route.customer_phone, p_order: route.order_number }); out = runNode('Build Staged Amend Discarded', r, nodes); trace += ' -> ' + r.result
    } else out = runNode('Build Button Reply', route, nodes)
  } else if (route.route === 'ai') {
    nodes['Build Prompt'] = { customer_phone: route.customer_phone, customer_name: route.customer_name }
    const parsed = runNode('Parse AI Response', { output: ai === null ? '' : (typeof ai === 'string' ? ai : JSON.stringify(ai)) }, nodes)
    const od = runNode('Order Decision', parsed, nodes)
    nodes['Order Decision'] = od
    const open = od.open_order
    trace += ' / ' + od.decision
    if (od.decision === 'new' || od.decision === 'draft') {
      const dr = await rpc('customer_draft_auto', { p_phone: od.customer_phone, p_name: od.customer_name, p_items: od.items, p_type: od.order_type })
      nodes['Insert Draft Order'] = dr
      // Enforce Order Type: the PATCH body comes from the live node's own expression
      const expr = N['Enforce Order Type'].parameters.jsonBody.replace(/^=\{\{\s*/, '').replace(/\s*\}\}$/, '')
      const $ = (n) => ({ first: () => ({ json: nodes[n] }) })
      const body = JSON.parse(new Function('$', '$json', 'return ' + expr)($, dr))
      let src = {}
      if (Object.keys(body).length) {
        const keys = Object.keys(body)
        const q = `update orders set ${keys.map((k, i) => `${k} = $${i + 1}`).join(', ')} where order_number = $${keys.length + 1} returning to_jsonb(orders) as r`
        const res = await db.query(q, [...keys.map((k) => body[k]), num(dr.order.order_number)])
        src = res.rows[0] ? res.rows[0].r : {}
      }
      out = runNode('Build Confirm Prompt', src, nodes); trace += ' -> draft ' + (dr.order?.order_number || dr.result) + ' patch=' + JSON.stringify(Object.keys(body))
    } else if (od.decision === 'amend') {
      if (open && open.status === 'draft') {
        const r = await rpc('customer_amend', { p_phone: od.customer_phone, p_order: open.order_number, p_items: od.items })
        nodes['Amend Order'] = r; trace += ' -> amend ' + r.result
        out = r.result === 'updated_draft' ? runNode('Build Confirm Prompt', r, nodes) : runNode('Build Reply', r, nodes)
      } else {
        const r = await rpc('customer_amend_stage', { p_phone: od.customer_phone, p_order: open.order_number, p_items: od.items })
        trace += ' -> stage ' + r.result
        out = runNode('Build Stage Amend Reply', Object.assign({}, od, r), nodes)
      }
    } else out = runNode('Build Reply', od, nodes)
  }
  const sent = runNode('Prepare Send', out, nodes)
  await db.query(`insert into chat_messages(branch_id, phone, direction, content, sender, message_type) values ($1, $2, 'outbound', $3, $4, 'text')`, [BRANCH, '+' + PHONE, sent.log_text, sent.sender || 'system'])
  const o = sent.outgoing
  const buttons = o.type === 'interactive' ? (o.interactive.action?.buttons || []).map((b) => b.reply.id) : []
  console.log(`  [${label || 'you'}] "${text}"  (${trace})`)
  console.log('     bot: ' + sent.log_text.replace(/\n/g, '\n          '))
  return { text: sent.log_text, buttons, route: trace }
}

const AI = (items, order_type = '', reply = 'ok', intent = 'order') => ({ intent, reply, items, order_type })
const Z = (q) => ({ name: "King's Zinger Burger", quantity: q })
const F = (q) => ({ name: 'French Fries – Large', quantity: q })
async function reset() {
  await db.exec(`delete from order_events; delete from order_items; delete from orders; delete from chat_messages; delete from chat_sessions; delete from table_sessions; delete from wa_pending_amend; delete from customers;`)
}
const lastOrder = async () => (await db.query(`select * from orders order by order_number desc limit 1`)).rows[0]

console.log('\n=== S1 takeaway: order -> Takeaway -> Confirm -> placed -> cancel blocked')
await reset()
let r = await say('I want to order 3 french fries large', { ai: AI([F(3)]) })
ok(/How would you like to get your order/.test(r.text) && r.buttons.some((b) => b.startsWith('btn_mode:delivery')) && r.buttons.some((b) => b.startsWith('btn_mode:pickup')), 'asks Delivery / Takeaway')
let o = await lastOrder(); const n1 = 'FK-' + o.order_number
r = await say(`btn_mode:pickup:${n1}`)
ok(/confirm your order/.test(r.text) && /Takeaway/.test(r.text) && /Rs 469/.test(r.text) && r.buttons.some((b) => b.startsWith('btn_confirm')), 'takeaway summary with GST total', r.text)
r = await say(`btn_confirm:${n1}`)
o = await lastOrder()
ok(/placed/.test(r.text) && o.status === 'pending' && o.order_type === 'pickup', 'order placed as pending takeaway', JSON.stringify([r.text, o.status, o.order_type]))
r = await say('i want to cancel the order')
ok(/cannot cancel/.test(r.text) && /9742175222/.test(r.text), 'cancel after placing is blocked with the phone number', r.text)

console.log('\n=== S2 delivery: order -> Delivery (the bug) -> address -> summary -> Confirm')
await reset()
r = await say('I want to order 2 king zinger', { ai: AI([Z(2)]) })
o = await lastOrder(); const n2 = 'FK-' + o.order_number
r = await say(`btn_mode:delivery:${n2}`)
o = await lastOrder()
ok(/full delivery address/.test(r.text) && !/no longer be changed/.test(r.text) && o.order_type === 'delivery', 'Delivery button asks for the address (no "can no longer be changed")', r.text)
r = await say('Shree Devi Prasad house, kelarai kodi 1st block vamanjoor Mangalore 575002')
o = await lastOrder()
ok(/Delivery to/.test(r.text) && /Shree Devi Prasad/.test(r.text) && /9035960307/.test(r.text) && /Maithri/.test(r.text) && o.delivery_pincode === '575002' && /Shree Devi/.test(o.delivery_address), 'typed address is saved and shown in the full details', r.text + ' | ' + o.delivery_address)
r = await say(`btn_confirm:${n2}`)
o = await lastOrder()
ok(/placed/.test(r.text) && /Delivering to: Shree Devi/.test(r.text) && o.status === 'pending' && /Shree Devi/.test(o.delivery_address), 'delivery order placed with the real address', r.text + ' | ' + o.status)

console.log('\n=== S3 bad / short address, then good; confirm before giving an address')
await reset()
await say('order 1 zinger', { ai: AI([Z(1)]) }); o = await lastOrder(); const n3 = 'FK-' + o.order_number
await say(`btn_mode:delivery:${n3}`)
r = await say('home')
ok(/incomplete/.test(r.text) && /full delivery address/.test(r.text), 'short address is refused and asked again', r.text)
r = await say(`btn_confirm:${n3}`)
ok(/full delivery address/.test(r.text) && (await lastOrder()).status === 'draft', 'tapping Confirm with no address asks for it, order stays a draft', r.text)
r = await say('Flat 4B, Sunrise Apartments, Pandeshwar road, near Pandeshwar church')
ok(/Delivery to/.test(r.text), 'good address accepted without a pincode', r.text)

console.log('\n=== S4 delivery said up front')
await reset()
r = await say('2 zinger burger delivery please', { ai: AI([Z(2)], 'delivery') })
ok(/full delivery address/.test(r.text) && !/How would you like/.test(r.text), 'goes straight to the address question', r.text)

console.log('\n=== S5 seated at a table -> dine-in, no question')
await reset()
await db.exec(`insert into table_sessions(branch_id, table_id, status, phone, customer_name) select '${BRANCH}', id, 'open', '+${PHONE}', 'Maithri' from restaurant_tables order by table_number limit 1`)
r = await say('I want 2 zinger burger', { ai: AI([Z(2)]) })
o = await lastOrder()
ok(o.order_type === 'dine-in' && /Dine-in/.test(r.text) && !/How would you like|delivery address/.test(r.text) && r.buttons.some((b) => b.startsWith('btn_confirm')), 'dine-in summary straight away', r.text + ' | ' + o.order_type)
r = await say(`btn_confirm:FK-${o.order_number}`)
o = await lastOrder()
ok(/placed/.test(r.text) && o.status === 'pending' && o.order_type === 'dine-in' && o.table_session_id, 'dine-in order placed on the table', JSON.stringify([r.text, o.status, o.order_type]))

console.log('\n=== S6 change things on a draft')
await reset()
await say('1 zinger', { ai: AI([Z(1)]) }); o = await lastOrder(); const n6 = 'FK-' + o.order_number
await say(`btn_mode:delivery:${n6}`)
await say('Flat 4B, Sunrise Apartments, Pandeshwar road 575002')
r = await say('add 2 fries large', { ai: AI([Z(1), F(2)]) })
ok(/Updated - please confirm/.test(r.text) && /French Fries/.test(r.text) && /Delivery to/.test(r.text) && /Sunrise/.test(r.text), 'adding items keeps the delivery address in the summary', r.text)
r = await say('takeaway')
o = await lastOrder()
ok(/Takeaway/.test(r.text) && o.order_type === 'pickup' && !o.delivery_address, 'switch to takeaway clears the address', r.text)
r = await say('delivery')
o = await lastOrder()
ok(/full delivery address/.test(r.text) && o.order_type === 'delivery', 'switch back to delivery asks the address again', r.text)

console.log('\n=== S7 cancel an unconfirmed cart')
await reset()
await say('1 zinger', { ai: AI([Z(1)]) }); o = await lastOrder(); const n7 = 'FK-' + o.order_number
r = await say(`btn_cancel:${n7}`)
ok(/why|reason/i.test(r.text), 'cancel on a draft asks the reason', r.text)
r = await say(`cr_mind:${n7}`)
o = await lastOrder()
ok(/cancelled/.test(r.text) && o.status === 'cancelled', 'draft cancelled', r.text + o.status)

console.log('\n=== S8 order again while another is placed; change a placed order (confirm / keep)')
await reset()
await say('2 zinger', { ai: AI([Z(2)]) }); o = await lastOrder(); const a = 'FK-' + o.order_number
await say(`btn_mode:pickup:${a}`); await say(`btn_confirm:${a}`)
r = await say('add 1 cola', { ai: AI([Z(2), { name: 'Cola', quantity: 1 }]) })
ok(/Confirm|Keep/i.test(r.buttons.join()) || /change/i.test(r.text), 'change to a placed order is staged, not applied', r.text + JSON.stringify(r.buttons))
o = await ordersRow(num(a))
ok(!(await db.query(`select 1 from order_items where order_id = $1 and name_snapshot = 'Cola'`, [o.id])).rows.length, 'placed order unchanged until the customer confirms')
const cf = r.buttons.find((b) => b.startsWith('btn_amend_confirm'))
if (cf) { r = await say(cf); ok(/updated|changed|Cola/i.test(r.text), 'confirming applies the change', r.text) }

console.log('\n=== S9 AI cannot answer / unknown dish / greeting / sticker')
await reset()
r = await say('asdf qwer', { ai: '' })
ok(/Sorry, I could not understand/.test(r.text), 'AI failure -> sorry, tell me again', r.text)
r = await say('2 pizzas', { ai: AI([{ name: 'Pizza', quantity: 2 }]) })
ok(/could not find/i.test(r.text), 'unknown dish handled', r.text)
r = await say('hello')
ok(r.route.startsWith('greeting'), 'greeting', r.route)
r = await say('', { msg_type: 'sticker' })
ok(r.text === '(no reply)', 'sticker ignored', r.text)
r = await say('cancel')
ok(/no longer open/.test(r.text), 'cancel with nothing to cancel', r.text)

console.log(fail ? `\n${fail} FAILED` : '\nALL PASSED')
process.exit(fail ? 1 : 0)
