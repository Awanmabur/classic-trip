const express = require('express');
const searchController = require('../../controllers/api/searchController');
const router = express.Router();
router.get('/', searchController.index);
module.exports = router;
