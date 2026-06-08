const multer = require('multer');
const path = require('path');

const storage = multer.diskStorage({
  destination(req, _file, cb) {
    const dest = req.query.path;
    if (!dest) return cb(new Error('Missing path query parameter'));
    cb(null, dest);
  },
  filename(_req, file, cb) {
    cb(null, file.originalname);
  }
});

const upload = multer({ storage });

module.exports = upload;
