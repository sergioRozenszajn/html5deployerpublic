/* eslint-disable no-console */
/* Copyright © 2017 SAP SE or an affiliate company. All rights reserved.*/

'use strict';

var fs = require('fs');
var archiver = require('archiver');
var request = require('request');
var uuid = require('uuid/v4');
var path = require('path');
var fileType = require('file-type');

exports.getDTRequestOptions = getDTRequestOptions;
exports.getUAARequestFormData = getUAARequestFormData;
exports.getUAAurl = getUAAurl;
exports.isZipFile = isZipFile;


exports.getService = function () {
  var exceptionString = 'Error loading environment';
  var vcapServices;
  var html5AppsRepoServiceName;

  try {
    vcapServices = JSON.parse(process.env.VCAP_SERVICES);
    html5AppsRepoServiceName = getHtml5AppsRepoServiceName(vcapServices);
  } catch (e) {
    throw new Error(exceptionString + '. ' + e);
  }

  return vcapServices[html5AppsRepoServiceName][0];
};

exports.getResourcesFolder = function (service) {
  var resourcesFolder = 'resources';
  service.tags.forEach(function (tag) {
    if (tag.indexOf('resources=') === 0) {
      resourcesFolder = tag.substring(10);
    }
  });
  return resourcesFolder;
};

exports.getCwd = function() {
  console.log("====__dirname " + __dirname);
  var cwd;
  if (__dirname.startsWith('/home/vcap')){
      cwd = '/home/vcap/app';
  } else if (__dirname.startsWith('\\home\\vcap')){
      cwd = '\\home\\vcap\\app';
  } else {
      cwd = path.join(__dirname, '..', '..', '..', '..');
  }
  return cwd;
};


exports.validateResourcesFolder = function (resourcesFolder) {
  var cwd = exports.getCwd();
  console.log("====cwd " + cwd);
  var  resourcesPath =  path.join(cwd, resourcesFolder);
  if (!fs.existsSync(resourcesPath)){
    throw Error('The resources folder ' + resourcesFolder + ' does not exist.');
  }
  if (!fs.lstatSync(resourcesPath).isDirectory()){
    throw Error('The resources folder ' + resourcesFolder + ' is not a directory.');
  }
  var folderEntries = fs.readdirSync(resourcesPath);
  if (!folderEntries.length){
    throw Error('The resources folder ' + resourcesFolder + ' is empty.');
  }
  folderEntries.forEach(function (entry) {
    var entryPath = path.join(resourcesPath,entry);
    if (!fs.lstatSync(entryPath).isDirectory() && !isZipFile(entryPath)){
      throw Error('The resources folder is invalid because it contains the file - ' + entry +
      '; the resources folder should contain application folders and/or zip files.');
    }
  });
};

exports.validateService = function (service) {
  if (!service.credentials || !service.credentials.uri
        || !service.credentials.uaa || !service.credentials.uaa.url
        || !service.credentials.uaa.clientid || !service.credentials.uaa.clientsecret) {
    throw Error('Incomplete credentials for html5 applications repository service');
  }
};

exports.archive = function (zipResources, buildDirectory, buildFile, cb) {
    // Create build directory
  if (!fs.existsSync(buildDirectory)) {
    fs.mkdirSync(buildDirectory);
  }

  var output = fs.createWriteStream(buildFile);
  var archive = archiver('zip', {
    store: true
  });
  output.on('close', function () {
        // When archive finished - send it
    cb();
  });
  archive.on('error', function (err) {
    cb(new Error('Archiving failed. ' + err));
  });
  archive.pipe(output);
  archive.directory(zipResources, false);
  archive.finalize();
};

exports.upload = function (service, token, appsZips, cb) {
  var requestOptions = getDTRequestOptions(service, token);
  var multipartReq = request.put(requestOptions, function onResponse(err, res, body) {
    if (err) {
      cb(new Error('Error in request: ' + JSON.stringify(err)));
    }
    if (res.statusCode === 201) {
      cb();
    }
    else {
      cb(new Error('Error while uploading resources to Server; Status: ' + res.statusCode +
                ' Response: ' + JSON.stringify(body)));
    }
  });
  var form = multipartReq.form();
  appsZips.forEach(function (zipFile) {
    form.append('apps', fs.createReadStream(zipFile), {'content-type': 'application/zip'});
  });
};

exports.obtainToken = function (service, cb) {
  request.post({
    url: getUAAurl(service),
    form: getUAARequestFormData(service)
  },
      function (err, res, body) {
        try {
          if (err) {
            cb(new Error('Error while obtaining token. ' + err));
          }
          else if (res.statusCode === 200) {
            if (!JSON.parse(body).access_token) {
              cb(new Error('Bad token'));
            } else {
              cb(null, JSON.parse(body).access_token);
            }
          } else {
            cb(new Error('Error while obtaining aaaa token; Status: ' + res.statusCode +
                        ' Response: ' + JSON.stringify(body)));
          }
        } catch (e) {
          cb(new Error('Error while parsing UAA response; ' + e));
        }
      });
};

exports.isApplicationLogBound = function(){
  var applicationLogExist = false;
  var exceptionString = 'Error loading environment';
  var vcapServices;
  try {
    vcapServices = JSON.parse(process.env.VCAP_SERVICES);
  } catch (e) {
    throw new Error(exceptionString + '. ' + e);
  }

  for (var service in vcapServices) {
    if (vcapServices[service][0].label && vcapServices[service][0].label === 'application-logs'){
      applicationLogExist = true;
      break;
    }
  }
  return applicationLogExist;
};

function getUAAurl(service) {
  return service.credentials.uaa.url + '/oauth/token';
}

function getUAARequestFormData(service) {
  return {
    'client_id': service.credentials.uaa.clientid,
    'client_secret': service.credentials.uaa.clientsecret,
    'grant_type': 'client_credentials',
    'response_type': 'token'
  };
}

function getDTRequestOptions(service, token) {
  var corrID = uuid();
  var requestOptions = {
    url: service.credentials.uri + '/applications/content',
    headers: {
      'Authorization': 'Bearer ' + token,
      'X-CorrelationID': corrID
    },
  };
  return requestOptions;
}

function getHtml5AppsRepoServiceName(vcapServices) {
  if (!vcapServices){
    throw new Error();
  }
  var multipleAppHosts = false;
  var serviceNames = [];

  for (var service in vcapServices) {
    if (!vcapServices[service][0]){
      throw new Error();
    }
    vcapServices[service][0].tags.forEach(function (tag) {
      if (tag === 'html5-apps-repo-dt') {
        if (vcapServices[service].length > 1){
          multipleAppHosts = true;
        } else {
          serviceNames.push(service);
        }
      }
    });
  }
  if ((serviceNames.length === 0 && multipleAppHosts) || serviceNames.length > 1){
    throw new Error('Only one app-host service should be bound');
  }
  if (serviceNames.length === 0){
    throw new Error('html5 applications repository service is not bound');
  }
  if (serviceNames.length === 1){
    return serviceNames[0];
  }
}

function isZipFile(filePath){
  var type;
  if (!fs.existsSync(filePath) || fs.lstatSync(filePath).isDirectory()) { // if it's folder
    return false;
  }
  var buffer = new Buffer(4100);
  var fd =  fs.openSync(filePath,'r');
  fs.readSync(fd, buffer, 0, 4100);
  type = fileType(buffer);
  if (type && type.ext === 'zip'){
    return true;
  }
  return false;
}
