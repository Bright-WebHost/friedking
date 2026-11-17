const assert = require('node:assert/strict');

/** Use the app-scoped callback credential and terminate without messaging the rider. */
function configureRiderPayment(workflow, credentialId) {
  assert.ok(credentialId, 'A Fried King rider callback httpHeaderAuth credential ID is required.');
  const payment = workflow.nodes.find(node => node.name === 'Rider Confirm Payment');
  assert.ok(payment, 'Rider Confirm Payment node is missing.');
  assert.equal(payment.parameters.url, 'https://friedking.vercel.app/api/rider/payment', 'Deploy/configure the app callback endpoint first.');
  payment.parameters.authentication = 'genericCredentialType';
  payment.parameters.genericAuthType = 'httpHeaderAuth';
  delete payment.parameters.nodeCredentialType;
  payment.parameters.options = { ...payment.parameters.options, timeout: 30000 };
  payment.credentials = { httpHeaderAuth: { id: credentialId, name: 'Fried King | Rider Payment Callback' } };
  payment.onError = 'stopWorkflow';
  payment.retryOnFail = true;
  payment.maxTries = 3;
  payment.waitBetweenTries = 1000;
  workflow.nodes = workflow.nodes.filter(node => node.name !== 'Build Rider Payment Reply');
  delete workflow.connections['Build Rider Payment Reply'];
  // A successful, repeated, or unmatched payment action has no rider-facing output.
  delete workflow.connections['Rider Confirm Payment'];
  const route = workflow.nodes.find(node => node.name === 'Route');
  assert.ok(route, 'Route node is missing.');
  if (!route.parameters.jsCode.includes('// Bare payment acknowledgements stay silent.')) {
    const marker = '// staff has taken over';
    assert.equal(route.parameters.jsCode.split(marker).length, 2, 'Payment route source changed; review it before patching.');
    route.parameters.jsCode = route.parameters.jsCode.replace(marker,
      "// Bare payment acknowledgements stay silent.\nif (low === 'payment collected') {\n  return [{ json: { route: 'ignore', customer_phone: inp.customer_phone } }];\n}\n\n" + marker);
  }
  for (const outputs of Object.values(workflow.connections)) {
    for (const branches of Object.values(outputs)) for (const branch of branches) {
      assert.ok(!branch.some(edge => edge.node === 'Build Rider Payment Reply'), 'Unexpected rider-reply connection.');
    }
  }
  return workflow;
}

module.exports = { configureRiderPayment };

if (require.main === module) {
  const fs = require('node:fs');
  const [source, destination, credentialId] = process.argv.slice(2);
  assert.ok(source && destination, 'Usage: node scripts/rider-payment-workflow.cjs <before.json> <after.json> <callback-credential-id>');
  const workflow = configureRiderPayment(JSON.parse(fs.readFileSync(source, 'utf8')), credentialId);
  fs.writeFileSync(destination, JSON.stringify(workflow, null, 2));
  console.log('Prepared the app-scoped payment callback with no rider reply.');
}
