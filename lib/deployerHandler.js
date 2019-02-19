/* eslint-disable no-console */
/* Copyright © 2017 SAP SE or an affiliate company. All rights reserved.*/

'use strict';

var utils = require('./utils');
var fs = require('fs');
var async = require('async');
var path = require('path');
var http = require('http');
var log = require('cf-nodejs-logging-support');

exports.startDeployer = startDeployer;
exports.testDeployer = testDeployer;
exports.executeUpload = executeUpload;
exports.endProcess = endProcess;

function startDeployer() {
  start();
}

function testDeployer(cb) {
  start(cb);
}

function start(cb) {
  var service;
  var resourcesFolder;
  var loggingLevel = process.env.APP_LOG_LEVEL || 'error';
    // define logger
  log.setLoggingLevel(loggingLevel);
  try {
    if (!utils.isApplicationLogBound()) { // Defines readable logs if application log not bound
      log.setLogPattern('#{{written_at}}# - #{{level}}# {{msg}}');
    }
    log.logMessage('info', 'Application Deployer started ..', {'CODE': '2000'});
        // Get service
    service = utils.getService();
        // Validate service
    utils.validateService(service);
        // Get resources folder
    resourcesFolder = utils.getResourcesFolder(service);
        // validateResourcesFolder
    utils.validateResourcesFolder(resourcesFolder);
  } catch (e) {
    return endProcess(e, cb);
  }
    // executeUpload
  executeUpload(service, resourcesFolder, function (e) {
    endProcess(e, cb);
  });
}

function executeUpload(service, resourcesFolder, cb) {
  var appsZips = [];
  var cwd = utils.getCwd();
  var resourcesPath = path.join(cwd, resourcesFolder);
  var buildDirectory = path.join(resourcesPath, '../deploymentTemp');
  var folderEntries = fs.readdirSync(resourcesPath);
    // Get Token, Archive and Upload
  utils.obtainToken(service, function (err, token) {
    if (err) {
      return cb(err);
    }
    async.each(folderEntries,
            function (appDirName, iterateCb) { // for each entry
              var appResourcesPath = path.join(resourcesPath, appDirName);
              if (utils.isZipFile(appResourcesPath)){
                appsZips.push(appResourcesPath);
                return iterateCb();
              } else {
                var applicationZip = path.join(buildDirectory, appDirName + '.zip');
                utils.archive(appResourcesPath, buildDirectory, applicationZip,
                        function (err) {
                          if (err) {
                            return iterateCb(err);
                          }
                          log.logMessage('info', 'Archiver has been finalized and the output file ' + appDirName + '.zip descriptor has closed', {'code': '2001'});
                          appsZips.push(applicationZip);
                          iterateCb();
                        });
              }
            }, function (err) { // after finish all entries
              if (err) {
                return cb(err);
              }
              utils.upload(service, token, appsZips, function (err) {
                if (err) {
                  cb(err);
                }
                else {
                  cb();
                }
              });
            });
  });
}

function endProcess(err, cb) {
  var server;
  var deployId = process.env.DEPLOY_ID || 'none';
  if (err) {
    if (err && err.message) {
      log.logMessage('error', '%s', err.message, {'CODE': '2004'});
    }
    log.logMessage('error', 'Application Deployer failed', {'CODE': '2005'});
  } else {
    log.logMessage('info', 'Resources were successfully uploaded to Server', {'CODE': '2002'});
    log.logMessage('info', 'Application Deployer finished ..', {'CODE': '2003'});
  }

  if (deployId !== 'none') { // Scenario of Deploy plugin
    if (err) {
      log.logMessage('error', 'Deployment of html5 application content failed [Deployment Id: %s]', deployId, {'CODE': '2007'});
      console.error('Deployment of html5 application content failed [Deployment Id: ' + deployId + ']');
    } else {
      log.logMessage('info', 'Deployment of html5 application content done [Deployment Id: %s]', deployId, {'CODE': '2006'});
      console.log('Deployment of html5 application content done [Deployment Id: ' + deployId + ']');
    }
    setInterval(function () {
      log.logMessage('info', 'Waiting for deploy service to stop the application', {'CODE': '2008'});
    }, 30000);
  }
  else { // Scenario of pushing with manifest
    if (!err) { // don't leave app started if failed
            // For hanging the process
      var port = process.env.PORT || 3000;
            // eslint-disable-next-line no-unused-vars
      server = http.createServer(function (req, res) {
      }).listen(port);
    } else {
      console.error('Upload of html5 applications content failed ');
    }
  }
  if (cb) {
    cb(err, server); // testing only
  }
}
