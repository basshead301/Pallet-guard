const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_ADDRESS,
    pass: process.env.GMAIL_APP_PASSWORD
  }
});

async function sendEmail(action) {
  const { poNumber, truckId, carrier, palletsIn, restacksUpstacks, driverWalletCheckoutID, timestamp } = action;

  const ts = new Date(timestamp).toLocaleString('en-US', { timeZone: 'America/New_York' });
  const isCancelled = action.type === 'cancelled';

  const subject = isCancelled
    ? `🛡️ Pallet Guard: Payment CANCELLED - PO ${poNumber}`
    : `⚠️ Pallet Guard: Over Limit Alert - PO ${poNumber}`;

  const heading = isCancelled ? 'Payment Cancelled' : 'Over Limit — No Wallet Payment Found';
  const headColor = isCancelled ? '#c0392b' : '#e67e22';
  const checkoutRow = isCancelled
    ? `<tr><td style="padding: 6px 0; font-weight: 600;">Checkout ID Voided</td><td style="font-family: monospace;">${driverWalletCheckoutID}</td></tr>`
    : '';
  const message = isCancelled
    ? `This payment was automatically voided because restacks + upstacks (${restacksUpstacks}) exceeded the pallet in count (${palletsIn}).`
    : `Restacks + upstacks (${restacksUpstacks}) exceed pallet in count (${palletsIn}), but <strong>no driver wallet checkout was found</strong> to void. Manual review may be needed.`;

  await transporter.sendMail({
    from: `"Pallet Guard" <${process.env.GMAIL_ADDRESS}>`,
    to: process.env.NOTIFY_EMAIL,
    subject,
    html: `
      <div style="font-family: -apple-system, sans-serif; max-width: 560px; margin: 0 auto;">
        <h2 style="color: ${headColor}; border-bottom: 2px solid ${headColor}; padding-bottom: 8px;">
          🛡️ Pallet Guard — ${heading}
        </h2>
        <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
          <tr><td style="padding: 6px 0; font-weight: 600; width: 200px;">PO Number</td><td>${poNumber}</td></tr>
          <tr><td style="padding: 6px 0; font-weight: 600;">Truck ID</td><td style="font-size: 12px; font-family: monospace;">${truckId}</td></tr>
          <tr><td style="padding: 6px 0; font-weight: 600;">Carrier</td><td>${carrier}</td></tr>
          <tr><td style="padding: 6px 0; font-weight: 600;">Pallets In</td><td>${palletsIn}</td></tr>
          <tr><td style="padding: 6px 0; font-weight: 600; color: ${headColor};">Restacks + Upstacks</td><td style="color: ${headColor}; font-weight: 700;">${restacksUpstacks}</td></tr>
          ${checkoutRow}
          <tr><td style="padding: 6px 0; font-weight: 600;">Timestamp</td><td>${ts}</td></tr>
        </table>
        <p style="margin-top: 16px; padding: 12px; background: ${isCancelled ? '#fdf2f2' : '#fef9e7'}; border-left: 4px solid ${headColor}; font-size: 13px;">
          ${message}
        </p>
        <p style="font-size: 11px; color: #999; margin-top: 24px;">Sent by Pallet Guard • Automated monitoring</p>
      </div>
    `
  });
}

async function sendDownAlert(reason) {
  const ts = new Date().toLocaleString('en-US', { timeZone: 'America/New_York' });

  await transporter.sendMail({
    from: `"Pallet Guard" <${process.env.GMAIL_ADDRESS}>`,
    to: process.env.NOTIFY_EMAIL,
    subject: `🚨 Pallet Guard: Scanner DOWN`,
    html: `
      <div style="font-family: -apple-system, sans-serif; max-width: 560px; margin: 0 auto;">
        <h2 style="color: #c0392b; border-bottom: 2px solid #c0392b; padding-bottom: 8px;">
          🚨 Pallet Guard — Scanner Stopped
        </h2>
        <p style="font-size: 14px;"><strong>Reason:</strong> ${reason}</p>
        <p style="font-size: 14px;"><strong>Time:</strong> ${ts}</p>
        <p style="margin-top: 16px; padding: 12px; background: #fdf2f2; border-left: 4px solid #c0392b; font-size: 13px;">
          The Pallet Guard scanner has stopped and is no longer monitoring POs. 
          Visit the dashboard to re-authenticate and restart, or the service will attempt to restart automatically.
        </p>
        <p style="font-size: 11px; color: #999; margin-top: 24px;">Sent by Pallet Guard • Automated monitoring</p>
      </div>
    `
  });
}

module.exports = { sendEmail, sendDownAlert };
