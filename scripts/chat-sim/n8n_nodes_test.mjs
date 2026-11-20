// Runs the patched workflow's Code nodes locally with fixtures. Usage: node n8n_nodes_test.mjs <patched.json>
import fs from 'node:fs'
const w = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
const N = Object.fromEntries(w.nodes.map((n) => [n.name, n]))
let fail = 0
const ok = (cond, label, extra = '') => { if (!cond) fail++; console.log((cond ? 'PASS ' : 'FAIL ') + label + (cond ? '' : '  ' + extra)) }

function run(name, input, nodes) {
  const js = N[name].parameters.jsCode
  const $ = (n) => { if (!(n in nodes)) throw new Error(`Node '${n}' hasn't been executed`); return { first: () => ({ json: nodes[n] }), item: { json: nodes[n] } } }
  const $input = { first: () => ({ json: input }), all: () => [{ json: input }] }
  const out = new Function('$', '$input', js)($, $input)
  return out[0].json
}
const S = { phone: '9742175222', min_order: '300', opens_at: '00:00', closes_at: '23:59', hours: 'always', menu_url: 'https://friedking.vercel.app/?t=abc' }
const MENU = '## Burgers\nKing\'s Zinger Burger|159\nCola|50\n'
const ext = (text, extra = {}) => ({ customer_phone: '919035960307', customer_name: 'Maithri', text, msg_type: 'text', ...extra })
const draft = (o = {}) => ({ order_number: 'FK-1003', status: 'draft', order_type: 'delivery', items: 'Zinger x2', address: null, total: 334, ...o })
const ctx = (open, hist = [], extra = {}) => ({ settings: S, session: null, open_order: open, menu: MENU, history: hist, customer: { name: 'Maithri' }, pincodes: [], promos: [], menu_url: S.menu_url, ...extra })
const route = (text, open, hist, extra = {}, inpExtra = {}) => run('Route', ctx(open, hist, extra), { 'Extract Input': ext(text, inpExtra) })
const out = (t) => ({ direction: 'outbound', content: t })

console.log('--- Route')
let r = route('2 zinger burger', null, [])
ok(r.route === 'ai', 'ordering text goes to the AI', JSON.stringify(r.route))
r = route('Shree Devi Prasad house, kelarai kodi 1st block vamanjoor 575002', draft(), [out('📍 Please type your full delivery address - house ...')])
ok(r.route === 'setmode' && r.mode === 'delivery' && r.address.startsWith('Shree Devi'), 'typed address after the address question is captured', JSON.stringify(r))
r = route('add 1 coke', draft(), [out('📍 Please type your full delivery address - house ...')])
ok(r.route === 'ai', '"add 1 coke" while an address is expected still goes to the AI', r.route)
r = route('Shree Devi Prasad house vamanjoor', draft(), [out('Please check the details above and tap Confirm')])
ok(r.route === 'ai', 'address-like text when NOT waiting for an address is not swallowed', r.route)
r = route('btn_mode:pickup:FK-1003', draft(), [])
ok(r.route === 'setmode' && r.mode === 'pickup' && r.order_number === 'FK-1003', 'Takeaway button', JSON.stringify(r))
r = route('btn_mode:delivery:FK-1003', draft(), [])
ok(r.route === 'setmode' && r.mode === 'delivery' && !r.address, 'Delivery button asks for address', JSON.stringify(r))
r = route('takeaway', draft(), [])
ok(r.route === 'setmode' && r.mode === 'pickup', 'typed takeaway', JSON.stringify(r))
r = route('make it delivery please', draft({ order_type: 'takeaway' }), [])
ok(r.route === 'setmode' && r.mode === 'delivery', 'typed "make it delivery please"', JSON.stringify(r))
r = route('delivery', draft({ address: 'House 5, X road 575001' }), [])
ok(r.route === 'setmode' && r.mode === 'delivery' && r.address === 'House 5, X road 575001', 'delivery again keeps the saved address', JSON.stringify(r))
r = route('change address', draft({ address: 'House 5, X road 575001' }), [])
ok(r.route === 'setmode' && r.mode === 'delivery' && !r.address, 'change address clears and asks', JSON.stringify(r))
r = route('takeaway', null, [])
ok(r.route === 'ai', 'typed takeaway with no draft goes to AI', r.route)

