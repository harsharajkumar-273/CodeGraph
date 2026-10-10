var methods = ['get', 'post'];
var app = exports = module.exports = {};

app.set = function set(setting, val) {
  this.settings[setting] = val;
  return this;
};

// As in real Express: the verb methods are attached in a loop, so there is NO static `app.get` to resolve to.
methods.forEach(function (method) {
  app[method] = function (path) {
    if (method === 'get' && arguments.length === 1) {
      return this.set(path);
    }
    return this;
  };
});

app.handle = function handle(req, res) {
  return res;
};
