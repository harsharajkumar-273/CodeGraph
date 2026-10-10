// No resolvable imports at all, so there is no evidence about which tree this works against:
// a lone, uniquely-named candidate elsewhere stays a (low-confidence) guess instead of being dropped.
module.exports = function run(thing) {
  return thing.handle();
};
