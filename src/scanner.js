/**
 * Scanner module — core polling logic.
 * 
 * Per-PO comparison: restacks+upstacks vs pallet in counts
 * 
 * 1. GET /api/subdept/{sub}/pos/{date}/{date} (Apex Bearer)
 *    → Per-PO pallet counts: palletWhiteInCount, palletChepInCount, etc.
 * 
 * 2. GET /api/subdept/{sub}/ancillaryItems/{date}/{date} (Apex Bearer)
 *    → Sum quantity where additional_Fee_Name is "Restack" or "Upstack" per PO
 * 
 * 3. GET /api/truckSummaries/{sub}/{YYYY-MM-DD}/ (Load Entry Bearer)
 *    → Match by truckId → get driverWalletCheckoutID
 * 
 * 4. If restacks+upstacks > pallets in for a PO AND driverWalletCheckoutID exists:
 *    → DELETE /api/payment/driverwallet/checkout/void/{checkoutID}
 */

const api = require('./api');

const voidedCheckoutIDs = new Set();
const alertedOverPOs = new Set();

async function scan(subDepts, apexToken, loadEntryToken, log) {
  const deptList = Array.isArray(subDepts) ? subDepts : [subDepts];
  const allPoData = [];
  const allActions = [];

  for (const subDept of deptList) {
    const { poData, actions } = await scanOne(subDept, apexToken, loadEntryToken, log);
    allPoData.push(...poData);
    allActions.push(...actions);
  }

  return { poData: allPoData, actions: allActions };
}

async function scanOne(subDept, apexToken, loadEntryToken, log) {
  const dateApex = api.todayApex();
  const dateLE = api.todayLoadEntry();

  // 1. Fetch POs — per-PO pallet counts
  log(`[SD${subDept}] Fetching POs...`);
  const pos = await api.fetchApex(
    `subdept/${subDept}/pos/${dateApex}/${dateApex}`,
    apexToken
  );

  // 2. Fetch ancillary items — restacks/upstacks per PO
  log(`[SD${subDept}] Fetching ancillary items...`);
  const ancillary = await api.fetchApex(
    `subdept/${subDept}/ancillaryItems/${dateApex}/${dateApex}`,
    apexToken
  );

  const restacksByPO = {};
  const carrierByPO = {};
  for (const item of ancillary) {
    const po = item.pO_Number;
    if (po && item.carrier_Name) carrierByPO[po] = item.carrier_Name;
    const feeName = (item.additional_Fee_Name || '').toLowerCase().trim();
    if (feeName === 'restack' || feeName === 'upstack') {
      if (po) {
        restacksByPO[po] = (restacksByPO[po] || 0) + (parseFloat(item.quantity) || 0);
      }
    }
  }

  // 3. Fetch Load Entry truck summaries
  log(`[SD${subDept}] Fetching Load Entry truck summaries...`);
  let leTrucks = [];
  try {
    leTrucks = await api.fetchLoadEntry(
      `truckSummaries/${subDept}/${dateLE}/`,
      loadEntryToken
    );
  } catch (err) {
    if (err.status === 401) throw err; // bubble up for re-auth
    log(`Warning: Load Entry truckSummaries failed: ${err.message}`);
  }

  const leByTruckID = {};
  for (const t of leTrucks) {
    if (t.truckID) leByTruckID[t.truckID] = t;
  }

  const poData = [];
  const actions = [];

  for (const po of pos) {
    const poNumber = po.poNumber || '';
    const truckId = po.truckId || '';
    const carrier = carrierByPO[poNumber] || (leByTruckID[truckId] ? leByTruckID[truckId].carrierName : '') || '';

    const palletsIn = (po.palletWhiteInCount || 0) + (po.palletChepInCount || 0)
      + (po.palletPecoInCount || 0) + (po.palletIgpsInCount || 0);

    const restacksUpstacks = restacksByPO[poNumber] || 0;
    const isOver = restacksUpstacks > palletsIn;

    let status = 'OK';

    if (isOver) {
      status = 'OVER';

      const leTruck = leByTruckID[truckId] || null;
      const checkoutID = leTruck ? (leTruck.driverWalletCheckoutID || null) : null;

      if (checkoutID) {
        if (!voidedCheckoutIDs.has(checkoutID)) {
          try {
            await api.voidDriverWalletCheckout(checkoutID, loadEntryToken);
            voidedCheckoutIDs.add(checkoutID);
            status = 'CANCELLED';
            log(`🚫 CANCELLED wallet payment for PO ${poNumber} | Truck ${truckId.substring(0,8)}... | CheckoutID ${checkoutID}`);
            actions.push({
              type: 'cancelled',
              poNumber,
              truckId,
              carrier,
              palletsIn,
              restacksUpstacks,
              driverWalletCheckoutID: checkoutID,
              timestamp: new Date().toISOString()
            });
          } catch (err) {
            if (err.status === 401) throw err;
            log(`❌ Failed to void checkoutID ${checkoutID} for PO ${poNumber}: ${err.message}`);
          }
        } else {
          status = 'CANCELLED';
        }
      } else if (!alertedOverPOs.has(poNumber)) {
        alertedOverPOs.add(poNumber);
        log(`⚠️ PO ${poNumber}: restacks (${restacksUpstacks}) > pallets in (${palletsIn}) — no wallet payment found`);
        actions.push({
          type: 'over-no-wallet',
          poNumber,
          truckId,
          carrier,
          palletsIn,
          restacksUpstacks,
          driverWalletCheckoutID: null,
          timestamp: new Date().toISOString()
        });
      }
    }

    poData.push({ subDept, poNumber, truckId, carrier, palletsIn, restacksUpstacks, status });
  }

  log(`[SD${subDept}] Scan complete: ${poData.length} POs, ${poData.filter(p => p.status === 'OVER').length} over, ${actions.length} newly cancelled`);
  return { poData, actions };
}

module.exports = { scan };
