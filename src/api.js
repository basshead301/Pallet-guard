const APEX_API = 'https://siteadminsso.capstonelogistics.com/api/';
const LE_API = 'https://apexloadentryapi.capstonelogistics.com/api/';

async function fetchApex(endpoint, token) {
  const res = await fetch(APEX_API + endpoint, {
    headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' }
  });
  if (res.status === 401) { const err = new Error('Apex auth expired (401)'); err.status = 401; throw err; }
  if (!res.ok) throw new Error(`Apex API ${res.status}: ${endpoint}`);
  const text = await res.text();
  try { return JSON.parse(text); } catch (e) { throw new Error(`Apex API bad JSON for ${endpoint}: ${text.substring(0, 200)}`); }
}

async function fetchLoadEntry(endpoint, token) {
  const res = await fetch(LE_API + endpoint, {
    headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' }
  });
  if (res.status === 401) { const err = new Error('Load Entry auth expired (401)'); err.status = 401; throw err; }
  if (!res.ok) throw new Error(`LE API ${res.status}: ${endpoint}`);
  const text = await res.text();
  try { return JSON.parse(text); } catch (e) { throw new Error(`LE API bad JSON for ${endpoint}: ${text.substring(0, 200)}`); }
}

async function voidDriverWalletCheckout(checkoutID, token) {
  const res = await fetch(LE_API + `payment/driverwallet/checkout/void/${checkoutID}`, {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' }
  });
  if (res.status === 401) { const err = new Error('Load Entry auth expired'); err.status = 401; throw err; }
  if (!res.ok) throw new Error(`Void failed ${res.status}`);
  return true;
}

function getOperationalDate() {
  const d = new Date();
  // Before 2:00 AM = still previous day's shift
  if (d.getHours() < 2) {
    d.setDate(d.getDate() - 1);
  }
  return d;
}

function todayApex() {
  const d = getOperationalDate();
  return `${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}-${d.getFullYear()}`;
}

function todayLoadEntry() {
  const d = getOperationalDate();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

module.exports = { fetchApex, fetchLoadEntry, voidDriverWalletCheckout, todayApex, todayLoadEntry };