console.log('--- cancel after placing')
const placed = { order_number: 'FK-1001', status: 'new', order_type: 'delivery', items: 'x' }
for (const t of ['cancel', 'Cancel order', 'cancel my order please', 'i want to cancel', 'btn_cancel:FK-1001', 'cr_mind:FK-1001']) {
  r = route(t, placed, [])
  ok(r.route === 'cancel_blocked' && r.order_number === 'FK-1001', `"${t}" on a placed order is blocked`, JSON.stringify(r.route))
}
r = route('cancel', null, [], { active_order: { order_number: 'FK-1000', status: 'preparing' } })
ok(r.route === 'cancel_blocked', 'cancel while kitchen is preparing is blocked', r.route)
r = route("i don't want to cancel", placed, [])
ok(r.route !== 'cancel_blocked', 'negated cancel is not blocked', r.route)
r = route('cancel', draft(), [])
ok(r.route === 'button' && r.button === 'cancel_ask', 'cancel on an unconfirmed draft still works', JSON.stringify(r))
r = route('cancel', null, [])
ok(r.route === 'button' && r.button === 'no_order', 'cancel with no order says nothing is open', JSON.stringify(r.route))
const cb = run('Build Cancel Blocked', r = route('cancel', placed, []), {})
const cbText = cb.outgoing.text.body
ok(/cannot cancel/.test(cbText) && cbText.includes('9742175222') && cbText.includes('FK-1001') && cb.customer_phone === '919035960307', 'cancel-blocked message', cbText)

console.log('--- other routes unchanged')
r = route('btn_confirm:FK-1003', draft({ address: 'House 5, X road 575001' }), [])
ok(r.route === 'checkout' && r.checkout_action === 'confirm', 'Confirm button still checks out', r.route)
r = route('yes', draft({ address: 'House 5, X road 575001' }), [out('*Please confirm your order*\nFK-1003')])
ok(r.route === 'checkout', 'typed yes after the summary confirms', r.route)
r = route('hello', null, [])
ok(r.route === 'greeting', 'greeting', r.route)
r = route('', null, [], {}, { msg_type: 'sticker' })
ok(r.route === 'ignore', 'empty sticker is ignored (loop guard)', r.route)

console.log('--- Order Decision')
const od = (items, order_type, open, active) => run('Order Decision', { intent: 'order', reply: 'ok', items, order_type }, { Route: { open_order: open, active_order: active, menu: MENU, settings: S, menu_url: S.menu_url, customer_name: 'Maithri', customer_phone: '919035960307' } })
let d = od([{ name: "King's Zinger Burger", quantity: 2 }], '', null, null)
ok(d.decision === 'new' && d.mode_known === false && d.order_type === 'auto', 'no mode said -> new draft, type auto, mode unknown', JSON.stringify([d.decision, d.mode_known, d.order_type]))
d = od([{ name: "King's Zinger Burger", quantity: 2 }], 'delivery', null, null)
ok(d.decision === 'new' && d.mode_known === true && d.order_type === 'delivery', 'delivery said', JSON.stringify([d.decision, d.mode_known, d.order_type]))
d = od([{ name: "King's Zinger Burger", quantity: 2 }], 'takeaway', null, null)
ok(d.mode_known === true && d.order_type === 'pickup', 'takeaway said', JSON.stringify([d.mode_known, d.order_type]))
d = od([{ name: "King's Zinger Burger", quantity: 3 }], '', draft({ order_type: 'delivery' }), null)
ok(d.decision === 'amend' && d.order_type === 'delivery' && d.mode_known === false, 'amend keeps the draft type', JSON.stringify([d.decision, d.order_type]))
d = od([{ name: 'Nonexistent Thing', quantity: 1 }], '', null, null)
ok(d.decision === 'unknown', 'unknown dish', d.decision)

