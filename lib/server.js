// Copyright 2011 Mark Cavage, Inc.  All rights reserved.

var assert = require('assert');
var EventEmitter = require('events').EventEmitter;
var http = require('http');
var https = require('https');
var url = require('url');
var util = require('util');

var async = require('async');

var errors = require('./errors');
var Request = require('./request');
var Response = require('./response');
var Route = require('./route');



///--- Globals

var BadMethodError = errors.BadMethodError;
var InvalidVersionError = errors.InvalidVersionError;
var ResourceNotFoundError = errors.ResourceNotFoundError;



///--- Helpers

function argsToChain() {
  assert.ok(arguments.length);

  var args = arguments[0];
  if (args.length < 0)
    throw new TypeError('handler (Function) required');

  var chain = [];

  function process(handlers) {
    handlers.forEach(function(h) {
      if (Array.isArray(h))
        return process(h);
      if (!typeof(h) === 'function')
        throw new TypeError('handlers must be Functions');

      return chain.push(h);
    });
  }
  process(Array.prototype.slice.call(args, 0));

  return chain;
}


function logRequest(req) {
  assert.ok(req);

  if (req.log.isTraceEnabled())
    req.log.trace('New Request:\n\n%s', req.toString());
}


function default404Handler(req, res) {
  res.send(new ResourceNotFoundError(req.url + ' not found'));
}


function default405Handler(req, res, methods) {
  res.header('Allow', methods.join(', '));
  if (req.method === 'OPTIONS') {
    res.send(200);
  } else {
    var msg = req.url + ' does not support ' + req.method;
    res.send(new BadMethodError(msg));
  }
}


function defaultBadVersionHandler(req, res, versions) {
  var msg = req.method + ' ' + req.url + ' supports versions: ' +
    versions.join(', ');

  res.send(new InvalidVersionError(msg));
}


function toPort(x) {
  x = parseInt(x, 10);
  return (x  >= 0 ? x : false);
}


function isPipeName(s) {
  return (typeof(s) === 'string' && toPort(s) === false);
}



///--- API

/**
 * Constructor. Creates a REST API Server.
 *
 * - options {Object} construction arguments. (log4js required).
 */
function Server(options) {
  if (typeof(options) !== 'object')
    throw new TypeError('options (Object) required');
  if (typeof(options.dtrace) !== 'object')
    throw new TypeError('options.dtrace (Object) required');
  if (typeof(options.log4js) !== 'object')
    throw new TypeError('options.log4js (Object) required');

  EventEmitter.call(this);

  this.chain = [];
  this.formatters = options.formatters || {};
  this.log4js = options.log4js;
  this.log = this.log4js.getLogger('Server');
  this.name = options.name || 'restify';
  this.preChain = [];
  this.routes = [];
  this.version = options.version || false;
  this.rangeVersioning = options.rangeVersioning || false;

  var secure = false;
  if (options.certificate && options.key) {
    secure = true;
    this.server = https.createServer({
      cert: options.certificate,
      key: options.key
    });
  } else {
    this.server = http.createServer();
  }

  var self = this;
  this.server.on('error', function(err) {
    self.emit('error', err);
  });

  this.server.on('clientError', function(err) {
    self.emit('clientError', err);
  });

  this.server.on('close', function() {
    self.emit('close');
  });

  this.server.on('connection', function(socket) {
    self.emit('connection', socket);
  });

  this.server.on('upgrade', function(request, socket, headPacket) {
    return self.emit('upgrade', request, socket, headPacket);
  });

  this.server.on('request', function(req, res) {
    return self._request(req, res);
  });

  this.server.on('checkContinue', function(req, res) {
    return self._request(req, res, true);
  });

  this.__defineGetter__('acceptable', function() {
    var accept = Object.keys(self.formatters) || [];
    Response.ACCEPTABLE.forEach(function(a) {
      if (accept.indexOf(a) === -1)
        accept.push(a);
    });

    return accept;
  });

  this.__defineGetter__('name', function() {
    return options.name || 'restify';
  });

  this.__defineGetter__('dtrace', function() {
    return options.dtrace;
  });

  this.__defineGetter__('url', function() {
    if (self.socketPath)
      return 'http://' + self.socketPath;

    var str = secure ? 'https://' : 'http://';
    str += self.address().address;
    str += ':';
    str += self.address().port;
    return str;
  });
}
util.inherits(Server, EventEmitter);
module.exports = Server;


