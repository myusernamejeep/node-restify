// Copyright 2011 Mark Cavage, Inc.  All rights reserved.

var d = require('dtrace-provider');
var mime = require('mime');

var clients = require('./clients');
var errors = require('./errors');
var log4js = require('./log4js_stub');
var plugins = require('./plugins');
var Request = require('./request');
var Response = require('./response');
var Server = require('./server');



///--- Globals

var DTRACE;

var HttpClient = clients.HttpClient;
var JsonClient = clients.JsonClient;
var StringClient = clients.StringClient;



///--- Helpers

function getDTraceProvider(options) {
  if (options.dtrace)
    return options.dtrace;

  if (!DTRACE)
    DTRACE = d.createDTraceProvider(options.name || 'restify');

  return DTRACE;
}


///--- Exported API

module.exports = {

  createServer: function createServer(options) {
    if (!options)
      options = {};
    if (!options.log4js)
      options.log4js = log4js;
    if (!options.name)
      options.name = 'restify';

    options.dtrace = getDTraceProvider(options);

    return new Server(options);
  },


  createClient: function createClient(options) {
    if (typeof(options) !== 'object')
      throw new TypeError('options (Object) required');

    if (!options.log4js)
      options.log4js = log4js;
    if (!options.type)
      options.type = 'application/octet-stream';

    options.dtrace = getDTraceProvider(options);

    var client;
    switch (options.type) {
    case 'json':
      client = new JsonClient(options);
      break;

    case 'string':
      client = new StringClient(options);
      break;

    case 'http':
    default:
      client = new HttpClient(options);
      break;
    }

    return client;
  },


  createJsonClient: function createJsonClient(options) {
    if (typeof(options) !== 'object')
      throw new TypeError('options (Object) required');

    options.type = 'json';
    return module.exports.createClient(options);
  },


  createStringClient: function createStringClient(options) {
    if (typeof(options) !== 'object')
      throw new TypeError('options (Object) required');

    options.type = 'string';
    return module.exports.createClient(options);
  },


  HttpClient: HttpClient,
  JsonClient: JsonClient,
  StringClient: StringClient,

  Request: Request,
  Response: Response,
  Server: Server,

  setLogLevel: function(level) {
    if (typeof(level) !== 'string')
      throw new TypeError('level (String) required');

    return log4js.setGlobalLogLevel(level);
  }
};


Object.keys(errors).forEach(function(k) {
  module.exports[k] = errors[k];
});

Object.keys(plugins).forEach(function(k) {
  module.exports[k] = plugins[k];
});

module.exports.__defineSetter__('defaultResponseHeaders', function(f) {
  if (f === false || f === null || f === undefined) {
    f = function() {};
  } else if (f === true) {
    return;
  } else if (typeof(f) !== 'function') {
    throw new TypeError('defaultResponseHeaders must be a function');
  }

  Response.prototype.defaultHeaders = f;
});