console.log('--- Build Confirm Prompt')
const ai1 = { decision: 'new', mode_known: false, order_type: 'pickup', items: [{ name: "King's Zinger Burger", quantity: 2, price: 159 }], total: 318, note: '', settings: S }
const bcp = (src, aiN, hist = [], routeExtra = {}) => run('Build Confirm Prompt', src, { 'Extract Input': ext('x'), Route: { ...ctx(null, hist), ...routeExtra }, 'Order Decision': aiN, 'Insert Draft Order': {}, 'Amend Order': {} })
const body = (m) => (m.outgoing.type === 'interactive' ? m.outgoing.interactive.body.text : m.outgoing.text.body)
const btns = (m) => (m.outgoing.interactive?.action?.buttons || []).map((b) => b.reply.id + '=' + b.reply.title)
let m = bcp({ order_number: 1003, order_type: 'pickup', total_paise: 33400, delivery_address: null }, ai1)
ok(/How would you like to get your order\?/.test(body(m)) && /Rs 334/.test(body(m)) && btns(m).join('|').includes('btn_mode:delivery:FK-1003=Delivery') && btns(m).join('|').includes('btn_mode:pickup:FK-1003=Takeaway'), 'new cart asks Delivery / Takeaway (with GST total)', body(m) + JSON.stringify(btns(m)))
m = bcp({ order_number: 1003, order_type: 'delivery', total_paise: 33400, delivery_address: null }, { ...ai1, mode_known: true, order_type: 'delivery' })
ok(/full delivery address/.test(body(m)) && /Zinger/.test(body(m)) && btns(m).join().includes('Takeaway instead'), 'delivery said up front asks the address', body(m))
const fk = (over) => ({ result: 'ok', mode: 'delivery', order: { order_number: 'FK-1003', order_type: 'delivery', items_json: [{ name: "King's Zinger Burger", quantity: 2, price: 159 }], total: 334, address: 'Shree Devi Prasad house, kelarai kodi 1st block vamanjoor 575002', pincode: '575002', customer_name: 'Maithri', customer_phone: '919035960307', ...over } })
m = bcp(fk(), {})
ok(/confirm your order/.test(body(m)) && /Delivery to:/.test(body(m)) && /Shree Devi Prasad/.test(body(m)) && /9035960307/.test(body(m)) && /Maithri/.test(body(m)) && /Rs 334/.test(body(m)) && btns(m).join().includes('btn_confirm:FK-1003=Confirm'), 'delivery summary after the address', body(m))
m = bcp({ ...fk({ order_type: 'takeaway', address: null, pincode: null }), mode: 'pickup' }, {})
ok(/Takeaway/.test(body(m)) && !/Delivery to/.test(body(m)) && btns(m).join().includes('Confirm'), 'takeaway summary', body(m))
m = bcp({ ...fk(), result: 'bad_address', order: { ...fk().order, address: null } }, {})
ok(/incomplete/.test(body(m)) && /full delivery address/.test(body(m)), 'bad address asks again with the marker', body(m))
m = bcp({ ...fk(), result: 'no_area', pincode: '575999', order: { ...fk().order, address: null } }, {})
ok(/do not deliver to 575999/.test(body(m)) && /full delivery address/.test(body(m)), 'no delivery area', body(m))
m = bcp({ result: 'needs_address', order: { ...fk().order, address: null } }, {})
ok(/full delivery address/.test(body(m)), 'confirm without an address asks for it', body(m))
m = bcp({ ...fk(), result: 'updated_draft' }, { decision: 'amend', mode_known: false, order_type: 'delivery' }, [out('*Your cart*\nHow would you like to get your order?\n[Delivery | Takeaway | Cancel]')], {})
ok(/How would you like to get your order\?/.test(body(m)), 'customer ignored the question and added items -> asked again', body(m))
m = bcp({ ...fk(), result: 'updated_draft' }, { decision: 'amend', mode_known: false, order_type: 'delivery' }, [out('*Please confirm your order* ...')], {})
ok(/Updated - please confirm/.test(body(m)) && /Delivery to/.test(body(m)), 'later amend shows the full summary', body(m))
m = bcp({ ...fk(), result: 'final', points_used: 50, points_value: 25, subtotal_before_points: 334, order: { ...fk().order, total: 309 } }, {})
ok(/Reward points \(50\)/.test(body(m)) && /Place order/.test(btns(m).join()) && /Rs 309/.test(body(m)), 'final summary with points', body(m))
m = bcp({ result: 'locked', order: fk().order }, {})
ok(/no longer be changed/.test(body(m)), 'locked draft', body(m))
m = bcp({ order_number: 1004, order_type: 'dine-in', total_paise: 10500 }, { decision: 'new', mode_known: false, order_type: 'dine-in', items: [{ name: 'Cola', quantity: 2, price: 50 }], total: 100, settings: S })
ok(!/How would you like/.test(body(m)) && /confirm your order/.test(body(m)), 'dine-in skips the question', body(m))

