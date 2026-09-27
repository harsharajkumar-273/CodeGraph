# Precision sample — expressjs__express


## resolved (11 of 95 total)

### [resolved] #1: test/express.text.js -> test/express.text.js#createApp

**Call site** (test/express.text.js:11):
```
   9: describe('express.text()', function () {
   10:   before(function () {
>> 11:     this.app = createApp()
   12:   })
   13: 
```

**Target definition** (test/express.text.js#createApp):
```
   549: function createApp (options) {
   550:   var app = express()
   551: 
   552:   app.use(express.text(options))
   553: 
   554:   app.use(function (err, req, res, next) {
   555:     res.status(err.status || 500)
   556:     res.send(String(req.headers['x-error-property']
   557:       ? err[req.headers['x-error-property']]
   558:       : ('[' + err.type + '] ' + err.message)))
   559:   })
```

**Verdict:** correct

---

### [resolved] #2: test/res.send.js -> test/support/utils.js#shouldHaveHeader

**Call site** (test/res.send.js:615):
```
   613:           .get('/')
   614:           .expect(utils.shouldNotHaveHeader('Content-Length'))
>> 615:           .expect(utils.shouldHaveHeader('Transfer-Encoding'))
   616:           .expect(200, '', done);
   617:       })
```

**Target definition** (test/support/utils.js#shouldHaveHeader):
```
   45: function shouldHaveHeader (header) {
   46:   return function (res) {
   47:     assert.ok((header.toLowerCase() in res.headers), 'should have header ' + header)
   48:   }
   49: }
```

**Verdict:** correct

---

### [resolved] #3: test/app.render.js -> test/app.render.js#createApp

**Call site** (test/app.render.js:11):
```
   9:   describe('.render(name, fn)', function(){
   10:     it('should support absolute paths', function(done){
>> 11:       var app = createApp();
   12: 
   13:       app.locals.user = { name: 'tobi' };
```

**Target definition** (test/app.render.js#createApp):
```
   386: function createApp() {
   387:   var app = express();
   388: 
   389:   app.engine('.tmpl', tmpl);
   390: 
   391:   return app;
   392: }
```

**Verdict:** correct

---

### [resolved] #4: test/app.router.js -> test/app.router.js#supportsRegexp

**Call site** (test/app.router.js:196):
```
   194:     })
   195: 
>> 196:     if (supportsRegexp('(?<foo>.*)')) {
   197:       it('should populate req.params with named captures', function (done) {
   198:         var app = express();
```

**Target definition** (test/app.router.js#supportsRegexp):
```
   1210: function supportsRegexp(source) {
   1211:   try {
   1212:     new RegExp(source)
   1213:     return true
   1214:   } catch (e) {
   1215:     return false
   1216:   }
   1217: }
```

**Verdict:** correct

---

### [resolved] #5: lib/response.js#res.json -> lib/response.js#res.get

**Call site** (lib/response.js#res.json:239):
```
   237:   // settings
   238:   var app = this.app;
>> 239:   var escape = app.get('json escape')
   240:   var replacer = app.get('json replacer');
   241:   var spaces = app.get('json spaces');
```

**Target definition** (lib/response.js#res.get):
```
   701: res.get = function(field){
   702:   return this.getHeader(field);
   703: };
```

**Verdict:** wrong — app.get (Application) matched res.get (Response); two different prototypes both define .get()

---

### [resolved] #6: lib/response.js#res.links -> lib/response.js#res.get

**Call site** (lib/response.js#res.links:99):
```
   97: 
   98: res.links = function(links) {
>> 99:   var link = this.get('Link') || '';
   100:   if (link) link += ', ';
   101:   return this.set('Link', link + Object.keys(links).map(function(rel) {
```

**Target definition** (lib/response.js#res.get):
```
   701: res.get = function(field){
   702:   return this.getHeader(field);
   703: };
```

**Verdict:** correct — this.get inside res.links (this = res) really is res.get

---

### [resolved] #7: examples/search/index.js -> examples/search/index.js#initializeRedis

**Call site** (examples/search/index.js:78):
```
   76: 
   77: (async () => {
>> 78:   await initializeRedis();
   79:   if (!module.parent) {
   80:     app.listen(3000);
```

**Target definition** (examples/search/index.js#initializeRedis):
```
   29: async function initializeRedis() {
   30:   try {
   31:     // connect to Redis
   32: 
   33:     await db.connect();
   34: 
   35:     // populate search
   36: 
   37:     await db.sAdd('ferret', 'tobi');
   38:     await db.sAdd('ferret', 'loki');
   39:     await db.sAdd('ferret', 'jane');
```

**Verdict:** correct

---

### [resolved] #8: lib/application.js#app.disabled -> lib/application.js#app.set

**Call site** (lib/application.js#app.disabled:440):
```
   438: 
   439: app.disabled = function disabled(setting) {
>> 440:   return !this.set(setting);
   441: };
   442: 
```

**Target definition** (lib/application.js#app.set):
```
   351: app.set = function set(setting, val) {
   352:   if (arguments.length === 1) {
   353:     // app.get(setting)
   354:     return this.settings[setting];
   355:   }
   356: 
   357:   debug('set "%s" to %o', setting, val);
   358: 
   359:   // set value
   360:   this.settings[setting] = val;
   361: 
```

**Verdict:** correct

---

### [resolved] #9: lib/utils.js -> lib/utils.js#createETagGenerator

**Call site** (lib/utils.js:40):
```
   38:  */
   39: 
>> 40: exports.etag = createETagGenerator({ weak: false })
   41: 
   42: /**
```

**Target definition** (lib/utils.js#createETagGenerator):
```
   249: function createETagGenerator (options) {
   250:   return function generateETag (body, encoding) {
   251:     var buf = !Buffer.isBuffer(body)
   252:       ? Buffer.from(body, encoding)
   253:       : body
   254: 
   255:     return etag(buf, options)
   256:   }
   257: }
```

**Verdict:** correct

---

### [resolved] #10: test/express.urlencoded.js -> test/express.urlencoded.js#expectKeyCount

**Call site** (test/express.urlencoded.js:341):
```
   339:           .set('Content-Type', 'application/x-www-form-urlencoded')
   340:           .send(createManyParams(10))
>> 341:           .expect(expectKeyCount(10))
   342:           .expect(200, done)
   343:       })
```

**Target definition** (test/express.urlencoded.js#expectKeyCount):
```
   824: function expectKeyCount (count) {
   825:   return function (res) {
   826:     assert.strictEqual(Object.keys(JSON.parse(res.text)).length, count)
   827:   }
   828: }
```

**Verdict:** correct

---

### [resolved] #11: test/utils.js -> lib/utils.js#normalizeType

**Call site** (test/utils.js:31):
```
   29: describe('utils.normalizeType acceptParams method', () => {
   30:   it('should handle a type with a malformed parameter and break the loop in acceptParams', () => {
>> 31:     const result = utils.normalizeType('text/plain;invalid');
   32:     assert.deepEqual(result,{
   33:       value: 'text/plain',
```

**Target definition** (lib/utils.js#normalizeType):
```
   61: exports.normalizeType = function(type){
   62:   return ~type.indexOf('/')
   63:     ? acceptParams(type)
   64:     : { value: (mime.lookup(type) || 'application/octet-stream'), params: {} }
   65: };
```

**Verdict:** correct

---


## probable (11 of 47 total)

### [probable] #12: test/support/tmpl.js#renderFile -> test/support/tmpl.js#renderFile.onReadFile

**Call site** (test/support/tmpl.js#renderFile:22):
```
   20:   }
   21: 
>> 22:   fs.readFile(fileName, 'utf8', onReadFile);
   23: };
   24: 
```

**Target definition** (test/support/tmpl.js#renderFile.onReadFile):
```
   6:   function onReadFile(err, str) {
   7:     if (err) {
   8:       callback(err);
   9:       return;
   10:     }
   11: 
   12:     try {
   13:       str = str.replace(variableRegExp, generateVariableLookup(options));
   14:     } catch (e) {
   15:       err = e;
   16:       err.name = 'RenderError'
```

**Verdict:** correct

---

### [probable] #13: examples/view-locals/index.js#count2 -> examples/view-locals/user.js#User.count

**Call site** (examples/view-locals/index.js#count2:87):
```
   85: 
   86: function count2(req, res, next) {
>> 87:   User.count(function(err, count){
   88:     if (err) return next(err);
   89:     res.locals.count = count;
```

**Target definition** (examples/view-locals/user.js#User.count):
```
   22: User.count = function(fn){
   23:   process.nextTick(function(){
   24:     fn(null, users.length);
   25:   });
   26: };
```

**Verdict:** correct

---

### [probable] #14: test/config.js -> test/config.js#fn

**Call site** (test/config.js:50):
```
   48:         var app = express()
   49:         var fn = function(){}
>> 50:         app.set('etag', fn)
   51:         assert.equal(app.get('etag fn'), fn)
   52:       })
```

**Target definition** (test/config.js#fn):
```
   49:         var fn = function(){}
```

**Verdict:** correct

---

### [probable] #15: examples/view-locals/index.js -> examples/view-locals/index.js#count2

**Call site** (examples/view-locals/index.js:102):
```
   100: }
   101: 
>> 102: app.get('/middleware-locals', count2, users2, function (req, res) {
   103:   // you can see now how we have much less
   104:   // to pass to res.render(). If we have
```

**Target definition** (examples/view-locals/index.js#count2):
```
   86: function count2(req, res, next) {
   87:   User.count(function(err, count){
   88:     if (err) return next(err);
   89:     res.locals.count = count;
   90:     next();
   91:   })
   92: }
```

**Verdict:** correct

---

### [probable] #16: examples/error/index.js -> examples/error/index.js#error

**Call site** (examples/error/index.js:47):
```
   45: // if it were above it would not receive errors
   46: // from app.get() etc
>> 47: app.use(error);
   48: 
   49: /* istanbul ignore next */
```

**Target definition** (examples/error/index.js#error):
```
   20: function error(err, req, res, next) {
   21:   // log it
   22:   if (!test) console.error(err.stack);
   23: 
   24:   // respond with 500 "Internal Server Error".
   25:   res.status(500);
   26:   res.send('Internal Server Error');
   27: }
```

**Verdict:** correct

---

### [probable] #17: examples/view-locals/index.js -> examples/view-locals/index.js#count

**Call site** (examples/view-locals/index.js:64):
```
   62: }
   63: 
>> 64: app.get('/middleware', count, users, function (req, res) {
   65:   res.render('index', {
   66:     title: 'Users',
```

**Target definition** (examples/view-locals/index.js#count):
```
   48: function count(req, res, next) {
   49:   User.count(function(err, count){
   50:     if (err) return next(err);
   51:     req.count = count;
   52:     next();
   53:   })
   54: }
```

**Verdict:** correct

---

### [probable] #18: lib/response.js#sendfile -> lib/response.js#sendfile.ondirectory

**Call site** (lib/response.js#sendfile:989):
```
   987:   }
   988: 
>> 989:   file.on('directory', ondirectory);
   990:   file.on('end', onend);
   991:   file.on('error', onerror);
```

**Target definition** (lib/response.js#sendfile.ondirectory):
```
   938:   function ondirectory() {
   939:     if (done) return;
   940:     done = true;
   941: 
   942:     var err = new Error('EISDIR, read');
   943:     err.code = 'EISDIR';
   944:     callback(err);
   945:   }
```

**Verdict:** correct

---

### [probable] #19: lib/express.js#createApplication -> lib/express.js#createApplication.app

**Call site** (lib/express.js#createApplication:41):
```
   39:   };
   40: 
>> 41:   mixin(app, EventEmitter.prototype, false);
   42:   mixin(app, proto, false);
   43: 
```

**Target definition** (lib/express.js#createApplication.app):
```
   37:   var app = function(req, res, next) {
   38:     app.handle(req, res, next);
   39:   };
```

**Verdict:** correct

---

### [probable] #20: lib/view.js#View -> lib/view.js#View.lookup

**Call site** (lib/view.js#View:94):
```
   92: 
   93:   // lookup path
>> 94:   this.path = this.lookup(fileName);
   95: }
   96: 
```

**Target definition** (lib/view.js#View.lookup):
```
   104: View.prototype.lookup = function lookup(name) {
   105:   var path;
   106:   var roots = [].concat(this.root);
   107: 
   108:   debug('lookup "%s"', name);
   109: 
   110:   for (var i = 0; i < roots.length && !path; i++) {
   111:     var root = roots[i];
   112: 
   113:     // resolve the path
   114:     var loc = resolve(root, name);
```

**Verdict:** correct

---

### [probable] #21: test/Router.js -> test/Router.js#no

**Call site** (test/Router.js:471):
```
   469:       })
   470: 
>> 471:       router.handle({ url: '/', method: 'GET' }, { end: cb }, no)
   472:       router.handle({ url: '/foo', method: 'GET' }, { end: cb }, no)
   473:       router.handle({ url: 'foo', method: 'GET' }, { end: cb }, no)
```

**Target definition** (test/Router.js#no):
```
   463:       function no() {
   464:         throw new Error('should not be called')
   465:       }
```

**Verdict:** correct

---

### [probable] #22: test/app.router.js -> test/app.router.js#handler1

**Call site** (test/app.router.js:30):
```
   28:     });
   29: 
>> 30:     app.get('/user/:id', handler1, router, handler2);
   31: 
   32:     request(app)
```

**Target definition** (test/app.router.js#handler1):
```
   16:     function handler1(req, res, next) {
   17:       res.setHeader('x-user-id', String(req.params.id));
   18:       next()
   19:     }
```

**Verdict:** correct

---


## ambiguous (11 of 262 total)

### [ambiguous] #23: examples/ejs/index.js -> lib/application.js#app.use

**Call site** (examples/ejs/index.js:31):
```
   29: // Path to our public directory
   30: 
>> 31: app.use(express.static(path.join(__dirname, 'public')));
   32: 
   33: // Without this you would need to
```

**Target definition** (lib/application.js#app.use):
```
   190: app.use = function use(fn) {
   191:   var offset = 0;
   192:   var path = '/';
   193: 
   194:   // default path to '/'
   195:   // disambiguate app.use([fn])
   196:   if (typeof fn !== 'function') {
   197:     var arg = fn;
   198: 
   199:     while (Array.isArray(arg) && arg.length !== 0) {
   200:       arg = arg[0];
```

**Verdict:** correct — app.use really is application.js#app.use

---

### [ambiguous] #24: test/res.sendFile.js -> lib/response.js#res.sendFile

**Call site** (test/res.sendFile.js:138):
```
   136:       app.use(function (req, res) {
   137:         res.contentType('application/x-bogus');
>> 138:         res.sendFile(path.resolve(fixtures, 'name.txt'));
   139:       });
   140: 
```

**Target definition** (lib/response.js#res.sendFile):
```
   375: res.sendFile = function sendFile(path, options, callback) {
   376:   var done = callback;
   377:   var req = this.req;
   378:   var res = this;
   379:   var next = req.next;
   380:   var opts = options || {};
   381: 
   382:   if (!path) {
   383:     throw new TypeError('path argument is required to res.sendFile');
   384:   }
   385: 
```

**Verdict:** correct — res.sendFile really is response.js#res.sendFile

---

### [ambiguous] #25: test/express.raw.js#createApp -> lib/response.js#res.status

**Call site** (test/express.raw.js#createApp:498):
```
   496: 
   497:   app.use(function (err, req, res, next) {
>> 498:     res.status(err.status || 500)
   499:     res.send(String(req.headers['x-error-property']
   500:       ? err[req.headers['x-error-property']]
```

**Target definition** (lib/response.js#res.status):
```
   65: res.status = function status(code) {
   66:   // Check if the status code is not an integer
   67:   if (!Number.isInteger(code)) {
   68:     throw new TypeError(`Invalid status code: ${JSON.stringify(code)}. Status code must be an integer.`);
   69:   }
   70:   // Check if the status code is outside of Node's valid range
   71:   if (code < 100 || code > 999) {
   72:     throw new RangeError(`Invalid status code: ${JSON.stringify(code)}. Status code must be greater than 99 and less than 1000.`);
   73:   }
   74: 
   75:   this.statusCode = code;
```

**Verdict:** correct — res.status really is response.js#res.status

---

### [ambiguous] #26: test/Route.js -> examples/view-locals/user.js#User.all

**Call site** (test/Route.js:28):
```
   26: 
   27:     for (var i = 0; i < 6000; i++) {
>> 28:       route.all(function (req, res, next) {
   29:         req.counter++
   30:         next()
```

**Target definition** (examples/view-locals/user.js#User.all):
```
   13: User.all = function(fn){
   14:   // process.nextTick makes sure this function API
   15:   // behaves in an asynchronous manner, like if it
   16:   // was a real DB query to read all users.
   17:   process.nextTick(function(){
   18:     fn(null, users);
   19:   });
   20: };
```

**Verdict:** wrong — route.all (a Router Route's method) matched an unrelated example file's User.all

---

### [ambiguous] #27: test/res.send.js -> lib/application.js#app.disable

**Call site** (test/res.send.js:496):
```
   494:         });
   495: 
>> 496:         app.disable('etag');
   497: 
   498:         request(app)
```

**Target definition** (lib/application.js#app.disable):
```
   463: app.disable = function disable(setting) {
   464:   return this.set(setting, false);
   465: };
```

**Verdict:** correct — app.disable really is application.js#app.disable

---

### [ambiguous] #28: test/res.format.js -> lib/response.js#res.status

**Call site** (test/res.format.js:31):
```
   29: app1.use(function(err, req, res, next){
   30:   if (!err.types) throw err;
>> 31:   res.status(err.status)
   32:   res.send('Supports: ' + err.types.join(', '))
   33: })
```

**Target definition** (lib/response.js#res.status):
```
   65: res.status = function status(code) {
   66:   // Check if the status code is not an integer
   67:   if (!Number.isInteger(code)) {
   68:     throw new TypeError(`Invalid status code: ${JSON.stringify(code)}. Status code must be an integer.`);
   69:   }
   70:   // Check if the status code is outside of Node's valid range
   71:   if (code < 100 || code > 999) {
   72:     throw new RangeError(`Invalid status code: ${JSON.stringify(code)}. Status code must be greater than 99 and less than 1000.`);
   73:   }
   74: 
   75:   this.statusCode = code;
```

**Verdict:** correct — res.status

---

### [ambiguous] #29: test/req.ips.js -> lib/application.js#app.use

**Call site** (test/req.ips.js:15):
```
   13:           app.enable('trust proxy');
   14: 
>> 15:           app.use(function(req, res, next){
   16:             res.send(req.ips);
   17:           });
```

**Target definition** (lib/application.js#app.use):
```
   190: app.use = function use(fn) {
   191:   var offset = 0;
   192:   var path = '/';
   193: 
   194:   // default path to '/'
   195:   // disambiguate app.use([fn])
   196:   if (typeof fn !== 'function') {
   197:     var arg = fn;
   198: 
   199:     while (Array.isArray(arg) && arg.length !== 0) {
   200:       arg = arg[0];
```

**Verdict:** correct — app.use

---

### [ambiguous] #30: test/express.raw.js#createApp -> lib/response.js#res.json

**Call site** (test/express.raw.js#createApp:506):
```
   504:   app.post('/', function (req, res) {
   505:     if (Buffer.isBuffer(req.body)) {
>> 506:       res.json({ buf: req.body.toString('hex') })
   507:     } else {
   508:       res.json(req.body)
```

**Target definition** (lib/response.js#res.json):
```
   236: res.json = function json(obj) {
   237:   // settings
   238:   var app = this.app;
   239:   var escape = app.get('json escape')
   240:   var replacer = app.get('json replacer');
   241:   var spaces = app.get('json spaces');
   242:   var body = stringify(obj, replacer, spaces, escape)
   243: 
   244:   // content-type
   245:   if (!this.get('Content-Type')) {
   246:     this.set('Content-Type', 'application/json');
```

**Verdict:** correct — res.json

---

### [ambiguous] #31: test/req.fresh.js -> lib/application.js#app.disable

**Call site** (test/req.fresh.js:41):
```
   39:       var app = express();
   40: 
>> 41:       app.disable('x-powered-by')
   42:       app.use(function(req, res){
   43:         res.send(req.fresh);
```

**Target definition** (lib/application.js#app.disable):
```
   463: app.disable = function disable(setting) {
   464:   return this.set(setting, false);
   465: };
```

**Verdict:** correct — app.disable

---

### [ambiguous] #32: test/res.jsonp.js -> lib/application.js#app.use

**Call site** (test/res.jsonp.js:13):
```
   11:       var app = express();
   12: 
>> 13:       app.use(function(req, res){
   14:         res.jsonp({ count: 1 });
   15:       });
```

**Target definition** (lib/application.js#app.use):
```
   190: app.use = function use(fn) {
   191:   var offset = 0;
   192:   var path = '/';
   193: 
   194:   // default path to '/'
   195:   // disambiguate app.use([fn])
   196:   if (typeof fn !== 'function') {
   197:     var arg = fn;
   198: 
   199:     while (Array.isArray(arg) && arg.length !== 0) {
   200:       arg = arg[0];
```

**Verdict:** correct — app.use

---

### [ambiguous] #33: examples/online/index.js -> lib/application.js#app.use

**Call site** (examples/online/index.js:30):
```
   28: // the UA string, you would use req.user.id etc
   29: 
>> 30: app.use(function(req, res, next){
   31:   // fire-and-forget
   32:   online.add(req.headers['user-agent']);
```

**Target definition** (lib/application.js#app.use):
```
   190: app.use = function use(fn) {
   191:   var offset = 0;
   192:   var path = '/';
   193: 
   194:   // default path to '/'
   195:   // disambiguate app.use([fn])
   196:   if (typeof fn !== 'function') {
   197:     var arg = fn;
   198: 
   199:     while (Array.isArray(arg) && arg.length !== 0) {
   200:       arg = arg[0];
```

**Verdict:** correct — app.use

---

