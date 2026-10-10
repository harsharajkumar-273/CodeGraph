var root = require('..'); // the package root's index.js, from one directory down

describe('root import', function () {
  it('resolves', function () {
    root.route('/x');
  });
});