Server.prototype.address = function address() {
  return this.server.address();
};

/**
 * Gets the server up and listening.
 *
 * You can call like:
 *  server.listen(80)
 *  server.listen(80, '127.0.0.1')
 *  server.listen('/tmp/server.sock')
 *
 * And pass in a callback to any of those forms.  Also, by default, invoking
 * this method will trigger DTrace probes to be enabled; to not do that, pass
 * in 'false' as the second to last parameter.
 *
 * @param {Function} callback optionally get notified when listening.
 * @throws {TypeError} on bad input.
 */
Server.prototype.listen = function listen() {
  var callback = false;
  var dtrace = true;
  var self = this;

  function listenCallback() {
    if (dtrace)
      self.dtrace.enable();

    return callback ? callback.call(self) : false;
  }

  if (!arguments.length)
    return this.server.listen(listenCallback);

  callback = arguments[arguments.length - 1];
  if (typeof(callback) !== 'function')
    callback = false;

  if (arguments.length >= 2 && arguments[arguments.length - 2] === false)
    dtrace = false;

  switch (typeof(arguments[0])) {
  case 'function':
    return this.server.listen(listenCallback);

  case 'string':
    if (isPipeName(arguments[0]))
      return this.server.listen(arguments[0], listenCallback);

    throw new TypeError(arguments[0] + ' is not a named pipe');

  case 'number':
    var host = arguments[1];
    return this.server.listen(arguments[0],
                              typeof(host) === 'string' ? host : '0.0.0.0',
                              listenCallback);

  default:
    throw new TypeError('port (Number) required');
  }
};


/**
 * Shuts down this server, and invokes callback (optionally) when done.
 *
 * @param {Function} callback optional callback to invoke when done.
 */
Server.prototype.close = function close(callback) {
  if (callback) {
    if (typeof(callback) !== 'function')
      throw new TypeError('callback must be a function');

    this.server.once('close', function() {
      return callback();
    });
  }

  return this.server.close();
};


// Register all the routing methods
['del', 'get', 'head', 'post', 'put'].forEach(function(method) {

  /**
   * Mounts a chain on the given path against this HTTP verb
   *
   * @param {Object} options the URL to handle, at minimum.
   * @return {Route} the newly created route.
   */
  Server.prototype[method] = function(options) {
    if (arguments.length < 2)
      throw new Error('At least one handler (Function) required');

    if (typeof(options) !== 'object' && typeof(options) !== 'string')
      throw new TypeError('path (String) required');

    var args = Array.prototype.slice.call(arguments, 1);

    if (method === 'del')
      method = 'DELETE';

    return this._addRoute(method.toUpperCase(), options, args);
  };
});


/**
 * Removes a route from the server.
 *
 * You can either pass in the route name or the route object as `name`.
 *
 * @param {String} name the route name.
 * @return {Boolean} true if route was removed, false if not.
 * @throws {TypeError} on bad input.
 */
Server.prototype.rm = function rm(name) {
  if (typeof(name) !== 'string' && !(name instanceof Route))
    throw new TypeError('name (String) required');

  for (var i = 0; i < this.routes.length; i++) {
    if (this.routes[i].name === name || this.routes[i] === name) {
      this.routes.splice(i, 1);
      return true;
    }
  }

  return false;
};


/**
 * Installs a list of handlers to run _before_ the "normal" handlers of all
 * routes.
 *
 * You can pass in any combination of functions or array of functions.
 *
 * @throws {TypeError} on input error.
 */
