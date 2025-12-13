const { initDatabase, closeDatabase } = require('./database');
const Material = require('./material');
const Device = require('./device');
const History = require('./history');
const Config = require('./config');

const preProcessData = async () => {
  try {
    await Material.resetAll();
  } catch (error) {
    console.error(error);
  }
}

module.exports = {
  initDatabase,
  closeDatabase,
  preProcessData,
  Material,
  Device,
  History,
  Config
};

