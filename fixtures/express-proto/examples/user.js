function User(name) {
  this.name = name;
}

User.all = function (fn) {
  fn(null, []);
};

module.exports = User;