console.log('--- Placed message / AI failure / Enforce')
const pl = run('Build Order Placed Reply', { result: 'confirmed', order: { order_number: 'FK-1003', total: 334, order_type: 'delivery', address: 'House 5, X road 575001' } }, { 'Extract Input': ext('x'), Route: ctx(null) })
ok(/placed! Total ₹334/.test(pl.outgoing.text.body) && /Delivering to: House 5/.test(pl.outgoing.text.body) && !/reply with your delivery address/i.test(pl.outgoing.text.body), 'placed message shows the address, no later address request', pl.outgoing.text.body)
const pk = run('Build Order Placed Reply', { result: 'confirmed', order: { order_number: 'FK-1004', total: 334, order_type: 'takeaway' } }, { 'Extract Input': ext('x'), Route: ctx(null) })
ok(/Takeaway/.test(pk.outgoing.text.body) && !/address/i.test(pk.outgoing.text.body), 'takeaway placed message', pk.outgoing.text.body)
let pa = run('Parse AI Response', { output: '' }, { 'Build Prompt': { customer_phone: '1', customer_name: 'M' } })
ok(pa.ai_failed === true && /Sorry/.test(pa.reply), 'empty AI output -> ai_failed', JSON.stringify(pa))
pa = run('Parse AI Response', { output: 'not json at all' }, { 'Build Prompt': { customer_phone: '1', customer_name: 'M' } })
ok(pa.ai_failed === true, 'garbage AI output -> ai_failed')
pa = run('Parse AI Response', { output: '{"intent":"order","reply":"ok","items":[{"name":"Cola","quantity":1}],"order_type":""}' }, { 'Build Prompt': { customer_phone: '1', customer_name: 'M' } })
ok(pa.ai_failed === false && pa.order_type === '', 'good AI output untouched')
const bre = run('Build Reply', { decision: 'reply', ai_failed: true, reply: 'x', settings: S, open_order: null, menu_url: S.menu_url, customer_phone: '919035960307' }, { 'Order Decision': { decision: 'reply', ai_failed: true, reply: 'x', settings: S, open_order: null, menu_url: S.menu_url, customer_phone: '919035960307' } })
ok(/Sorry, I could not understand/.test(bre.outgoing.interactive.body.text) && bre.outgoing.interactive.type === 'cta_url', 'Build Reply sorry + Browse Menu', JSON.stringify(bre).slice(0, 200))
const body2 = N['Enforce Order Type'].parameters.jsonBody
ok(!/Address to be confirmed/.test(body2), 'placeholder address removed')
ok(N['Insert Draft Order'].parameters.url.endsWith('/rpc/customer_draft_auto'), 'new drafts use customer_draft_auto')
ok(N['Enforce Order Type'].alwaysOutputData === true, 'Enforce Order Type always passes the order on (empty update returns no rows)')
{
  const dr = { order: { order_number: 'FK-1005', order_type: 'takeaway', items_json: [{ name: "King's Zinger Burger", quantity: 3, price: 159 }], total: 501, customer_name: 'Maithri', customer_phone: '919035960307' }, result: 'created' }
  const ai3 = { decision: 'new', mode_known: false, order_type: 'auto', items: [{ name: "King's Zinger Burger", quantity: 3, price: 159 }], total: 477, settings: S }
  const mm = run('Build Confirm Prompt', {}, { 'Extract Input': ext('x'), Route: ctx(null), 'Order Decision': ai3, 'Insert Draft Order': dr })
  ok(/How would you like to get your order\?/.test(body(mm)) && /Rs 501/.test(body(mm)), 'EMPTY Enforce output (real failure case) still produces the Delivery / Takeaway question', body(mm))
  dr.order.order_type = 'dine-in'
  const md = run('Build Confirm Prompt', {}, { 'Extract Input': ext('x'), Route: ctx(null), 'Order Decision': ai3, 'Insert Draft Order': dr })
  ok(/Dine-in/.test(body(md)) && !/How would you like/.test(body(md)), 'EMPTY Enforce output + seated customer -> dine-in summary', body(md))
}
m = bcp({ order_number: 1005, order_type: 'dine-in', table_number: 3, total_paise: 33400, delivery_address: null }, { decision: 'new', mode_known: false, order_type: 'auto', items: [{ name: "King's Zinger Burger", quantity: 2, price: 159 }], total: 318, settings: S })
ok(/Dine-in/.test(body(m)) && /Table 3/.test(body(m)) && !/How would you like/.test(body(m)) && !/full delivery address/.test(body(m)) && btns(m).join().includes('Confirm'), 'seated customer: straight to the dine-in summary', body(m))
m = bcp({ order_number: 1006, order_type: 'pickup', total_paise: 33400, delivery_address: null }, { decision: 'new', mode_known: false, order_type: 'auto', items: [{ name: "King's Zinger Burger", quantity: 2, price: 159 }], total: 318, settings: S })
ok(/How would you like to get your order\?/.test(body(m)), 'not seated: still asks delivery / takeaway', body(m))

