const path = require('path')

function setStaticAssetHeaders(res, filePath) {
  const ext = path.extname(filePath).toLowerCase()

  if (ext === '.mjs') {
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8')
  }
}

module.exports = {
  setStaticAssetHeaders
}
