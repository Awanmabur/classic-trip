const express = require('express');
const { publicReadLimiter } = require('../../middlewares/rateLimit');
const searchController = require('../../controllers/api/searchController');
const router = express.Router();
router.use(publicReadLimiter);
router.get('/', searchController.index);
module.exports = router;