console.log('--- structure')
const names = new Set(w.nodes.map((n) => n.name))
let badConn = 0
for (const [k, v] of Object.entries(w.connections)) { if (!names.has(k)) badConn++; for (const o of v.main || []) for (const x of o) if (!names.has(x.node)) badConn++ }
ok(badConn === 0, 'every connection points at an existing node')
const rsw = w.connections['Route Switch'].main
ok(rsw.length === N['Route Switch'].parameters.rules.values.length + 1, 'Route Switch: one output per rule + fallback', rsw.length + ' vs ' + N['Route Switch'].parameters.rules.values.length)
ok(rsw[rsw.length - 1][0].node === 'Bot Guard (AI)' && rsw[10][0].node === 'Set Delivery' && rsw[11][0].node === 'Build Cancel Blocked', 'Route Switch wiring')
const keys = N['Route Switch'].parameters.rules.values.map((v) => v.outputKey)
ok(keys[10] === 'setmode' && keys[11] === 'cancel_blocked', 'Route Switch rule order matches wiring', keys.join())
const csw = w.connections['Checkout Result'].main
ok(csw.length === N['Checkout Result'].parameters.rules.values.length + 1 && csw[3][0].node === 'Build Confirm Prompt' && csw[4][0].node === 'Build Confirm Failed', 'Checkout Result wiring', JSON.stringify(csw.map((x) => x.map((y) => y.node))))
console.log(fail ? `\n${fail} FAILED` : '\nALL PASSED')
process.exit(fail ? 1 : 0)
