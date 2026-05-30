const express = require('express');
const upload = require('../../middlewares/upload');
const uploadController = require('../../controllers/api/uploadController');
const router = express.Router();
router.post('/', upload.single('file'), uploadController.upload);
router.post('/signature', uploadController.signature);
module.exports = router;
