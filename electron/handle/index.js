function initIpc() {
    require('./db.js').init()
    require('./work.js').init()
}

module.exports = {
    initIpc
}