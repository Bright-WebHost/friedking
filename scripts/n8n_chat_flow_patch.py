"""Builds the patched 'Fried King | Main' workflow for the chat ordering fix (mode -> address -> full summary -> confirm,
no cancel after placing, friendly AI failure). Reads a backup JSON, writes a patched copy. It never talks to n8n.

  python scripts/n8n_chat_flow_patch.py <backup.json> <patched.json>

Needs supabase/friedking_whatsapp_delivery_mode.sql AND friedking_whatsapp_table_draft.sql run first.
"""
import json, sys, uuid, copy

src, dst = sys.argv[1], sys.argv[2]
w = json.load(open(src, encoding='utf-8'))
N = {n['name']: n for n in w['nodes']}
C = w['connections']


def sub(s, old, new, label):
    assert old in s, 'patch anchor missing: ' + label
    return s.replace(old, new, 1)


def code(name):
    return N[name]['parameters']['jsCode']


def set_code(name, js):
    N[name]['parameters']['jsCode'] = js


# ---------------------------------------------------------------- Route
r = code('Route')
r = sub(r, "var isAfterPointsAsk =", """var isAfterModeAsk = lastOutbound.indexOf('How would you like to get your order') !== -1;
var isAfterAddressAsk = lastOutbound.indexOf('full delivery address') !== -1;
var isAfterPointsAsk =""", 'lastOutbound markers')
r = sub(r, "  history: ctx.history || [], customer: ctx.customer || null,", "  history: ctx.history || [], customer: ctx.customer || null, active_order: ctx.active_order || null,", 'active_order in base')
r = sub(r, "if (btn) {\n  var extra =", r"""// ---- A placed order cannot be cancelled on WhatsApp: tell the customer to call.
var placedOrder = (open && open.status !== 'draft') ? open : ((!open && ctx.active_order) ? ctx.active_order : null);
var NEG_CANCEL = /\b(don'?t|do not|dont|not|never|no)\s+(want\s+to\s+)?cancel/;
var textCancel = text.length > 0 && text.length <= 80 && /\bcancel/.test(low) && !NEG_CANCEL.test(low) && !/^(btn_|fk_|cr_keep)/.test(low);
var buttonCancel = /^btn_cancel\b/.test(low) || /^cr_(wrong|wrongx|mind|mistake|slow|other)\b/.test(low);
if (placedOrder && (textCancel || buttonCancel)) {
  return [{ json: Object.assign({}, base, { route: 'cancel_blocked', order_number: placedOrder.order_number }) }];
}
// nothing to cancel at all: do not show the cancel-reason list for an empty order number
if (!open && !ctx.active_order && (textCancel || buttonCancel)) {
  return [{ json: Object.assign({}, base, { route: 'button', button: 'no_order', order_number: '' }) }];
}

// ---- Delivery or takeaway, and the typed delivery address, for the customer's open draft.
if (open && open.status === 'draft') {
  var oType = String(open.order_type || '').toLowerCase();
  var oAddr = String(open.address || '').trim();
  var hasAddr = oAddr !== '' && oAddr.indexOf('Address to be confirmed') !== 0;
  var modeBtn = low.match(/^btn_mode:(delivery|pickup):((?:fk-)?\d+)$/);
  var modeWord = low.match(/^(?:(?:make it|change (?:it )?to|i want|i need|i'?ll take|please|pls|switch to)\s+)?(?:a |the )?(home delivery|delivery|deliver|take ?away|pick ?up|parcel)(?:\s+(?:please|pls))?[\s.!]*$/);
  var changeAddr = /^(?:change|new|edit|update|wrong)(?: my| the)?(?: delivery)? address[\s.!]*$/.test(low);
  var wantMode = '';
  var wantAddr = '';
  if (modeBtn) { wantMode = modeBtn[1]; }
  else if (modeWord && (inp.msg_type === 'text' || inp.msg_type === 'audio')) { wantMode = /deliver/.test(modeWord[1]) ? 'delivery' : 'pickup'; }
  else if (changeAddr) { wantMode = 'delivery'; }
  else if (oType === 'delivery' && !hasAddr && isAfterAddressAsk && text && (inp.msg_type === 'text' || inp.msg_type === 'audio') &&
           !/^(btn_|fk_|cr_)/.test(low) && !/^(add|remove|make|i want|i need|can i|what|how|do you|menu|hi|hii|hello|hey|thanks|thank you)\b/.test(low)) {
    wantMode = 'delivery';
    wantAddr = text;
  }
  if (wantMode) {
    // same mode again with an address already saved: just show the summary again (keep the address)
    if (wantMode === 'delivery' && !wantAddr && hasAddr && !changeAddr) { wantAddr = oAddr; }
    return [{ json: Object.assign({}, base, { route: 'setmode', order_number: open.order_number, mode: wantMode, address: wantAddr }) }];
  }
}

if (btn) {
  var extra =""", 'insert new routes before button handling')
