const https = require('https');
const fs = require('fs');
const path = require('path');

const N8N_HOST = process.env.N8N_HOST || 'staff.brightmedia.tech';
const WORKFLOW_ID = 'tyqeR0bOhlGGhb8z';

function getApiKey() {
  if (process.env.N8N_API_KEY) return process.env.N8N_API_KEY;
  if (process.env.RASOI_N8N_API_KEY) return process.env.RASOI_N8N_API_KEY;
  const envPaths = [
    path.join(__dirname, '..', '.env.local'),
    path.join(__dirname, '..', '..', 'rasoi', '.env.local')
  ];
  for (const ep of envPaths) {
    if (fs.existsSync(ep)) {
      const match = fs.readFileSync(ep, 'utf8').match(/(?:N8N_API_KEY|RASOI_N8N_API_KEY)=(.*)/);
      if (match && match[1].trim()) return match[1].trim();
    }
  }
  throw new Error('N8N_API_KEY not found in environment or .env.local');
}

const API_KEY = getApiKey();
const SUPABASE_URL = 'https://alhnmwwbdydcgcgnwhqw.supabase.co';
const SUPABASE_CRED = { supabaseApi: { id: 'rB93QINuNPfEbMaT', name: 'Fried King | Supabase (service role)' } };
const YCLOUD_CRED = { httpHeaderAuth: { id: '2sHKICxwNID36i9F', name: 'Fried King | YCloud API Key' } };

