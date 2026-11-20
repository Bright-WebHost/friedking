"""Creates the n8n workflow 'Fried King | Shift Report' (INACTIVE) next to the existing Chat Replies workflow, reusing its credentials.
  python scripts/n8n_shift_report_workflow.py create <out.json>   -> POSTs it to n8n (inactive) and saves what was created
  python scripts/n8n_shift_report_workflow.py build <out.json>    -> only writes the JSON (no network)
Needs N8NKEY in the environment. Activate it only after supabase/friedking_shift_report.sql has been run.
"""
import json, os, sys, uuid, urllib.request

API = 'https://staff.brightmedia.tech/api/v1'
CHAT_REPLIES = 'Ap3fEKiYzKioNjdf'
cmd, out = sys.argv[1], sys.argv[2]


def call(method, path, body=None):
    req = urllib.request.Request(API + path, method=method, headers={'X-N8N-API-KEY': os.environ['N8NKEY'], 'Content-Type': 'application/json'},
                                 data=json.dumps(body).encode() if body is not None else None)
    return json.loads(urllib.request.urlopen(req, timeout=60).read() or b'{}')


if cmd == 'create':
    ref = {n['name']: n for n in call('GET', '/workflows/' + CHAT_REPLIES)['nodes']}
    sb_cred = ref['Claim Replies']['credentials']
    yc_cred = ref['Send WhatsApp']['credentials']
    V = {'sched': ref['Every 5 Seconds']['typeVersion'], 'if': ref['Can Send?']['typeVersion'], 'code': ref['Prepare Reply']['typeVersion'], 'http': ref['Send WhatsApp']['typeVersion']}
else:  # offline build for tests
    sb_cred = {'supabaseApi': {'id': 'x', 'name': 'x'}}
    yc_cred = {'httpHeaderAuth': {'id': 'x', 'name': 'x'}}
    V = {'sched': 1.2, 'if': 2.2, 'code': 2, 'http': 4.2}

RPC = 'https://alhnmwwbdydcgcgnwhqw.supabase.co/rest/v1/rpc/'
HDR = {'parameters': [{'name': 'Content-Type', 'value': 'application/json'}]}


def node(name, type_, params, x, cred=None, version=1, extra=None):
    n = {'id': str(uuid.uuid4()), 'name': name, 'type': type_, 'typeVersion': version, 'position': [x, 0], 'parameters': params}
    if cred: n['credentials'] = cred
    if extra: n.update(extra)
    return n