set_code('Route', r)

# ---------------------------------------------------------------- Route Switch: two new outputs before the fallback
rs = N['Route Switch']['parameters']['rules']['values']


def rule(key):
    x = copy.deepcopy(next(v for v in rs if v.get('outputKey') == 'checkout'))
    x['conditions']['conditions'][0]['rightValue'] = key
    x['conditions']['conditions'][0]['id'] = 'c_' + key
    x['outputKey'] = key
    return x


rs.append(rule('setmode'))
rs.append(rule('cancel_blocked'))
outs = C['Route Switch']['main']
fallback = outs.pop()  # the AI path stays last
outs.append([{'node': 'Set Delivery', 'type': 'main', 'index': 0}])
outs.append([{'node': 'Build Cancel Blocked', 'type': 'main', 'index': 0}])
outs.append(fallback)

# ---------------------------------------------------------------- new nodes
chk = N['Checkout']
set_delivery = {
    'id': str(uuid.uuid4()), 'name': 'Set Delivery', 'type': 'n8n-nodes-base.httpRequest', 'typeVersion': 4.2,
    'position': [chk['position'][0] + 240, chk['position'][1] + 220], 'alwaysOutputData': True, 'onError': 'continueRegularOutput',
    'parameters': {
        'method': 'POST', 'url': 'https://alhnmwwbdydcgcgnwhqw.supabase.co/rest/v1/rpc/customer_set_delivery',
        'authentication': 'predefinedCredentialType', 'nodeCredentialType': 'supabaseApi', 'sendHeaders': True,
        'headerParameters': {'parameters': [{'name': 'Content-Type', 'value': 'application/json'}]},
        'sendBody': True, 'specifyBody': 'json',
        'jsonBody': '={{ JSON.stringify({ p_phone: $json.customer_phone, p_order: $json.order_number, p_mode: $json.mode, p_address: $json.address || null }) }}',
        'options': {'timeout': 10000}},
    'credentials': copy.deepcopy(chk.get('credentials', {})),
}
RENDER = """function render(phone, text, buttons, cta) {
  if (cta && cta.url) {
    return { customer_phone: phone, outgoing: { type: 'interactive', interactive: {
      type: 'cta_url', body: { text: String(text).slice(0, 1024) },
      action: { name: 'cta_url', parameters: {
        display_text: String(cta.label || 'Browse Menu').slice(0, 20), url: cta.url } } } } };
  }
  if (buttons && buttons.length > 0) {
    return { customer_phone: phone, outgoing: { type: 'interactive', interactive: {
      type: 'button', body: { text: String(text).slice(0, 1024) },
      action: { buttons: buttons.slice(0, 3).map(function (b, i) {
        return { type: 'reply', reply: { id: String(b.id || ('btn_' + i)).slice(0, 256),
                                         title: String(b.title || b).slice(0, 20) } };
      }) } } } };
  }
  return { customer_phone: phone, outgoing: { type: 'text', text: { body: String(text) } } };
}
function waPhone(p) {
  var d = String(p || '').replace(/\\D/g, '');
  if (d.length === 10) return '91' + d;
  if (d.length === 11 && d.startsWith('0')) return '91' + d.slice(1);
  return d;
}
"""
cancel_blocked = {
    'id': str(uuid.uuid4()), 'name': 'Build Cancel Blocked', 'type': 'n8n-nodes-base.code', 'typeVersion': 2,
    'position': [chk['position'][0] + 240, chk['position'][1] + 400],
    'parameters': {'jsCode': RENDER + """
var d = $input.first().json || {};
var S = d.settings || {};
var phoneTxt = S.phone || '+91 97421 75222';
var num = d.order_number || '';
var msg = 'Sorry, we cannot cancel an order on WhatsApp once it has been placed.' +
  (num ? ' To cancel order ' + num + ',' : ' To cancel your order,') + ' please call us on ' + phoneTxt + ' and our team will help you.';
return [{ json: render(waPhone(d.customer_phone), msg, [], null) }];
"""},
}
w['nodes'] += [set_delivery, cancel_blocked]
C['Set Delivery'] = {'main': [[{'node': 'Build Confirm Prompt', 'type': 'main', 'index': 0}]]}
C['Build Cancel Blocked'] = {'main': [[{'node': 'Prepare Send', 'type': 'main', 'index': 0}]]}

