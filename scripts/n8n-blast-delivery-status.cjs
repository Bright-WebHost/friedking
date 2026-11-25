// Promotions delivery status: wires n8n to supabase/friedking_blast_delivery_status.sql.
// Run AFTER that SQL: node scripts/n8n-blast-delivery-status.cjs
//  - Blast Sender (3 branches): saves YCloud's message id on each outbound_messages row.
//  - Main (3 branches): "Update Blast Status" now calls fk_blast_status (sent/delivered/read/failed).
// Backups go to n8n-falnir/ (gitignored). Every workflow is re-activated if the update deactivated it.
const https = require('https')
const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..')
const readKey = (file, re) => { try { return (fs.readFileSync(file, 'utf8').match(re) || [])[1]?.trim() } catch { return undefined } }
const N8N_KEY = process.env.N8N_API_KEY || readKey(path.join(root, '.env.local'), /N8N_API_KEY=(.*)/) || readKey(path.join(root, '..', 'rasoi', '.env.local'), /(?:N8N_API_KEY|RASOI_N8N_API_KEY)=(.*)/)
const SB_KEY = readKey(path.join(root, '.env.local'), /SUPABASE_SERVICE_ROLE_KEY=(.*)/)
const SB_HOST = 'alhnmwwbdydcgcgnwhqw.supabase.co'
if (!N8N_KEY || !SB_KEY) throw new Error('Missing N8N_API_KEY or SUPABASE_SERVICE_ROLE_KEY')

const BLAST = ['tyqeR0bOhlGGhb8z', 'RDTaDEFfTisPtkoY', 't3AAW5viPzBvLt2h']
const MAIN = ['bs21eCX2lGfXAeme', 'GjJB4Do7JFwdb7cj', 'ZRHp1L9SCmcBEh83']

function rq(host, method, p, headers, body) {
  return new Promise((resolve, reject) => {
    const d = body ? JSON.stringify(body) : null
    const req = https.request({ hostname: host, path: p, method, headers: { Accept: 'application/json', ...headers, ...(d ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(d) } : {}) } }, (res) => {
      let t = ''; res.on('data', (c) => t += c)
      res.on('end', () => res.statusCode < 300 ? resolve(t ? JSON.parse(t) : {}) : reject(new Error(`${method} ${p}: HTTP ${res.statusCode} ${t.slice(0, 300)}`)))
    })
    req.on('error', reject); if (d) req.write(d); req.end()
  })
}
const n8n = (m, p, b) => rq('staff.brightmedia.tech', m, p, { 'X-N8N-API-KEY': N8N_KEY }, b)

async function save(id, wf) {
  const allowed = ['executionOrder', 'saveManualExecutions', 'saveExecutionProgress', 'saveDataErrorExecution', 'saveDataSuccessExecution', 'executionTimeout', 'errorWorkflow', 'timezone', 'callerPolicy']
  const settings = {}; for (const k of allowed) if (wf.settings && wf.settings[k] !== undefined) settings[k] = wf.settings[k]
  const wasActive = wf.active
  await n8n('PUT', `/api/v1/workflows/${id}`, { name: wf.name, nodes: wf.nodes, connections: wf.connections, settings })
  const after = await n8n('GET', `/api/v1/workflows/${id}`)
  if (wasActive && !after.active) await n8n('POST', `/api/v1/workflows/${id}/activate`)
  return (await n8n('GET', `/api/v1/workflows/${id}`)).active
}

;(async () => {
  // 1. The SQL must be in place first, otherwise the PATCH below would fail and blasts would stay stuck.
  await rq(SB_HOST, 'GET', '/rest/v1/outbound_messages?select=wa_message_id,delivery_status&limit=1', { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` })
    .catch(() => { throw new Error('Run supabase/friedking_blast_delivery_status.sql first (columns not found).') })

  for (const id of BLAST) {
    const wf = await n8n('GET', `/api/v1/workflows/${id}`)
    fs.writeFileSync(path.join(root, 'n8n-falnir', `backup-before-delivery-status-${id}.json`), JSON.stringify(wf))
    const node = wf.nodes.find((n) => n.name === 'Update outbound_messages')
    const OLD = 'processed_at: new Date().toISOString() })'
    if (node.parameters.jsonBody.includes('wa_message_id')) { console.log(wf.name, ': already saves the message id'); continue }
    if (!node.parameters.jsonBody.includes(OLD)) throw new Error(`${wf.name}: unexpected Update outbound_messages body`)
    node.parameters.jsonBody = node.parameters.jsonBody.replace(OLD, "processed_at: new Date().toISOString(), wa_message_id: $json.message_id || null, delivery_status: $json.status === 'done' ? 'sent' : null })")
    console.log(wf.name, ': saves message id, active =', await save(id, wf))
  }

  for (const id of MAIN) {
    const wf = await n8n('GET', `/api/v1/workflows/${id}`)
    fs.writeFileSync(path.join(root, 'n8n-falnir', `backup-before-delivery-status-${id}.json`), JSON.stringify(wf))
    const node = wf.nodes.find((n) => n.name === 'Update Blast Status')
    if (!node) throw new Error(`${wf.name}: no "Update Blast Status" node`)
    node.parameters = {
      method: 'POST',
      url: `https://${SB_HOST}/rest/v1/rpc/fk_blast_status`,
      authentication: 'predefinedCredentialType',
      nodeCredentialType: 'supabaseApi',
      sendHeaders: true,
      headerParameters: { parameters: [{ name: 'Content-Type', value: 'application/json' }, { name: 'Prefer', value: 'return=minimal' }] },
      sendBody: true,
      specifyBody: 'json',
      jsonBody: "={{ JSON.stringify({ p_message_id: $json.status_id, p_status: $json.status, p_error: $json.error_code ? ($json.error_code + ': ' + $json.error_message) : null }) }}",
      options: { timeout: 10000 },
    }
    node.onError = 'continueRegularOutput'
    console.log(wf.name, ': Update Blast Status -> fk_blast_status, active =', await save(id, wf))
  }
})().catch((e) => { console.error(e.message); process.exit(1) })
