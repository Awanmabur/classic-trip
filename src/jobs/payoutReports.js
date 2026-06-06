const store = require('../services/data/demoStore');
const reportService = require('../services/report/reportService');

function run() {
  const pendingTransactions = store.state.walletTransactions.filter((txn) => txn.status === 'pending');
  const report = reportService.generateCsvReport('admin', 'withdrawals', { userId: 'scheduler' });
  if (!Array.isArray(store.state.supportTickets)) store.state.supportTickets = [];
  const ticket = {
    id: `support-${store.state.supportTickets.length + 1}`,
    ownerType: 'platform',
    ownerId: 'finance',
    category: 'Payout report',
    subject: `Daily payout report ${new Date().toISOString().slice(0, 10)}`,
    message: `${pendingTransactions.length} pending wallet transactions need finance review.`,
    priority: pendingTransactions.length ? 'high' : 'normal',
    status: 'open',
    assignedTo: 'finance',
    createdBy: 'scheduler',
    createdAt: new Date().toISOString(),
    report: { filename: report.filename, contentType: report.contentType, csv: report.csv },
  };
  store.state.supportTickets.unshift(ticket);
  return { wallets: store.state.wallets.length, pendingTransactions: pendingTransactions.length, reportTicketId: ticket.id };
}
module.exports = { run };