Server.prototype.use = function use() {
  var chain = argsToChain(arguments);

  if (chain.length) {
    var self = this;
    chain.forEach(function(h) {
      self.chain.push(h);
    });

    this.routes.forEach(function(r) {
      r.use(chain);
    });
  }

  return this;
};


/**
 * Gives you hooks to run _before_ any routes are located.  This gives you
 * a chance to intercept the request and change headers, etc., that routing
 * depends on.  Note that req.params will _not_ be set yet.
 */
Server.prototype.pre = function pre() {
  var self = this;

  return argsToChain(arguments).forEach(function(h) {
    self.preChain.push(h);
  });
};



///--- Private methods

Server.prototype._addRoute = function _addRoute(method, options, handlers) {
  var self = this;

  var chain = this.chain.slice(0);
  argsToChain(handlers).forEach(function(h) {
    chain.push(h);
  });

  if (typeof(options) !== 'object')
    options = { url: options };

  var route = new Route({
    log4js: self.log4js,
    method: method,
    url: options.path || options.url,
    handlers: chain,
    name: options.name,
    version: options.version || self.version,
    rangeVersioning: options.rangeVersioning || self.rangeVersioning,
    dtrace: self.dtrace
  });
  route.on('error', function(err) {
    self.emit('error', err);
  });
  route.on('done', function(req, res) {
    self.emit('after', req, res, route);
  });

  this.routes.forEach(function(r) {
    if (r.matchesUrl({ url: options.url })) {
      if (r.methods.indexOf(method) === -1)
        r.methods.push(method);
    }
  });

  this.routes.push(route);
  return route;
};


Server.prototype._request = function _request(req, res, expectContinue) {
  var self = this;

  var request = new Request({
    log4js: self.log4js,
    request: req
  });
  var response = new Response({
    log4js: self.log4js,
    request: request,
    response: res,
    formatters: self.formatters,
    expectContinue: expectContinue
  });

  logRequest(request);

  var before = [];
  this.preChain.forEach(function(h) {
    before.push(function(callback) {
      return h(request, response, callback);
    });
  });
  // Ensure there's always one
  before.push(function(callback) {
    return callback();
  });

  return async.series(before, function(err) {
    if (err)
      return response.send(err);

    var route = self._findRoute(request, response);
    if (!route)
      return false;

    response.serverName = self.name;
    response.defaultHeaders();
    return route.run(request, response);
  });
};


Server.prototype._findRoute = function _findRoute(req, res) {
  assert.ok(req);
  assert.ok(res);

  var params;
  var route;
  var methods = [];
  var versions = [];

  for (var i = 0; i < this.routes.length; i++) {
    var r = this.routes[i];

    if ((params = r.matchesUrl(req))) {
      if (r.matchesMethod(req)) {
        if (r.matchesVersion(req)) {
          route = r;
          break;
        } else {
          if (r.version && versions.indexOf(r.version) === -1)
            versions.push(r.version);
        }
      } else {
        if (methods.indexOf(r.method) === -1)
          methods.push(r.method);
      }
    }
  }

  if (route) {
    req.params = params || {};
    res.methods = route.methods;
    res.version = route.version;
  } else {
    res.methods = methods;
    res.versions = versions;

    if (versions.length) {
      if (!this.listeners('VersionNotAllowed').length)
        this.once('VersionNotAllowed', defaultBadVersionHandler);

      this.emit('VersionNotAllowed', req, res, versions);
    } else if (methods.length) {
      if (!this.listeners('MethodNotAllowed').length)
        this.once('MethodNotAllowed', default405Handler);

      this.emit('MethodNotAllowed', req, res, methods);
    } else {
      if (!this.listeners('NotFound').length)
        this.once('NotFound', default404Handler);

      this.emit('NotFound', req, res);
    }
  }

  return route || false;
};
