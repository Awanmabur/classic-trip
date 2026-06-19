const futureServiceArchitecture = require('../../services/release/futureServiceArchitecture');

function summary(req, res) {
  res.json({
    status: 'section-k-architecture-ready',
    checkoutEnabledServices: ['bus', 'hotel'],
    futureServices: futureServiceArchitecture.modules(),
  });
}

module.exports = { summary };
