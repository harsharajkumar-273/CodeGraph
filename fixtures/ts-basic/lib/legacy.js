const { add } = require('../src/math');

function legacy() {
  return add(1, 2);
}

module.exports = { legacy };