# ---------------------------------------------------------------- Build Confirm Prompt: mode -> address -> full summary
bcp = RENDER + r"""
function rs(n) { return 'Rs ' + Math.round(Number(n || 0)).toLocaleString('en-IN'); }

var src = $input.first().json || {};
var patched = Array.isArray(src) ? src[0] : null;
var order = (src && src.order) || patched || src;

if (!order || !order.order_number) {
  try { order = $('Insert Draft Order').first().json.order || order; } catch (e) {}
}
if (!order || !order.order_number) {
  try { order = $('Amend Order').first().json.order || order; } catch (e) {}
}

var inp = {};
try { inp = $('Extract Input').first().json || {}; } catch (e) {}
var d = {};
try { d = $('Route').first().json || {}; } catch (e) {}
var ai = {};
try { ai = $('Order Decision').first().json || {}; } catch (e) {}

var S = d.settings || ai.settings || {};
var phone = waPhone(inp.customer_phone || d.customer_phone || (order && order.customer_phone));
var num = String(order.order_number || d.order_number || '').toUpperCase();
if (num && !num.startsWith('FK-')) num = 'FK-' + num;

if (!num) {
  return [{ json: render(phone,
    'Sorry, I could not save that order just now. Please try again in a moment, or call ' +
    (S.phone || '+91 97421 75222') + '.', [], null) }];
}

if (src.result === 'locked' || src.result === 'error') {
  return [{ json: render(phone, 'That order can no longer be changed here. Tell me what you would like and I will set up a new one, or call ' +
    (S.phone || '+91 97421 75222') + '.', [], { label: 'Browse Menu', url: (d.menu_url || 'https://friedking.vercel.app/') + ((d.menu_url || '').indexOf('?') > -1 ? '&ph=' : '?ph=') + phone }) }];
}

var items = (Array.isArray(order.items_json) && order.items_json.length) ? order.items_json : (ai.items || []);
var total = (order.total !== undefined && order.total !== null && !isNaN(Number(order.total))) ? Math.round(Number(order.total))
          : ((order.total_paise !== undefined && order.total_paise !== null) ? Math.round(Number(order.total_paise) / 100) : Math.round(Number(ai.total || 0)));
var rawType = String(order.order_type || ai.order_type || '').toLowerCase();
var type = (rawType === 'takeaway') ? 'pickup' : rawType;
var address = String(order.delivery_address || order.address || '').trim();
if (address.indexOf('Address to be confirmed') === 0) { address = ''; }
var pincode = String(order.delivery_pincode || order.pincode || '');

var lines = items.map(function (i) {
  var lt = (Number(i.price) || 0) * (Number(i.quantity) || 1);
  return '- ' + i.name + ' x' + i.quantity + '  ' + (lt > 0 ? rs(lt) : '(price on confirmation)');
}).join('\n');

var lastOut = '';
var hist = Array.isArray(d.history) ? d.history : [];
for (var hi = hist.length - 1; hi >= 0; hi--) {
  if (hist[hi] && hist[hi].direction === 'outbound') { lastOut = String(hist[hi].content || ''); break; }
}

var isFinal = (src.result === 'final');
var updated = (src.result === 'updated_draft');

var pointsUsed = Number(src.points_used || order.loyalty_points_redeemed || 0);
var pointsVal = Number(src.points_value || (order.loyalty_discount_paise ? order.loyalty_discount_paise / 100 : 0));
var pointsLine = (pointsUsed > 0) ? ('🎁 Reward points (' + pointsUsed + '): −₹' + pointsVal + '\n') : '';
var totalLine = pointsLine + '*Total (incl. 5% GST): ' + rs(total) + '*';

// 1) Delivery or takeaway not chosen yet: a new cart, or the customer ignored the question and carried on adding items
var askMode = (type !== 'dine-in') && (
  (ai.decision === 'new' && ai.mode_known === false) ||
  (updated && ai.mode_known !== true && lastOut.indexOf('How would you like to get your order') !== -1));
if (askMode) {
  var m1 = '*Your cart* - ' + num + '\n\n' + lines + '\n\n' + totalLine +
    (ai.note ? ('\n\n' + ai.note) : '') +
    '\n\nHow would you like to get your order?';
  return [{ json: render(phone, m1, [
    { id: 'btn_mode:delivery:' + num, title: 'Delivery' },
    { id: 'btn_mode:pickup:' + num,   title: 'Takeaway' },
    { id: 'btn_cancel:' + num,        title: 'Cancel' }], null) }];
}

// 2) Delivery without an address: ask the customer to type it
if (type === 'delivery' && !address) {
  var lead = '🛵 Delivery for ' + num + ':\n' + lines + '\n' + totalLine + '\n\n';
  var ask;
  if (src.result === 'bad_address') {
    ask = 'That address looks incomplete. Please type your full delivery address - house or flat number, street, area, landmark and pincode - in one message.';
  } else if (src.result === 'no_area') {
    ask = 'Sorry, we do not deliver to ' + (src.pincode || 'that pincode') + ' yet. Please type another full delivery address, or tap Takeaway to pick it up yourself.';
  } else {
    ask = '📍 Please type your full delivery address - house or flat number, street, area, landmark and pincode - in one message.';
  }
  return [{ json: render(phone, (src.result === 'bad_address' || src.result === 'no_area') ? ask : (lead + ask), [
    { id: 'btn_mode:pickup:' + num, title: 'Takeaway instead' },
    { id: 'btn_cancel:' + num,      title: 'Cancel' }], null) }];
}

// 3) Full details, then the final confirm
var LABELS = { delivery: 'Delivery', pickup: 'Takeaway', 'dine-in': 'Dine-in' };
var where;
if (type === 'delivery') {
  where = '🛵 *Delivery to:*\n' + address + ((pincode && address.indexOf(pincode) === -1) ? (' - ' + pincode) : '');
} else if (type === 'pickup') {
  where = '🛍 *Takeaway* - you collect it from the restaurant';
} else {
  where = (type === 'dine-in') ? ('🍽️ *Dine-in*' + (order.table_number ? (' - Table ' + order.table_number) : '') + ' - we bring it to your table') : ('Type: ' + (LABELS[type] || type));
}
var who = String(order.customer_name || d.customer_name || inp.customer_name || '').trim();
var tenDigits = String(order.customer_phone || phone).replace(/\D/g, '').slice(-10);
var contact = '👤 ' + (who ? (who + ' · ') : '') + '📞 ' + tenDigits;

var min = Number(S.min_order || 200);
var foodTotal = Number(src.subtotal_before_points || total);
var minNote = (type === 'delivery' && foodTotal < min)
  ? ('\n\nDelivery starts at ' + rs(min) + ' - add ' + rs(min - foodTotal) + ' more, or tap Modify to make it takeaway.')
  : '';

var titleLine = updated ? '*Updated - please confirm your order*' : '*Please confirm your order*';
var bottomLine = isFinal ? 'Tap *Place order* to send it to the kitchen.' : 'Please check the details above and tap *Confirm* to place your order.';

var msg = titleLine + '\n' + num + '\n\n' + lines + '\n\n' + totalLine + '\n\n' + where + '\n' + contact +
  (ai.note ? ('\n\n' + ai.note) : '') + minNote + '\n\n' + bottomLine;

var buttons = isFinal ? [
  { id: 'btn_place:' + num,  title: 'Place order' },
  { id: 'btn_modify:' + num, title: 'Modify' },
  { id: 'btn_cancel:' + num, title: 'Cancel' }
] : [
  { id: 'btn_confirm:' + num, title: 'Confirm' },
  { id: 'btn_modify:' + num,  title: 'Modify' },
  { id: 'btn_cancel:' + num,  title: 'Cancel' }
];
return [{ json: render(phone, msg, buttons, null) }];
"""
set_code('Build Confirm Prompt', bcp)

