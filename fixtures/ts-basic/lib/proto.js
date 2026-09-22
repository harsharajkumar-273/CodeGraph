function Greeter() {}

Greeter.prototype.hello = function hello() {
  return this.name();
};

Greeter.prototype.name = function () {
  return 'x';
};

const app = {};

app.handle = function handle() {
  return helper();
};

function helper() {
  return 1;
}

module.exports = Greeter;
