/** Prepare reviewed n8n exports; never calls or changes the live workflows.
 * Input: fresh <workflow-id>-before.json exports from the n8n API.
 * Usage: node scripts/prepare-rider-workflows.cjs <input-directory> <output-directory> <callback-credential-id>
 * Deploy the app endpoint before importing/publishing these exports. See docs/RIDER_PAYMENT.md.
 */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { configureRiderPayment } = require('./rider-payment-workflow.cjs');
const [inputDirectory, outputDirectory, callbackCredentialId] = process.argv.slice(2);
assert.ok(inputDirectory && callbackCredentialId, 'Usage: node scripts/prepare-rider-workflows.cjs <input-directory> <output-directory> <callback-credential-id>');
const dir = path.resolve(inputDirectory);
const output = path.resolve(outputDirectory || inputDirectory);
fs.mkdirSync(output, { recursive: true });
const main=JSON.parse(fs.readFileSync(path.join(dir,'bs21eCX2lGfXAeme-before.json'),'utf8'));
const events=JSON.parse(fs.readFileSync(path.join(dir,'ppgSbbKzkPUQBdgF-before.json'),'utf8'));
const node=(workflow,name)=>{const found=workflow.nodes.find(node=>node.name===name);assert.ok(found,name);return found;};
const replace=(source,old,value)=>{assert.equal(source.split(old).length,2,'Unique source: '+old.slice(0,70));return source.replace(old,value);};
let code=node(events,'Build Message').parameters.jsCode;
assert.ok(code.includes('notification.receipt !== false'), 'Start from the workflow that already suppresses receipts for later table rounds.');
code=replace(code,'var out = [];',String.raw`function phone(raw) {
  var p = wa(raw);
  return p.length === 12 && p.slice(0, 2) === '91' ? '+91 ' + p.slice(2, 7) + ' ' + p.slice(7) : '+' + p;
}
var out = [];`);
const start=code.indexOf("    m.kind = 'rider';");const end=code.indexOf("  } else if (etype === 'customer_rider_assigned')",start);assert.ok(start>0&&end>start);
code=code.slice(0,start)+String.raw`    m.kind = 'rider'; m.mode = 'template'; m.template = 'friedking_rider_msg';
    var itemList = (Array.isArray(o.items_json) ? o.items_json : []).map(function (i) { return i.quantity + ' x ' + i.name; }).join('\n');
    var addr = clean(o.address || '');
    if (o.pincode && addr.indexOf(String(o.pincode)) === -1) { addr += ' - ' + clean(o.pincode); }
    var amount = Number(e.amount || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
    var total = Number(o.total == null ? e.amount || 0 : o.total).toLocaleString('en-IN', { maximumFractionDigits: 2 });
    var customerPhone = phone(e.customer_phone || o.customer_phone);
    m.payment_payload = 'fk_paid:' + e.order_id;
    var heading = '*Fried King delivery*\n*Order:* ' + num + '\n\n*Customer:* ' + clean(e.customer_name || 'Guest') + '\n*Phone:* ' + customerPhone + '\n*Address:* ' + addr + '\n\n*Items:*\n';
    var ending = '\n\n*Order total: Rs ' + total + '*\n*Cash to collect: Rs ' + amount + '*\nTap Payment collected after collecting the cash.';
    var room = Math.max(0, 1024 - heading.length - ending.length);
    if (itemList.length > room) itemList = itemList.slice(0, Math.max(0, room - 3)) + '...';
    m.text = heading + itemList + ending;
    m.params = [num, clean(e.customer_name || 'Guest'), customerPhone, addr, clean(itemList), amount];
`+code.slice(end);
code=replace(code,"'\\uD83D\\uDEB5 Your order '","'\\uD83D\\uDEF5 Your order '");
node(events,'Build Message').parameters.jsCode=code;
let outgoing=node(events,'Build Outgoing').parameters.jsCode;
const old=String.raw`    outgoing = { type: 'template', template: { name: m.template, language: { code: 'en' },
      components: [{ type: 'body', parameters: m.params.map(function (p) { return { type: 'text', text: String(p) }; }) }] } };`;
const newer=String.raw`    var riderWindow = $json && $json.statusCode === 200 && $json.body === true;
    if (riderWindow) {
      outgoing = { type: 'interactive', interactive: { type: 'button', body: { text: m.text },
        action: { buttons: [{ type: 'reply', reply: { id: m.payment_payload, title: 'Payment collected' } }] } } };
    } else {
      outgoing = { type: 'template', template: { name: m.template, language: { code: 'en' }, components: [
        { type: 'body', parameters: m.params.map(function (p) { return { type: 'text', text: String(p) }; }) },
        { type: 'button', sub_type: 'quick_reply', index: '0', parameters: [{ type: 'payload', payload: m.payment_payload }] }
      ] } };
    }`;