# ---------------------------------------------------------------- Order Decision: remember whether the customer said how they want it
od = code('Order Decision')
od = sub(od, "var type;\nif (rawType === 'delivery'", "var modeKnown = (rawType === 'delivery' || rawType === 'pickup' || rawType === 'dine-in');\nvar type;\nif (rawType === 'delivery'", 'modeKnown')
od = sub(od, "  // Not specified by customer: check open order, otherwise default to delivery\n  type = (open && open.order_type) ? open.order_type : 'delivery';",
         "  // Not said: keep the open order's type. A new cart is saved with type 'auto': dine-in if the customer has an open table, else takeaway for now and the bot asks delivery or takeaway.\n  type = (open && open.order_type) ? open.order_type : 'auto';", 'default type')
od = sub(od, "  decision: decision, items: cart,", "  decision: decision, mode_known: modeKnown, items: cart,", 'mode_known out')
set_code('Order Decision', od)

# ---------------------------------------------------------------- Enforce Order Type: no placeholder address any more
eo = N['Enforce Order Type']['parameters']['jsonBody']
# The orders table requires an address on every delivery order (check order_type <> 'delivery' or delivery_address is not null),
# and customer_draft already stores the placeholder, so the delivery patch must not touch the address at all.
eo = sub(eo, ', delivery_address: "Address to be confirmed with the customer on WhatsApp" }', ' }', 'placeholder address')

