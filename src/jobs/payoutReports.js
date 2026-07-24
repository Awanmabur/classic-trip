const { platformCurrency } = require('../utils/currency');
const crypto = require('crypto');
const financeRepository = require('../repositories/domain/financeRepository');
const supportRepository = require('../repositories/domain/supportRepository');

function digest(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex').slice(0, 16);
}

function transactionRow(transaction) {
  return {
    transactionId: transaction.id,
    ownerType: transaction.ownerType,
    ownerId: transaction.ownerId,
    transactionType: transaction.transactionType,
    direction: transaction.direction,
    amount: Number(transaction.amount || 0),
    currency: transaction.currency || platformCurrency(),
    referenceType: transaction.referenceType || '',
    referenceId: transaction.referenceId || '',
    requestedAt: transaction.createdAt || null,
  };
}

async function run() {
  const now = new Date();
  const reportDate = now.toISOString().slice(0, 10);
  const pendingTransactions = await financeRepository.transactions.list(
    { status: 'pending' },
    { sort: { createdAt: 1 }, limit: 10000 }
  );
  const walletCount = await financeRepository.wallets.count({});
  const grouped = pendingTransactions.reduce((map, transaction) => {
    const currency = String(transaction.currency || platformCurrency()).toUpperCase();
    if (!map.has(currency)) map.set(currency, []);
    map.get(currency).push(transaction);
    return map;
  }, new Map());

  const statements = [];
  for (const [currency, transactions] of grouped.entries()) {
    const statementRef = `PAYOUT-${reportDate}-${currency}`;
    const rows = transactions.map(transactionRow);
    statements.push({
      id: `finance-statement-${digest(statementRef)}`,
      statementRef,
      ownerType: 'platform',
      ownerId: 'finance',
      periodStart: new Date(`${reportDate}T00:00:00.000Z`),
      periodEnd: now,
      currency,
      gross: rows.filter((row) => row.direction === 'credit').reduce((sum, row) => sum + row.amount, 0),
      payoutTotal: rows.filter((row) => row.direction === 'debit' || row.transactionType === 'withdrawal_request').reduce((sum, row) => sum + row.amount, 0),
      openingBalance: 0,
      closingBalance: 0,
      status: 'issued',
      generatedBy: 'scheduler:payoutReports',
      generatedAt: now,
      rows,
      notes: `${rows.length} pending wallet transactions awaiting finance review.`,
    });
  }

  const ticketId = `support-payout-report-${reportDate}`;
  const ticket = {
    id: ticketId,
    ownerType: 'platform',
    ownerId: 'finance',
    category: 'Payout report',
    subject: `Daily payout report ${reportDate}`,
    message: `${pendingTransactions.length} pending wallet transactions across ${grouped.size} currencies need finance review.`,
    priority: pendingTransactions.length ? 'high' : 'normal',
    status: 'open',
    assignedTo: 'finance',
    createdBy: 'scheduler:payoutReports',
    metadata: {
      reportDate,
      statementRefs: statements.map((statement) => statement.statementRef),
      pendingTransactionCount: pendingTransactions.length,
      walletCount,
      currencies: [...grouped.keys()],
    },
    createdAt: now.toISOString(),
  };

  await financeRepository.withTransaction(async (session) => {
    if (statements.length) {
      await financeRepository.statements.saveMany(
        statements,
        (statement) => ({ statementRef: statement.statementRef }),
        { session: session || undefined }
      );
    }
    await supportRepository.tickets.save(ticket, { id: ticket.id }, {
      session: session || undefined,
    });
    await financeRepository.auditLogs.save({
      id: `audit-${digest(`payout-report:${reportDate}`)}`,
      actorId: 'scheduler:payoutReports',
      actorRole: 'system',
      action: 'finance.payout_report.generated',
      entityType: 'support_ticket',
      entityId: ticket.id,
      targetType: 'support_ticket',
      targetId: ticket.id,
      target: ticket.id,
      status: 'success',
      metadata: ticket.metadata,
      meta: ticket.metadata,
      createdAt: now.toISOString(),
    }, { id: `audit-${digest(`payout-report:${reportDate}`)}` }, { session: session || undefined });
  });

  return {
    wallets: walletCount,
    pendingTransactions: pendingTransactions.length,
    reportTicketId: ticket.id,
    statementRefs: statements.map((statement) => statement.statementRef),
  };
}

module.exports = { run };
