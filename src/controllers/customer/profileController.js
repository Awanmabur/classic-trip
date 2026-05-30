function update(req, res) { if (req.session.user) Object.assign(req.session.user, req.body); res.redirect('/account'); }
module.exports = { update };