# With type 'auto' there is nothing to update, and an empty update returns no rows: the node must still pass the order on
# (Build Confirm Prompt falls back to the saved draft). Without this the customer got NO reply to a new cart.
N['Enforce Order Type']['alwaysOutputData'] = True
N['Enforce Order Type']['onError'] = 'continueRegularOutput'

# new drafts go through customer_draft_auto (dine-in for a seated customer)
idr = N['Insert Draft Order']['parameters']
idr['url'] = idr['url'].replace('/rpc/customer_draft', '/rpc/customer_draft_auto')
assert idr['url'].endswith('customer_draft_auto')
N['Enforce Order Type']['parameters']['jsonBody'] = eo

# ---------------------------------------------------------------- Checkout Result: needs_address goes to the summary builder (which asks for the address)
cr = N['Checkout Result']['parameters']
vals = cr['rules']['values']
x = copy.deepcopy(vals[0])
x['conditions']['conditions'][0]['rightValue'] = 'needs_address'
x['conditions']['conditions'][0]['id'] = 'c_needs_address'
x['outputKey'] = 'needs_address'
vals.append(x)
cr.setdefault('options', {})['fallbackOutput'] = 'extra'
couts = C['Checkout Result']['main']
cfb = couts.pop()
couts.append([{'node': 'Build Confirm Prompt', 'type': 'main', 'index': 0}])
couts.append(cfb)