outgoing=replace(outgoing,old,newer);node(events,'Build Outgoing').parameters.jsCode=outgoing;
node(events,'Send WhatsApp').parameters.url="={{ $json.kind === 'rider' ? 'https://api.ycloud.com/v2/whatsapp/messages/sendDirectly' : 'https://api.ycloud.com/v2/whatsapp/messages' }}";
const complete=node(events,'Complete Event');complete.parameters.jsonBody=replace(complete.parameters.jsonBody,'var sent = !!m.send && !!$json.id;',"var sent = !!m.send && !!($json.id || $json.wamid) && !$json.error && $json.status !== 'failed';");
const message=node(events,'Build Message');
events.nodes.push({id:randomUUID(),name:'Rider Dispatch?',type:'n8n-nodes-base.if',typeVersion:2.2,position:[message.position[0]+240,message.position[1]],parameters:{conditions:{options:{caseSensitive:true,leftValue:'',typeValidation:'loose',version:3},conditions:[{id:'rider',leftValue:'={{ $json.kind }}',rightValue:'rider',operator:{type:'string',operation:'equals'}}],combinator:'and'},options:{}}});
const claim=node(events,'Claim Events');
events.nodes.push({id:randomUUID(),name:'Rider Message Window',type:'n8n-nodes-base.httpRequest',typeVersion:4.2,position:[message.position[0]+480,message.position[1]-180],parameters:{method:'POST',url:'https://alhnmwwbdydcgcgnwhqw.supabase.co/rest/v1/rpc/otp_window_open',authentication:'predefinedCredentialType',nodeCredentialType:'supabaseApi',sendBody:true,specifyBody:'json',jsonBody:'={{ JSON.stringify({ p_phone: $json.to }) }}',options:{response:{response:{fullResponse:true,neverError:true}},timeout:10000}},credentials:claim.credentials,onError:'continueRegularOutput'});
events.connections['Build Message']={main:[[{node:'Rider Dispatch?',type:'main',index:0}]]};
events.connections['Rider Dispatch?']={main:[[{node:'Rider Message Window',type:'main',index:0}],[{node:'Needs Receipt?',type:'main',index:0}]]};
events.connections['Rider Message Window']={main:[[{node:'Build Outgoing',type:'main',index:0}]]};
let route=node(main,'Route').parameters.jsCode;
const oldRoute=String.raw`// rider tapped "Payment collected" on the dispatch message (approved WhatsApp template button)
if (inp.msg_type === 'button' && low === 'payment collected') {
  return [{ json: Object.assign({}, base, { route: 'rider_payment', context_id: inp.context_id || '' }) }];
}
`;
route=replace(route,oldRoute,'');
route=replace(route,'// staff has taken over',String.raw`// Payment buttons work while staff handle the conversation and outside opening hours.
var riderPayment = low.match(/^fk_paid:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/);
if ((inp.msg_type === 'button' || inp.msg_type === 'interactive') && (riderPayment || low === 'payment collected')) {
  return [{ json: { route: 'rider_payment', customer_phone: inp.customer_phone,
    context_id: inp.context_id || '', payment_order_id: riderPayment ? riderPayment[1] : null } }];
}

// staff has taken over`);
node(main,'Route').parameters.jsCode=route;
const payment=node(main,'Rider Confirm Payment');payment.parameters.url='https://friedking.vercel.app/api/rider/payment';payment.parameters.jsonBody="={{ JSON.stringify({ branchSlug: 'pandeshwar', riderPhone: $json.customer_phone, orderId: $json.payment_order_id || null, messageId: $json.context_id || null }) }}";
configureRiderPayment(main, callbackCredentialId);
const status=node(main,'Update Rider Notify Status');status.parameters.queryParameters={parameters:[{name:'or',value:"={{ '(rider_wa_message_id.eq.' + $json.status_id + ($json.wamid ? ',rider_wa_message_id.eq.' + $json.wamid : '') + ')' }}"}]};status.parameters.jsonBody="={{ JSON.stringify(Object.assign({ rider_notify_status: $json.status }, $json.wamid ? { rider_wa_message_id: $json.wamid } : {})) }}";
for(const workflow of [main,events]){for(const item of workflow.nodes)if(item.parameters.jsCode)new Function(item.parameters.jsCode);fs.writeFileSync(path.join(output,workflow.id+'-after.json'),JSON.stringify(workflow,null,2));}
console.log('Prepared Main and Order Events exports in ' + output);