function apiRequest(method, endpoint, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = https.request({
      hostname: N8N_HOST, path: endpoint, method,
      headers: {
        'X-N8N-API-KEY': API_KEY, 'Accept': 'application/json',
        ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {})
      }
    }, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => res.statusCode >= 200 && res.statusCode < 300 ? resolve(JSON.parse(d)) : reject(new Error(`HTTP ${res.statusCode}: ${d}`)));
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function main() {
  console.log('1. Fetching current workflow...');
  const wf = await apiRequest('GET', `/api/v1/workflows/${WORKFLOW_ID}`);
  console.log(`   "${wf.name}" (active: ${wf.active})`);

  const nodes = [];
  const connections = {};
  let x = 0;

  function addNode(name, type, typeVersion, params, creds, extra) {
    const n = {
      id: require('crypto').randomUUID(),
      name, type, typeVersion,
      position: [x, 300],
      parameters: params || {}
    };
    if (creds) n.credentials = creds;
    if (extra) Object.assign(n, extra);
    nodes.push(n);
    x += 260;
    return n;
  }

  function connect(from, to, fromIndex) {
    if (!connections[from]) connections[from] = { main: [] };
    while (connections[from].main.length <= (fromIndex || 0)) connections[from].main.push([]);
    connections[from].main[fromIndex || 0].push({ node: to, type: 'main', index: 0 });
  }

  // 1. Trigger
  addNode('Every 15 Seconds', 'n8n-nodes-base.scheduleTrigger', 1.2, {
    rule: { interval: [{ field: 'seconds', secondsInterval: 15 }] }
  });

  // 2. Fetch pending rows (GET)
  addNode('Get Pending Blasts', 'n8n-nodes-base.httpRequest', 4.2, {
    method: 'GET',
    url: `${SUPABASE_URL}/rest/v1/outbound_messages?status=eq.pending&kind=eq.blast&order=created_at.asc&limit=5`,
    authentication: 'predefinedCredentialType',
    nodeCredentialType: 'supabaseApi',
    sendHeaders: true,
    headerParameters: { parameters: [
      { name: 'Content-Type', value: 'application/json' }
    ] },
    options: { timeout: 10000 }
  }, SUPABASE_CRED);

  // 3. Filter / check if any rows returned
  addNode('Check Pending', 'n8n-nodes-base.code', 2, {
    jsCode: `var items = $input.all();
var valid = items.filter(function (i) { return i && i.json && i.json.id; });
if (!valid.length) {
  return []; // Stop execution gracefully when no blasts pending
}
return valid;`
  });

  // 4. Split into batches of 1
  addNode('Loop Over Blasts', 'n8n-nodes-base.splitInBatches', 3, {
    batchSize: 1, options: {}
  });

  // 5. Claim the row in Supabase so no duplicate send happens
  addNode('Claim Blast', 'n8n-nodes-base.httpRequest', 4.2, {
    method: 'PATCH',
    url: `=${SUPABASE_URL}/rest/v1/outbound_messages?id=eq.{{ $json.id }}`,
    authentication: 'predefinedCredentialType',
    nodeCredentialType: 'supabaseApi',
    sendHeaders: true,
    headerParameters: { parameters: [
      { name: 'Content-Type', value: 'application/json' },
      { name: 'Prefer', value: 'return=minimal' }
    ] },
    sendBody: true,
    specifyBody: 'json',
    jsonBody: '={{ JSON.stringify({ status: "claimed", processed_at: new Date().toISOString() }) }}',
    options: { timeout: 10000 }
  }, SUPABASE_CRED);

  // 6. Build the YCloud template payload
  addNode('Prepare YCloud Payload', 'n8n-nodes-base.code', 2, {
    jsCode: `var m = $('Loop Over Blasts').first().json;
var phone = String(m.to_phone || '').replace(/[^0-9]/g, '');
if (phone.length === 10 && '6789'.indexOf(phone.charAt(0)) !== -1) phone = '91' + phone;

var template = m.template_name || 'friedking_promo_en';
var lang = m.language || 'en';
var headerImage = m.header_image || '';
var payload = m.payload || {};
var customerName = (payload && payload.customerName) || '';

var components = [];
if (headerImage) {
  components.push({
    type: 'header',
    parameters: [{ type: 'image', image: { link: headerImage } }]
  });
}
if (customerName) {
  components.push({
    type: 'body',
    parameters: [{ type: 'text', text: customerName }]
  });
}

var sendBody = {
  from: '+919742175222',
  to: '+' + phone,
  type: 'template',
  template: {
    name: template,
    language: { code: lang },
    components: components
  }
};

return [{ json: {
  id: m.id,
  campaign_id: m.campaign_id,
  phone: phone,
  send_body: sendBody
} }];`
  });

  // 7. Send to YCloud
  addNode('Send WhatsApp', 'n8n-nodes-base.httpRequest', 4.2, {
    method: 'POST',
    url: 'https://api.ycloud.com/v2/whatsapp/messages',
    authentication: 'genericCredentialType',
    genericAuthType: 'httpHeaderAuth',
    sendBody: true,
    specifyBody: 'json',
    jsonBody: '={{ JSON.stringify($json.send_body) }}',
    options: { timeout: 15000 }
  }, YCLOUD_CRED, { onError: 'continueRegularOutput' });

  // 8. Parse YCloud response
  addNode('Parse Result', 'n8n-nodes-base.code', 2, {
    jsCode: `var prev = $('Prepare YCloud Payload').first().json;
var res = $input.first().json;

var messageId = '';
try { messageId = res.id || ''; } catch (e) {}

var errorMsg = '';
try {
  if (res.error && res.error.message) errorMsg = res.error.message;
  else if (res.errorMessage) errorMsg = res.errorMessage;
  else if (res.message) errorMsg = res.message;
  else if (typeof res === 'string') errorMsg = res;
} catch (e) {}

var status = messageId ? 'done' : 'failed';

return [{ json: {
  id: prev.id,
  campaign_id: prev.campaign_id,
  status: status,
  message_id: messageId,
  error: String(errorMsg || '').slice(0, 500)
} }];`
  });

  // 9. Update outbound_messages status
  addNode('Update outbound_messages', 'n8n-nodes-base.httpRequest', 4.2, {
    method: 'PATCH',
    url: `=${SUPABASE_URL}/rest/v1/outbound_messages?id=eq.{{ $json.id }}`,
    authentication: 'predefinedCredentialType',
    nodeCredentialType: 'supabaseApi',
    sendHeaders: true,
    headerParameters: { parameters: [
      { name: 'Content-Type', value: 'application/json' },
      { name: 'Prefer', value: 'return=minimal' }
    ] },
    sendBody: true,
    specifyBody: 'json',
    jsonBody: '={{ JSON.stringify({ status: $json.status, error_message: $json.error || null, processed_at: new Date().toISOString() }) }}',
    options: { timeout: 10000 }
  }, SUPABASE_CRED);

  // 10. Throttle 1 second between recipients
  addNode('Throttle 1s', 'n8n-nodes-base.wait', 1.1, {
    amount: 1, unit: 'seconds'
  });

  // 11. End of loop
  addNode('Done Loop', 'n8n-nodes-base.noOp', 1, {});

  // Wire connections:
  connect('Every 15 Seconds', 'Get Pending Blasts');
  connect('Get Pending Blasts', 'Check Pending');
  connect('Check Pending', 'Loop Over Blasts');
  connect('Loop Over Blasts', 'Done Loop', 0);           // Output 0: when done
  connect('Loop Over Blasts', 'Claim Blast', 1);         // Output 1: each batch item
  connect('Claim Blast', 'Prepare YCloud Payload');
  connect('Prepare YCloud Payload', 'Send WhatsApp');
  connect('Send WhatsApp', 'Parse Result');
  connect('Parse Result', 'Update outbound_messages');
  connect('Update outbound_messages', 'Throttle 1s');
  connect('Throttle 1s', 'Loop Over Blasts');

  const cleanSettings = {
    timezone: 'Asia/Kolkata',
    executionOrder: 'v1'
  };

  const payload = {
    name: wf.name,
    nodes,
    connections,
    settings: cleanSettings
  };

  console.log('2. Updating workflow via PUT...');
  const updated = await apiRequest('PUT', `/api/v1/workflows/${WORKFLOW_ID}`, payload);
  console.log(`   Updated. Active: ${updated.active}`);

  if (!updated.active) {
    console.log('3. Activating workflow...');
    await apiRequest('POST', `/api/v1/workflows/${WORKFLOW_ID}/activate`);
    console.log('   Activated!');
  }

  console.log('\nWorkflow deployed successfully!');
}

main().catch(err => {
  console.error('ERROR:', err);
  process.exit(1);
});