# ---------------------------------------------------------------- Placed message: show where it goes instead of asking for the address afterwards
bp = code('Build Order Placed Reply')
bp = sub(bp, """if (oType === 'delivery') {
  lines.push('📍 Please reply with your delivery address or share your location pin so our rider can reach you!');
}""", """if (oType === 'delivery') {
  var placedAddr = String(order.address || '').trim();
  if (placedAddr && placedAddr.indexOf('Address to be confirmed') !== 0) { lines.push('🛵 Delivering to: ' + placedAddr); }
} else if (oType === 'takeaway' || oType === 'pickup') {
  lines.push('🛍 Takeaway - we will let you know when it is ready.');
}""", 'placed reply address')
set_code('Build Order Placed Reply', bp)

# ---------------------------------------------------------------- AI: do not guess delivery, say sorry when lost, no AI-side cancel promises
ag = N['AI Agent']['parameters']['options']['systemMessage']
ag = sub(ag, """   - If the customer does NOT specify order_type: if there is an active table session or open order at a table, use "dine-in"; otherwise default to "delivery".""",
         """   - If the customer does NOT say how they want it, leave "order_type" EMPTY (""). Never guess it. The system asks delivery or takeaway itself, with buttons.""", 'prompt rule 8')
ag = sub(ag, "18. If the customer asks to speak to a person", """19. If you do not understand the message, or it is not about Fried King, never guess. Say sorry and ask them to tell you again in a few words (intent "other", no items).
20. Never ask for the delivery address, the delivery/takeaway choice or the final confirmation yourself - the system does that with buttons. Never say an order is placed or confirmed.
21. An order that is already placed (new, preparing or ready) cannot be cancelled on WhatsApp. If they ask, say sorry and tell them to call the restaurant PHONE number above to cancel (intent "status", no items).
18. If the customer asks to speak to a person""", 'prompt rules 19-21')
N['AI Agent']['parameters']['options']['systemMessage'] = ag

# ---------------------------------------------------------------- AI failure -> friendly sorry
pa = code('Parse AI Response')
pa = sub(pa, "if (!parsed || !parsed.reply) {\n  parsed = { intent: 'other', reply: 'Sorry, I did not catch that. Could you say it again?',\n             items: [], order_type: '' };\n}",
         "var aiFailed = false;\nif (!parsed || !parsed.reply) {\n  aiFailed = true;\n  parsed = { intent: 'other', reply: 'Sorry, I could not understand that. Could you please tell me again what you would like to order?',\n             items: [], order_type: '' };\n}", 'ai failed flag')
pa = sub(pa, "  order_type: String(parsed.order_type || '')\n} }];", "  order_type: String(parsed.order_type || ''),\n  ai_failed: aiFailed\n} }];", 'ai_failed out')
set_code('Parse AI Response', pa)

br = code('Build Reply')
br = sub(br, "var cta = null;\n", "var cta = null;\nif (d.ai_failed) {\n  text = 'Sorry, I could not understand that. Could you please tell me again what you would like to order? You can also tap Browse Menu to pick your items.';\n  cta = menuCta;\n}\n", 'build reply ai_failed')
set_code('Build Reply', br)

# ---------------------------------------------------------------- Modify hint
bb = code('Build Button Reply')
bb = sub(bb, "'Sure - tell me what to change, for example \"make it 2 biryanis\" or \"remove the naan\". '", "'Sure - tell me what to change, for example \"make it 2 biryanis\", \"remove the naan\", \"takeaway instead\" or \"change address\". '", 'modify hint')
set_code('Build Button Reply', bb)

json.dump(w, open(dst, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print('patched ->', dst, 'nodes', len(w['nodes']))
