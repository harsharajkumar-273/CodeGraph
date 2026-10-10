var Route = require('./route');

var proto = module.exports = {};

proto.route = function route(path) {
  var route = new Route(path);
  // a Route's `.all`, not the unrelated `User.all` in examples/
  route.all(function () {});
  return route;
};
