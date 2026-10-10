var create = require('../lib/index-fwd');

describe('forwarded default export', function () {
  it('calls through module.exports = require(...)', function () {
    create();
  });
});
