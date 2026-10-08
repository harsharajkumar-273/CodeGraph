var res = Object.create(Object.prototype);

res.get = function get(field) {
  return this.getHeader(field);
};

res.set = function set(field, val) {
  this.setHeader(field, val);
  return this;
};

// `app` is an application, NOT a response: `app.get` must not be wired to `res.get`.
res.json = function json(obj) {
  var app = this.app;
  var escape = app.get('json escape');
  app.set('json spaces', 2);
  if (!this.get('Content-Type')) {
    this.set('Content-Type', 'application/json');
  }
  return this.send(String(escape) + JSON.stringify(obj));
};

res.send = function send(body) {
  return body;
};

module.exports = res;
