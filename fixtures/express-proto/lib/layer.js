// Does not import ./route, so Route.all is not "near"; the receiver name is the only clue.
module.exports = function dispatch(route, req) {
  return route.all(req);
};
