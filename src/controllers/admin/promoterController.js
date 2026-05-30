const store = require('../../services/data/demoStore');
function list(req, res) { res.json(store.state.users.filter((user) => user.role === 'promoter')); }
module.exports = { list };
