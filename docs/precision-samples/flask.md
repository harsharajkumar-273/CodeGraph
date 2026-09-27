# Precision sample — pallets__flask


## resolved (11 of 810 total)

### [resolved] #1: tests/test_basic.py#test_extended_flashing.test_filters2 -> src/flask/helpers.py#get_flashed_messages

**Call site** (tests/test_basic.py#test_extended_flashing.test_filters2:685):
```
   683:     @app.route("/test_filters_without_returning_categories/")
   684:     def test_filters2():
>> 685:         messages = flask.get_flashed_messages(category_filter=["message", "warning"])
   686:         assert len(messages) == 2
   687:         assert messages[0] == "Hello World"
```

**Target definition** (src/flask/helpers.py#get_flashed_messages):
```
   360: def get_flashed_messages(
   361:     with_categories: bool = False, category_filter: t.Iterable[str] = ()
   362: ) -> list[str] | list[tuple[str, str]]:
   363:     """Pulls all flashed messages from the session and returns them.
   364:     Further calls in the same request to the function will return
   365:     the same messages.  By default just the messages are returned,
   366:     but when `with_categories` is set to ``True``, the return value will
   367:     be a list of tuples in the form ``(category, message)`` instead.
   368: 
   369:     Filter the flashed messages to one or more categories by providing those
   370:     categories in `category_filter`.  This allows rendering categories in
```

**Verdict:** correct

---

### [resolved] #2: tests/test_cli.py#test_appgroup_app_context -> src/flask/cli.py#ScriptInfo

**Call site** (tests/test_cli.py#test_appgroup_app_context:336):
```
   334:         click.echo(current_app.name)
   335: 
>> 336:     obj = ScriptInfo(create_app=lambda: Flask("testappgroup"))
   337: 
   338:     result = runner.invoke(cli, ["test"], obj=obj)
```

**Target definition** (src/flask/cli.py#ScriptInfo):
```
   293: class ScriptInfo:
   294:     """Helper object to deal with Flask applications.  This is usually not
   295:     necessary to interface with as it's used internally in the dispatching
   296:     to click.  In future versions of Flask this object will most likely play
   297:     a bigger role.  Typically it's created automatically by the
   298:     :class:`FlaskGroup` but you can also manually create it and pass it
   299:     onwards as click object.
   300: 
   301:     .. versionchanged:: 3.1
   302:         Added the ``load_dotenv_defaults`` parameter and attribute.
   303:     """
```

**Verdict:** correct

---

### [resolved] #3: tests/test_testing.py#test_blueprint_with_subdomain -> src/flask/app.py#Flask

**Call site** (tests/test_testing.py#test_blueprint_with_subdomain:117):
```
   115: 
   116: def test_blueprint_with_subdomain():
>> 117:     app = flask.Flask(__name__, subdomain_matching=True)
   118:     app.config["SERVER_NAME"] = "example.com:1234"
   119:     app.config["APPLICATION_ROOT"] = "/foo"
```

**Target definition** (src/flask/app.py#Flask):
```
   110: class Flask(App):
   111:     """The flask object implements a WSGI application and acts as the central
   112:     object.  It is passed the name of the module or package of the
   113:     application.  Once it is created it will act as a central registry for
   114:     the view functions, the URL rules, template configuration and much more.
   115: 
   116:     The name of the package is used to resolve resources from inside the
   117:     package or the folder the module is contained in depending on if the
   118:     package parameter resolves to an actual python package (a folder with
   119:     an :file:`__init__.py` file inside) or a standard module (just a ``.py`` file).
   120: 
```

**Verdict:** correct

---

### [resolved] #4: tests/test_helpers.py#test_abort_with_app -> src/flask/helpers.py#abort

**Call site** (tests/test_helpers.py#test_abort_with_app:206):
```
   204: 
   205:     with app.app_context(), pytest.raises(My900Error):
>> 206:         flask.abort(900)
   207: 
   208: 
```

**Target definition** (src/flask/helpers.py#abort):
```
   281: def abort(code: int | BaseResponse, *args: t.Any, **kwargs: t.Any) -> t.NoReturn:
   282:     """Raise an :exc:`~werkzeug.exceptions.HTTPException` for the given
   283:     status code.
   284: 
   285:     If :data:`~flask.current_app` is available, it will call its
   286:     :attr:`~flask.Flask.aborter` object, otherwise it will use
   287:     :func:`werkzeug.exceptions.abort`.
   288: 
   289:     :param code: The status code for the exception, which must be
   290:         registered in ``app.aborter``.
   291:     :param args: Passed to the exception.
```

**Verdict:** correct

---

### [resolved] #5: tests/test_blueprints.py#test_endpoint_decorator -> src/flask/blueprints.py#Blueprint

**Call site** (tests/test_blueprints.py#test_endpoint_decorator:338):
```
   336:     app.url_map.add(Rule("/foo", endpoint="bar"))
   337: 
>> 338:     bp = flask.Blueprint("bp", __name__)
   339: 
   340:     @bp.endpoint("bar")
```

**Target definition** (src/flask/blueprints.py#Blueprint):
```
   18: class Blueprint(SansioBlueprint):
   19:     def __init__(
   20:         self,
   21:         name: str,
   22:         import_name: str,
   23:         static_folder: str | os.PathLike[str] | None = None,
   24:         static_url_path: str | None = None,
   25:         template_folder: str | os.PathLike[str] | None = None,
   26:         url_prefix: str | None = None,
   27:         subdomain: str | None = None,
   28:         url_defaults: dict[str, t.Any] | None = None,
```

**Verdict:** correct

---

### [resolved] #6: src/flask/cli.py#ScriptInfo.load_app -> src/flask/cli.py#NoAppException

**Call site** (src/flask/cli.py#ScriptInfo.load_app:359):
```
   357: 
   358:         if app is None:
>> 359:             raise NoAppException(
   360:                 "Could not locate a Flask application. Use the"
   361:                 " 'flask --app' option, 'FLASK_APP' environment"
```

**Target definition** (src/flask/cli.py#NoAppException):
```
   37: class NoAppException(click.UsageError):
   38:     """Raised if an application cannot be found or loaded."""
```

**Verdict:** correct

---

### [resolved] #7: src/flask/blueprints.py#Blueprint.__init__ -> src/flask/cli.py#AppGroup

**Call site** (src/flask/blueprints.py#Blueprint.__init__:49):
```
   47:         #: once the application has been discovered and blueprints have
   48:         #: been registered.
>> 49:         self.cli = AppGroup()
   50: 
   51:         # Set the name of the Click group in case someone wants to add
```

**Target definition** (src/flask/cli.py#AppGroup):
```
   405: class AppGroup(click.Group):
   406:     """This works similar to a regular click :class:`~click.Group` but it
   407:     changes the behavior of the :meth:`command` decorator so that it
   408:     automatically wraps the functions in :func:`with_appcontext`.
   409: 
   410:     Not to be confused with :class:`FlaskGroup`.
   411:     """
   412: 
   413:     def command(  # type: ignore[override]
   414:         self, *args: t.Any, **kwargs: t.Any
   415:     ) -> t.Callable[[t.Callable[..., t.Any]], click.Command]:
```

**Verdict:** correct

---

### [resolved] #8: src/flask/cli.py#find_app_by_string -> src/flask/cli.py#NoAppException

**Call site** (src/flask/cli.py#find_app_by_string:131):
```
   129:         expr = ast.parse(app_name.strip(), mode="eval").body
   130:     except SyntaxError:
>> 131:         raise NoAppException(
   132:             f"Failed to parse {app_name!r} as an attribute name or function call."
   133:         ) from None
```

**Target definition** (src/flask/cli.py#NoAppException):
```
   37: class NoAppException(click.UsageError):
   38:     """Raised if an application cannot be found or loaded."""
```

**Verdict:** correct

---

### [resolved] #9: src/flask/sessions.py#SecureCookieSessionInterface.save_session -> src/flask/sessions.py#SessionInterface.get_cookie_partitioned

**Call site** (src/flask/sessions.py#SecureCookieSessionInterface.save_session:344):
```
   342:         path = self.get_cookie_path(app)
   343:         secure = self.get_cookie_secure(app)
>> 344:         partitioned = self.get_cookie_partitioned(app)
   345:         samesite = self.get_cookie_samesite(app)
   346:         httponly = self.get_cookie_httponly(app)
```

**Target definition** (src/flask/sessions.py#SessionInterface.get_cookie_partitioned):
```
   215:     def get_cookie_partitioned(self, app: Flask) -> bool:
   216:         """Returns True if the cookie should be partitioned. By default, uses
   217:         the value of :data:`SESSION_COOKIE_PARTITIONED`.
   218: 
   219:         .. versionadded:: 3.1
   220:         """
   221:         return app.config["SESSION_COOKIE_PARTITIONED"]  # type: ignore[no-any-return]
```

**Verdict:** correct

---

### [resolved] #10: src/flask/app.py#Flask.do_teardown_appcontext -> src/flask/helpers.py#_CollectErrors

**Call site** (src/flask/app.py#Flask.do_teardown_appcontext:1473):
```
   1471:         .. versionadded:: 0.9
   1472:         """
>> 1473:         collect_errors = _CollectErrors()
   1474: 
   1475:         for func in reversed(self.teardown_appcontext_funcs):
```

**Target definition** (src/flask/helpers.py#_CollectErrors):
```
   654: class _CollectErrors:
   655:     """A context manager that records and silences an error raised within it.
   656:     Used to run all teardown functions, then raise any errors afterward.
   657:     """
   658: 
   659:     def __init__(self) -> None:
   660:         self.errors: list[BaseException] = []
   661: 
   662:     def __enter__(self) -> None:
   663:         pass
   664: 
```

**Verdict:** correct

---

### [resolved] #11: src/flask/cli.py#_env_file_callback -> src/flask/cli.py#load_dotenv

**Call site** (src/flask/cli.py#_env_file_callback:510):
```
   508:     # Load if a value was passed, or we want to load default files, or both.
   509:     if value is not None or ctx.obj.load_dotenv_defaults:
>> 510:         load_dotenv(value, load_defaults=ctx.obj.load_dotenv_defaults)
   511: 
   512:     return value
```

**Target definition** (src/flask/cli.py#load_dotenv):
```
   698: def load_dotenv(
   699:     path: str | os.PathLike[str] | None = None, load_defaults: bool = True
   700: ) -> bool:
   701:     """Load "dotenv" files to set environment variables. A given path takes
   702:     precedence over ``.env``, which takes precedence over ``.flaskenv``. After
   703:     loading and combining these files, values are only set if the key is not
   704:     already set in ``os.environ``.
   705: 
   706:     This is a no-op if `python-dotenv`_ is not installed.
   707: 
   708:     .. _python-dotenv: https://github.com/theskumar/python-dotenv#readme
```

**Verdict:** correct

---


## probable (11 of 265 total)

### [probable] #12: tests/test_testing.py#test_environ_defaults_from_config -> src/flask/app.py#Flask.test_request_context

**Call site** (tests/test_testing.py#test_environ_defaults_from_config:23):
```
   21:         return flask.request.url
   22: 
>> 23:     ctx = app.test_request_context()
   24:     assert ctx.request.url == "http://example.com:1234/foo/"
   25: 
```

**Target definition** (src/flask/app.py#Flask.test_request_context):
```
   1520:     def test_request_context(self, *args: t.Any, **kwargs: t.Any) -> AppContext:
   1521:         """Create an :class:`.AppContext` with request information created from
   1522:         the given arguments. When the context is pushed, :data:`.request`,
   1523:         :data:`.session`, :data:`g`, and :data:`.current_app` become available.
   1524: 
   1525:         This is useful during testing to run a function that uses request data
   1526:         without dispatching a full request. Use this as a ``with`` block to push
   1527:         a context.
   1528: 
   1529:         .. code-block:: python
   1530: 
```

**Verdict:** correct

---

### [probable] #13: tests/conftest.py#app_ctx -> src/flask/app.py#Flask.app_context

**Call site** (tests/conftest.py#app_ctx:39):
```
   37: @pytest.fixture
   38: def app_ctx(app):
>> 39:     with app.app_context() as ctx:
   40:         yield ctx
   41: 
```

**Target definition** (src/flask/app.py#Flask.app_context):
```
   1484:     def app_context(self) -> AppContext:
   1485:         """Create an :class:`.AppContext`. When the context is pushed,
   1486:         :data:`.current_app` and :data:`.g` become available.
   1487: 
   1488:         A context is automatically pushed when handling each request, and when
   1489:         running any ``flask`` CLI command. Use this as a ``with`` block to
   1490:         manually push a context outside of those situations, such as during
   1491:         setup or testing.
   1492: 
   1493:         .. code-block:: python
   1494: 
```

**Verdict:** correct

---

### [probable] #14: src/flask/sansio/blueprints.py#Blueprint.app_errorhandler.decorator -> src/flask/sansio/blueprints.py#Blueprint.app_errorhandler.decorator.from_blueprint

**Call site** (src/flask/sansio/blueprints.py#Blueprint.app_errorhandler.decorator:667):
```
   665:                 state.app.errorhandler(code)(f)
   666: 
>> 667:             self.record_once(from_blueprint)
   668:             return f
   669: 
```

**Target definition** (src/flask/sansio/blueprints.py#Blueprint.app_errorhandler.decorator.from_blueprint):
```
   664:             def from_blueprint(state: BlueprintSetupState) -> None:
   665:                 state.app.errorhandler(code)(f)
```

**Verdict:** correct

---

### [probable] #15: tests/test_appctx.py#test_app_tearing_down_with_handled_exception_by_app_handler -> src/flask/app.py#Flask.app_context

**Call site** (tests/test_appctx.py#test_app_tearing_down_with_handled_exception_by_app_handler:109):
```
   107:         return flask.jsonify(str(f))
   108: 
>> 109:     with app.app_context():
   110:         client.get("/")
   111: 
```

**Target definition** (src/flask/app.py#Flask.app_context):
```
   1484:     def app_context(self) -> AppContext:
   1485:         """Create an :class:`.AppContext`. When the context is pushed,
   1486:         :data:`.current_app` and :data:`.g` become available.
   1487: 
   1488:         A context is automatically pushed when handling each request, and when
   1489:         running any ``flask`` CLI command. Use this as a ``with`` block to
   1490:         manually push a context outside of those situations, such as during
   1491:         setup or testing.
   1492: 
   1493:         .. code-block:: python
   1494: 
```

**Verdict:** correct

---

### [probable] #16: tests/test_config.py#test_from_prefixed_env_custom_prefix -> src/flask/config.py#Config.from_prefixed_env

**Call site** (tests/test_config.py#test_from_prefixed_env_custom_prefix:74):
```
   72: 
   73:     app = flask.Flask(__name__)
>> 74:     app.config.from_prefixed_env("NOT_FLASK")
   75: 
   76:     assert app.config["A"] == "b"
```

**Target definition** (src/flask/config.py#Config.from_prefixed_env):
```
   126:     def from_prefixed_env(
   127:         self, prefix: str = "FLASK", *, loads: t.Callable[[str], t.Any] = json.loads
   128:     ) -> bool:
   129:         """Load any environment variables that start with ``FLASK_``,
   130:         dropping the prefix from the env key for the config key. Values
   131:         are passed through a loading function to attempt to convert them
   132:         to more specific types than strings.
   133: 
   134:         Keys are loaded in :func:`sorted` order.
   135: 
   136:         The default loading function attempts to parse values as any
```

**Verdict:** correct

---

### [probable] #17: tests/test_regression.py#test_aborting -> tests/test_regression.py#test_aborting.Foo

**Call site** (tests/test_regression.py#test_aborting:8):
```
   6:         whatever = 42
   7: 
>> 8:     @app.errorhandler(Foo)
   9:     def handle_foo(e):
   10:         return str(e.whatever)
```

**Target definition** (tests/test_regression.py#test_aborting.Foo):
```
   5:     class Foo(Exception):
   6:         whatever = 42
```

**Verdict:** correct

---

### [probable] #18: tests/test_basic.py#test_http_error_subclass_handling.handle_forbidden_subclass -> tests/test_basic.py#test_http_error_subclass_handling.ForbiddenSubclass

**Call site** (tests/test_basic.py#test_http_error_subclass_handling.handle_forbidden_subclass:995):
```
   993:     @app.errorhandler(ForbiddenSubclass)
   994:     def handle_forbidden_subclass(e):
>> 995:         assert isinstance(e, ForbiddenSubclass)
   996:         return "banana"
   997: 
```

**Target definition** (tests/test_basic.py#test_http_error_subclass_handling.ForbiddenSubclass):
```
   990:     class ForbiddenSubclass(Forbidden):
   991:         pass
```

**Verdict:** correct

---

### [probable] #19: src/flask/ctx.py#AppContext._get_session -> src/flask/sessions.py#SessionInterface.make_null_session

**Call site** (src/flask/ctx.py#AppContext._get_session:391):
```
   389: 
   390:             if self._session is None:
>> 391:                 self._session = si.make_null_session(self.app)
   392: 
   393:         return self._session
```

**Target definition** (src/flask/sessions.py#SessionInterface.make_null_session):
```
   150:     def make_null_session(self, app: Flask) -> NullSession:
   151:         """Creates a null session which acts as a replacement object if the
   152:         real session support could not be loaded due to a configuration
   153:         error.  This mainly aids the user experience because the job of the
   154:         null session is to still support lookup without complaining but
   155:         modifications are answered with a helpful error message of what
   156:         failed.
   157: 
   158:         This creates an instance of :attr:`null_session_class` by default.
   159:         """
   160:         return self.null_session_class()
```

**Verdict:** correct

---

### [probable] #20: tests/test_basic.py#test_run_server_port -> tests/test_basic.py#test_run_server_port.run_simple_mock

**Call site** (tests/test_basic.py#test_run_server_port:1900):
```
   1898:         rv["result"] = f"running on {hostname}:{port} ..."
   1899: 
>> 1900:     monkeypatch.setattr(werkzeug.serving, "run_simple", run_simple_mock)
   1901:     hostname, port = "localhost", 8000
   1902:     app.run(hostname, port, debug=True)
```

**Target definition** (tests/test_basic.py#test_run_server_port.run_simple_mock):
```
   1897:     def run_simple_mock(hostname, port, application, *args, **kwargs):
   1898:         rv["result"] = f"running on {hostname}:{port} ..."
```

**Verdict:** correct

---

### [probable] #21: src/flask/cli.py#with_appcontext.decorator -> src/flask/cli.py#ScriptInfo.load_app

**Call site** (src/flask/cli.py#with_appcontext.decorator:397):
```
   395:     def decorator(ctx: click.Context, /, *args: t.Any, **kwargs: t.Any) -> t.Any:
   396:         if not current_app:
>> 397:             app = ctx.ensure_object(ScriptInfo).load_app()
   398:             ctx.with_resource(app.app_context())
   399: 
```

**Target definition** (src/flask/cli.py#ScriptInfo.load_app):
```
   333:     def load_app(self) -> Flask:
   334:         """Loads the Flask app (if not yet loaded) and returns it.  Calling
   335:         this multiple times will just result in the already loaded app to
   336:         be returned.
   337:         """
   338:         if self._loaded_app is not None:
   339:             return self._loaded_app
   340:         app: Flask | None = None
   341:         if self.create_app is not None:
   342:             app = self.create_app()
   343:         else:
```

**Verdict:** correct

---

### [probable] #22: src/flask/sessions.py#SecureCookieSession.__init__ -> src/flask/sessions.py#SecureCookieSession.__init__.on_update

**Call site** (src/flask/sessions.py#SecureCookieSession.__init__:80):
```
   78:             self.modified = True
   79: 
>> 80:         super().__init__(initial, on_update)
   81: 
   82: 
```

**Target definition** (src/flask/sessions.py#SecureCookieSession.__init__.on_update):
```
   77:         def on_update(self: te.Self) -> None:
   78:             self.modified = True
```

**Verdict:** correct

---


## ambiguous (11 of 471 total)

### [ambiguous] #23: src/flask/testing.py#FlaskClient.open -> src/flask/ctx.py#AppContext.from_environ

**Call site** (src/flask/testing.py#FlaskClient.open:219):
```
   217:                 request = builder.get_request()
   218:             elif isinstance(args[0], dict):
>> 219:                 request = EnvironBuilder.from_environ(
   220:                     args[0], app=self.application, environ_base=self._copy_environ({})
   221:                 ).get_request()
```

**Target definition** (src/flask/ctx.py#AppContext.from_environ):
```
   340:     def from_environ(cls, app: Flask, environ: WSGIEnvironment, /) -> te.Self:
   341:         """Create an app context with request data from the given WSGI environ.
   342: 
   343:         :param app: The application this context represents.
   344:         :param environ: The request data this context represents.
   345:         """
   346:         request = app.request_class(environ)
   347:         request.json_module = app.json
   348:         return cls(app, request=request)
```

**Verdict:** wrong — EnvironBuilder.from_environ (a werkzeug class) matched Flask's own unrelated AppContext.from_environ by bare name

---

### [ambiguous] #24: src/flask/sansio/app.py#App.add_url_rule -> src/flask/ctx.py#AppContext.pop

**Call site** (src/flask/sansio/app.py#App.add_url_rule:616):
```
   614:             endpoint = _endpoint_from_view_func(view_func)  # type: ignore
   615:         options["endpoint"] = endpoint
>> 616:         methods = options.pop("methods", None)
   617: 
   618:         # if the methods are not given and the view_func object knows its
```

**Target definition** (src/flask/ctx.py#AppContext.pop):
```
   446:     def pop(self, exc: BaseException | None = None) -> None:
   447:         """Pop this context so that it is no longer the active context. Then
   448:         call teardown functions and signals.
   449: 
   450:         Typically, this is not used directly. Instead, use a ``with`` block
   451:         to manage the context.
   452: 
   453:         This context must currently be the active context, otherwise a
   454:         :exc:`RuntimeError` is raised. In some situations, such as streaming or
   455:         testing, the context may have been pushed multiple times. It will only
   456:         trigger cleanup once it has been popped as many times as it was pushed.
```

**Verdict:** wrong — options.pop (plain dict.pop) matched AppContext.pop

---

### [ambiguous] #25: tests/test_basic.py#test_trapping_of_all_http_exceptions -> src/flask/ctx.py#_AppCtxGlobals.get

**Call site** (tests/test_basic.py#test_trapping_of_all_http_exceptions:1097):
```
   1095: 
   1096:     with pytest.raises(NotFound):
>> 1097:         client.get("/fail")
   1098: 
   1099: 
```

**Target definition** (src/flask/ctx.py#_AppCtxGlobals.get):
```
   68:     def get(self, name: str, default: t.Any | None = None) -> t.Any:
   69:         """Get an attribute by name, or a default value. Like
   70:         :meth:`dict.get`.
   71: 
   72:         :param name: Name of attribute to get.
   73:         :param default: Value to return if the attribute is not present.
   74: 
   75:         .. versionadded:: 0.10
   76:         """
   77:         return self.__dict__.get(name, default)
```

**Verdict:** wrong — client.get (test client HTTP GET) matched _AppCtxGlobals.get

---

### [ambiguous] #26: tests/test_async.py#test_async_route -> src/flask/ctx.py#_AppCtxGlobals.get

**Call site** (tests/test_async.py#test_async_route:84):
```
   82: def test_async_route(path, async_app):
   83:     test_client = async_app.test_client()
>> 84:     response = test_client.get(path)
   85:     assert b"GET" in response.get_data()
   86:     response = test_client.post(path)
```

**Target definition** (src/flask/ctx.py#_AppCtxGlobals.get):
```
   68:     def get(self, name: str, default: t.Any | None = None) -> t.Any:
   69:         """Get an attribute by name, or a default value. Like
   70:         :meth:`dict.get`.
   71: 
   72:         :param name: Name of attribute to get.
   73:         :param default: Value to return if the attribute is not present.
   74: 
   75:         .. versionadded:: 0.10
   76:         """
   77:         return self.__dict__.get(name, default)
```

**Verdict:** wrong — test_client.get matched _AppCtxGlobals.get

---

### [ambiguous] #27: tests/test_templating.py#test_context_processing -> src/flask/ctx.py#_AppCtxGlobals.get

**Call site** (tests/test_templating.py#test_context_processing:20):
```
   18:         return flask.render_template("context_template.html", value=23)
   19: 
>> 20:     rv = client.get("/")
   21:     assert rv.data == b"<p>23|42"
   22: 
```

**Target definition** (src/flask/ctx.py#_AppCtxGlobals.get):
```
   68:     def get(self, name: str, default: t.Any | None = None) -> t.Any:
   69:         """Get an attribute by name, or a default value. Like
   70:         :meth:`dict.get`.
   71: 
   72:         :param name: Name of attribute to get.
   73:         :param default: Value to return if the attribute is not present.
   74: 
   75:         .. versionadded:: 0.10
   76:         """
   77:         return self.__dict__.get(name, default)
```

**Verdict:** wrong — client.get matched _AppCtxGlobals.get

---

### [ambiguous] #28: tests/test_testing.py#test_reuse_client -> src/flask/ctx.py#_AppCtxGlobals.get

**Call site** (tests/test_testing.py#test_reuse_client:247):
```
   245: 
   246:     with c:
>> 247:         assert client.get("/").status_code == 404
   248: 
   249:     with c:
```

**Target definition** (src/flask/ctx.py#_AppCtxGlobals.get):
```
   68:     def get(self, name: str, default: t.Any | None = None) -> t.Any:
   69:         """Get an attribute by name, or a default value. Like
   70:         :meth:`dict.get`.
   71: 
   72:         :param name: Name of attribute to get.
   73:         :param default: Value to return if the attribute is not present.
   74: 
   75:         .. versionadded:: 0.10
   76:         """
   77:         return self.__dict__.get(name, default)
```

**Verdict:** wrong — client.get matched _AppCtxGlobals.get

---

### [ambiguous] #29: src/flask/json/tag.py#PassList.to_json -> src/flask/json/tag.py#TaggedJSONSerializer.tag

**Call site** (src/flask/json/tag.py#PassList.to_json:154):
```
   152: 
   153:     def to_json(self, value: t.Any) -> t.Any:
>> 154:         return [self.serializer.tag(item) for item in value]
   155: 
   156:     tag = to_json
```

**Target definition** (src/flask/json/tag.py#TaggedJSONSerializer.tag):
```
   289:     def tag(self, value: t.Any) -> t.Any:
   290:         """Convert a value to a tagged representation if necessary."""
   291:         for tag in self.order:
   292:             if tag.check(value):
   293:                 return tag.tag(value)
   294: 
   295:         return value
```

**Verdict:** correct — self.serializer really is a TaggedJSONSerializer; .tag resolves right

---

### [ambiguous] #30: examples/tutorial/flaskr/db.py#init_app -> src/flask/sansio/app.py#App.teardown_appcontext

**Call site** (examples/tutorial/flaskr/db.py#init_app:55):
```
   53:     the application factory.
   54:     """
>> 55:     app.teardown_appcontext(close_db)
   56:     app.cli.add_command(init_db_command)
   57: 
```

**Target definition** (src/flask/sansio/app.py#App.teardown_appcontext):
```
   827:     def teardown_appcontext(self, f: T_teardown) -> T_teardown:
   828:         """Registers a function to be called when the app context is popped. The
   829:         context is popped at the end of a request, CLI command, or manual ``with``
   830:         block.
   831: 
   832:         .. code-block:: python
   833: 
   834:             with app.app_context():
   835:                 ...
   836: 
   837:         When the ``with`` block exits (or ``ctx.pop()`` is called), the
```

**Verdict:** correct — app.teardown_appcontext really is App.teardown_appcontext

---

### [ambiguous] #31: tests/test_blueprints.py#test_add_template_test_with_template -> src/flask/ctx.py#_AppCtxGlobals.get

**Call site** (tests/test_blueprints.py#test_add_template_test_with_template:632):
```
   630:         return flask.render_template("template_test.html", value=False)
   631: 
>> 632:     rv = client.get("/")
   633:     assert b"Success!" in rv.data
   634: 
```

**Target definition** (src/flask/ctx.py#_AppCtxGlobals.get):
```
   68:     def get(self, name: str, default: t.Any | None = None) -> t.Any:
   69:         """Get an attribute by name, or a default value. Like
   70:         :meth:`dict.get`.
   71: 
   72:         :param name: Name of attribute to get.
   73:         :param default: Value to return if the attribute is not present.
   74: 
   75:         .. versionadded:: 0.10
   76:         """
   77:         return self.__dict__.get(name, default)
```

**Verdict:** wrong — client.get matched _AppCtxGlobals.get (recurring pattern: 5 of 11 ambiguous misses)

---

### [ambiguous] #32: examples/tutorial/tests/test_blog.py#test_create -> src/flask/app.py#Flask.app_context

**Call site** (examples/tutorial/tests/test_blog.py#test_create:51):
```
   49:     client.post("/create", data={"title": "created", "body": ""})
   50: 
>> 51:     with app.app_context():
   52:         db = get_db()
   53:         count = db.execute("SELECT COUNT(id) FROM post").fetchone()[0]
```

**Target definition** (src/flask/app.py#Flask.app_context):
```
   1484:     def app_context(self) -> AppContext:
   1485:         """Create an :class:`.AppContext`. When the context is pushed,
   1486:         :data:`.current_app` and :data:`.g` become available.
   1487: 
   1488:         A context is automatically pushed when handling each request, and when
   1489:         running any ``flask`` CLI command. Use this as a ``with`` block to
   1490:         manually push a context outside of those situations, such as during
   1491:         setup or testing.
   1492: 
   1493:         .. code-block:: python
   1494: 
```

**Verdict:** correct — app.app_context really is Flask.app_context

---

### [ambiguous] #33: tests/test_basic.py#test_werkzeug_passthrough_errors -> src/flask/app.py#Flask.run

**Call site** (tests/test_basic.py#test_werkzeug_passthrough_errors:1642):
```
   1640:     monkeypatch.setattr(werkzeug.serving, "run_simple", run_simple_mock)
   1641:     app.config["PROPAGATE_EXCEPTIONS"] = propagate_exceptions
>> 1642:     app.run(debug=debug, use_debugger=use_debugger, use_reloader=use_reloader)
   1643: 
   1644: 
```

**Target definition** (src/flask/app.py#Flask.run):
```
   633:     def run(
   634:         self,
   635:         host: str | None = None,
   636:         port: int | None = None,
   637:         debug: bool | None = None,
   638:         load_dotenv: bool = True,
   639:         **options: t.Any,
   640:     ) -> None:
   641:         """Runs the application on a local development server.
   642: 
   643:         Do not use ``run()`` in a production setting. It is not intended to
```

**Verdict:** correct — app.run really is Flask.run

---