nodes = [
    node('Every Minute', 'n8n-nodes-base.scheduleTrigger', {'rule': {'interval': [{'field': 'minutes', 'minutesInterval': 1}]}}, 0, version=V['sched']),
    node('Claim Report', 'n8n-nodes-base.httpRequest', {
        'authentication': 'predefinedCredentialType', 'nodeCredentialType': 'supabaseApi', 'sendBody': True, 'specifyBody': 'json',
        'sendHeaders': True, 'headerParameters': HDR, 'method': 'POST', 'url': RPC + 'claim_shift_report',
        'jsonBody': '={{ JSON.stringify({ p_branch: "pandeshwar" }) }}', 'options': {'timeout': 20000}}, 240, sb_cred, V['http']),
    node('Send?', 'n8n-nodes-base.if', {'conditions': {
        'options': {'caseSensitive': True, 'leftValue': '', 'typeValidation': 'loose', 'version': 3},
        'conditions': [{'id': 's1', 'leftValue': '={{ $json.send }}', 'rightValue': '', 'operator': {'type': 'boolean', 'operation': 'true', 'singleValue': True}}],
        'combinator': 'and'}, 'options': {}}, 480, version=V['if']),
    node('Build Messages', 'n8n-nodes-base.code', {'jsCode': """// One message per number: plain text inside the 24-hour window, the approved template outside it.
var r = $input.first().json;
var tpl = r.template || { name: 'friedking_shift_report', params: [] };
return (r.recipients || []).map(function (x) {
  var outgoing = x.in_window
    ? { type: 'text', text: { body: String(r.text || '') } }
    : { type: 'template', template: { name: tpl.name, language: { code: 'en' },
        components: [{ type: 'body', parameters: (tpl.params || []).map(function (p) { return { type: 'text', text: String(p) }; }) }] } };
  return { json: { to: String(x.phone || '').replace(/[^0-9]/g, ''), via: x.in_window ? 'text' : 'template', outgoing: outgoing } };
});
"""}, 720, version=V['code']),
    node('Send WhatsApp', 'n8n-nodes-base.httpRequest', {
        'method': 'POST', 'url': 'https://api.ycloud.com/v2/whatsapp/messages', 'authentication': 'genericCredentialType', 'genericAuthType': 'httpHeaderAuth',
        'sendHeaders': True, 'headerParameters': HDR, 'sendBody': True, 'specifyBody': 'json',
        'jsonBody': '={{ JSON.stringify(Object.assign({ from: "+919742175222", to: "+" + $json.to }, $json.outgoing)) }}',
        'options': {'timeout': 20000, 'response': {'response': {'neverError': True, 'fullResponse': True}}}}, 960, yc_cred, V['http'],
        {'onError': 'continueRegularOutput'}),
    node('Summarize', 'n8n-nodes-base.code', {'jsCode': """// One line per number: sent / FAILED, with the reason when WhatsApp refused it.
var planned = $('Build Messages').all();
var results = $input.all();
var lines = planned.map(function (p, i) {
  var res = (results[i] && results[i].json) || {};
  var code = Number(res.statusCode || 0);
  var body = res.body || res;
  var good = code >= 200 && code < 300 && body && body.id;
  var why = '';
  if (!good) {
    var e = (body && (body.error || body)) || {};
    why = String(e.message || e.code || JSON.stringify(e)).replace(/\\s+/g, ' ').slice(0, 120);
  }
  return String(p.json.to).slice(-10) + ': ' + (good ? 'sent (' + p.json.via + ')' : 'FAILED (' + p.json.via + ') ' + why);
});
return [{ json: { status: lines.join('; ') } }];
"""}, 1200, version=V['code']),
    node('Save Result', 'n8n-nodes-base.httpRequest', {
        'authentication': 'predefinedCredentialType', 'nodeCredentialType': 'supabaseApi', 'sendBody': True, 'specifyBody': 'json',
        'sendHeaders': True, 'headerParameters': HDR, 'method': 'POST', 'url': RPC + 'complete_shift_report',
        'jsonBody': '={{ JSON.stringify({ p_branch: "pandeshwar", p_status: $json.status }) }}', 'options': {'timeout': 15000}}, 1440, sb_cred, V['http']),
]
conns = {
    'Every Minute': {'main': [[{'node': 'Claim Report', 'type': 'main', 'index': 0}]]},
    'Claim Report': {'main': [[{'node': 'Send?', 'type': 'main', 'index': 0}]]},
    'Send?': {'main': [[{'node': 'Build Messages', 'type': 'main', 'index': 0}], []]},
    'Build Messages': {'main': [[{'node': 'Send WhatsApp', 'type': 'main', 'index': 0}]]},
    'Send WhatsApp': {'main': [[{'node': 'Summarize', 'type': 'main', 'index': 0}]]},
    'Summarize': {'main': [[{'node': 'Save Result', 'type': 'main', 'index': 0}]]},
}
wf = {'name': 'Fried King | Shift Report', 'nodes': nodes, 'connections': conns,
      'settings': {'executionOrder': 'v1', 'saveDataSuccessExecution': 'none', 'saveDataErrorExecution': 'all', 'saveManualExecutions': False}}

if cmd == 'create':
    made = call('POST', '/workflows', wf)
    got = call('GET', '/workflows/' + made['id'])
    json.dump(got, open(out, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print('created', made['id'], 'active =', got.get('active'))
else:
    json.dump(wf, open(out, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print('built ->', out)
