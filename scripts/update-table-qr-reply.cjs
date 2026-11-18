const https = require('https');
const fs = require('fs');
const path = require('path');

const N8N_HOST = process.env.N8N_HOST || 'staff.brightmedia.tech';
const WORKFLOW_ID = 'bs21eCX2lGfXAeme';

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

function apiRequest(method, endpoint, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = https.request({
      hostname: N8N_HOST,
      path: endpoint,
      method: method,
      headers: {
        'X-N8N-API-KEY': API_KEY,
        'Accept': 'application/json',
        ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {})
      }
    }, (res) => {
      let respData = '';
      res.on('data', chunk => { respData += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(JSON.parse(respData));
          } catch (e) {
            resolve(respData);
          }
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${respData}`));
        }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function main() {
  console.log('1. Fetching current workflow from n8n...');
  const wf = await apiRequest('GET', `/api/v1/workflows/${WORKFLOW_ID}`);
  console.log(`Fetched workflow: "${wf.name}" (ID: ${wf.id}, Active: ${wf.active})`);

  // Save fresh backup
  const backupPath = path.join(__dirname, `bs21eCX2lGfXAeme-backup-${Date.now()}.json`);
  fs.writeFileSync(backupPath, JSON.stringify(wf, null, 2));
  console.log(`Backup saved to: ${backupPath}`);

  // Find target node: "Build Dine-In Reply"
  const targetNode = wf.nodes.find(n => n.name === 'Build Dine-In Reply');
  if (!targetNode) {
    throw new Error('Target node "Build Dine-In Reply" not found!');
  }

  console.log('\n--- Current jsCode ---');
  console.log(targetNode.parameters.jsCode);

  // New crisp, clear, and professional jsCode
  const newJsCode = [
    "var d = $('Route').first().json;",
    "var res = $input.first().json || {};",
    "var table = String(res.table_number || d.table_number || '');",
    "var nameTrim = d.customer_name ? String(d.customer_name).trim().split(/\\s+/)[0] : '';",
    "var first = nameTrim ? (' ' + nameTrim) : '';",
    "var back = (d.customer && Number(d.customer.total_orders) > 0);",
    "",
    "if (res.result !== 'open') {",
    "  return [{ json: { customer_phone: d.customer_phone, outgoing: { type: 'text', text: { body:",
    "    'Hello' + first + '! We could not find Table ' + table + '. Please ask our staff for assistance, ' +",
    "    'or let us know what you would like to order.' } } } }];",
    "}",
    "",
    "var url = d.menu_url + (d.menu_url.indexOf('?') > -1 ? '&ph=' : '?ph=') + encodeURIComponent(d.customer_phone) +",
    "  '&table=' + encodeURIComponent(table);",
    "var greeting = 'Hello' + first + '! 👋 ' + (back ? 'Welcome back to Fried King.' : 'Welcome to Fried King.');",
    "var msg = greeting + '\\n\\n' +",
    "  'You are seated at *Table ' + table + '*.\\n' +",
    "  'Browse the menu and place your order, then pay for everything together at the counter when you leave.';",
    "",
    "return [{ json: { customer_phone: d.customer_phone, outgoing: { type: 'interactive', interactive: {",
    "  type: 'cta_url', body: { text: msg.slice(0, 1024) },",
    "  action: { name: 'cta_url', parameters: { display_text: 'Browse Menu', url: url } } } } } }];",
    ""
  ].join('\n');

  targetNode.parameters.jsCode = newJsCode;

  console.log('\n--- Updated jsCode ---');
  console.log(newJsCode);

  // Filter settings to only allowed properties
  const ALLOWED_SETTINGS = [
    'executionOrder',
    'saveDataErrorExecution',
    'saveDataSuccessExecution',
    'saveManualExecutions',
    'saveExecutionProgress',
    'executionTimeout',
    'errorWorkflow',
    'timezone',
    'callerPolicy'
  ];
  const cleanSettings = {};
  if (wf.settings) {
    for (const key of ALLOWED_SETTINGS) {
      if (key in wf.settings) {
        cleanSettings[key] = wf.settings[key];
      }
    }
  }

  const payload = {
    name: wf.name,
    nodes: wf.nodes,
    connections: wf.connections,
    settings: cleanSettings
  };

  console.log('\n2. Updating workflow via PUT...');
  const updated = await apiRequest('PUT', `/api/v1/workflows/${WORKFLOW_ID}`, payload);
  console.log(`Workflow updated. Active status in response: ${updated.active}`);

  if (!updated.active) {
    console.log('3. Reactivating workflow...');
    await apiRequest('POST', `/api/v1/workflows/${WORKFLOW_ID}/activate`);
    console.log('Workflow reactivated!');
  }

  console.log('\n4. Verifying updated workflow...');
  const verified = await apiRequest('GET', `/api/v1/workflows/${WORKFLOW_ID}`);
  const verifiedNode = verified.nodes.find(n => n.name === 'Build Dine-In Reply');
  console.log(`Verified active: ${verified.active}`);
  console.log('Verified node jsCode matches new code:', verifiedNode.parameters.jsCode === newJsCode);
  console.log('\nDone! Successfully updated table QR scan reply.');
}

main().catch(err => {
  console.error('Error updating workflow:', err);
  process.exit(1);
});
