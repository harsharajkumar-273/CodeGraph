module.exports = Route;

function Route(path) {
  this.path = path;
}

Route.prototype.all = function all(handler) {
  return handler;
};
