// Copyright 2011 Mark Cavage, Inc.  All rights reserved.

var jsonParser = require('./json_body_parser');
var formParser = require('./form_body_parser');


function bodyParser(options) {

  var parseForm = formParser(options);
  var parseJson = jsonParser(options);

  return function parseBody(req, res, next) {
    if (req.contentLength === 0)
      return next();

    if (req.contentType === 'application/json') {
      return parseJson(req, res, next);
    } else if (req.contentType === 'application/x-www-form-urlencoded') {
      return parseForm(req, res, next);
    }

    return next();
  };
}

module.exports = bodyParser;
