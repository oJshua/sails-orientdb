"use strict";
/**
 * Module Dependencies
 */

var _ = require('lodash'),
    RecordId = require('oriento').RID;

/**
 * ignore
 */

exports.object = {};


/**
 * Safer helper for hasOwnProperty checks
 *
 * @param {Object} obj
 * @param {String} prop
 * @return {Boolean}
 * @api public
 */
var hop = Object.prototype.hasOwnProperty;
exports.object.hop = function(obj, prop) {
  return hop.call(obj, prop);
};


/**
 * Replaces the given key in the model for 'id'
 *
 * @param {Object}  model
 * @param {String}  key
 * @api private
 */
exports.replaceKeyForId = function replaceKeyForId(model, key) {
  // change id to string only if it's necessary
  var modelId;
  if(typeof model[key] === 'object')
    modelId = model[key].toString();
  else
    modelId = model[key];
  if(modelId.indexOf('#-') !== 0){  // ignoring temporary ids
    model.id = modelId;
  }
  delete model[key];
};


/**
 * Re-Write OrientDB's @rid/rid attribute to a normalized id attribute
 *
 * @param {Array|Object}  models
 * @param {Object}        schema
 * @api public
 */
exports.rewriteIds = function rewriteIds(models, schema) {
  var self = this;
  var isModelsArray = _.isArray(models);
  var modelsAux = isModelsArray ? models : [models];
  
  var _models = modelsAux.map(function(model) {
    if(!_.isObject(model))
      return model;
    
    if(hop.call(model, 'rid') && self.matchRecordId(model.rid)) {
      // case where the @rid is a temporary one
      self.replaceKeyForId(model, 'rid');
      delete model['@rid'];
    }
    else if(hop.call(model, '@rid')) {
      self.replaceKeyForId(model, '@rid');
    }
    
    // Rewrite any foreign keys if a schema is available
    if(schema){
      Object.keys(schema).forEach(function(key) {
        var foreignKey = schema[key].foreignKey || schema[key].model || false;
        var columnName = schema[key].columnName || key;
  
        // If a foreignKey, check if value matches an Orient DB Record id and if so turn it into a string
        if(foreignKey){
          if(model[columnName] instanceof RecordId){
            model[columnName] = model[columnName].toString();
          }
        }
      });
    }
    
    return model;
  });

  return isModelsArray ? _models : _models[0];
};


/**
 * Re-Write OrientDB's @rid attribute to a normalized id attribute in a recursive manner
 *
 * @param {Array|Object}  models
 * @param {Object}        schema
 * @param {Object}        accumulator, used by recursive call as protection against circular references
 * @api public
 */
exports.rewriteIdsRecursive = function rewriteIdsRecursive(models, schema, accumulator) {
  var self = this;
  var isModelsArray = _.isArray(models);
  var modelsAux = isModelsArray ? models : [models];
  accumulator = accumulator || {};
  
  var _models = modelsAux.map(function(model) {
    if(!_.isObject(model) || model instanceof Date || model instanceof RecordId)
      return model;
      
    if(model.id && accumulator[model.id])
      return model;  // already processed, circular reference
    
    model = self.rewriteIds(model, schema);
    
    accumulator[model.id] = true;
    
    Object.keys(model).forEach(function(key){
      if(_.isObject(model[key])){
        if(model[key] instanceof RecordId){
          model[key] = model[key].toString();
        }
        else if(!(model[key] instanceof Date)) {
        self.rewriteIdsRecursive(model[key], null, accumulator);
      }
      }
    });
    
    return model;
  });

  return isModelsArray ? _models : _models[0];
};


/**
 * Check if an ID resembles an OrientDB Record ID.
 *
 * @param {String} id
 * @return {Boolean}
 * @api public
 */
exports.matchRecordId = function matchRecordId(id) {
  if (!id) return false;
  if(id instanceof RecordId) { return true; }
  var test = id.toString();
  return test.match(/^\#\-?\d+\:\d+$/) ? true : false;
};


/**
 * Check if a collection is a Junction Table Through.
 *
 * @param {String} id
 * @return {Boolean}
 * @api public
 */
exports.isJunctionTableThrough = function isJunctionTableThrough(collection) {
  if(!collection.junctionTable)
    return false;
    
  if(collection.tables)
    return false;
    
  if (collection.identity && collection.tableName && collection.identity !== collection.tableName)
    return true;
  
  var name = collection.identity || collection.tableName;
  return name.match(/^\w+_\w+__\w+_\w+$/) ? false : true;
};


/**
 * Cleans a record from edges or attributes starting with @
 *
 * @param {Array} model
 * @param {Object} schema
 * @api public
 */
exports.cleanOrientAttributes = function cleanOrientAttributes(model, schema) {
  if (!model || !_.isObject(model))
    return;
  
  Object.keys(model).forEach(function(key) {

    var value = model[key];

    // orientdb special attributes
    if(key[0] ==='@'){
      delete model[key];
      return;
    }

    if (_.isObject(value)) {
      _.each(value, function(v, k) {

        if (k[0] === '@') {
          delete model[key][k];
        }
      });
    }

    // inbound or outbound edge
    if(key.slice(0, 3) === 'in_' || key.slice(0, 4) === 'out_'){
      //var relevantSide = key.slice(0, 3) === 'in_' ? 'out' : 'in';
      // legitimate object
      if(schema && schema[key]) 
        return;
      
      // // edge is not expanded
      // if(!_.isObject(model[key])){
        // delete model[key];
        // return;
      // }
//         
      // var joinTableName = key.slice(key.indexOf('_') + 1);
      // for (attributeName in schema){
        // // TODO: if join table has a tableName different from identity, this will not work!
        // // Dominant attribute could also be relevant in case the model points to itself
        // log.debug('cleanOrientAttributes, joinTableName: ' + joinTableName + ', key: ' + key);
        // if(schema[attributeName].through === joinTableName && !model[attributeName]){
          // model[attributeName] = self.getForeignKeys(model[key], relevantSide);
          // break;
        // }
      // }
      delete model[key];
    }
    
  });
};


/**
 * Reduce nested objects: goes through every object of collection, including nested and root,
 * and runs callback
 *
 * @param   {Object}    collection
 * @param   {function}  callback in the form of function(accumulator, obj, key) { ... return accumulator; }
 * @param   {Object}    accumulator
 * @param   {String}    rootKey
 * @return  {Object}    result
 * @api public
 */
exports.reduceNestedObjects = function reduceNestedObjects(collection, 
                                                           callback,
                                                           accumulator,
                                                           rootKey,
                                                           processedObjects) {
  accumulator = accumulator || {};
  rootKey = rootKey || '_root';
  processedObjects = processedObjects || [];
  if(!collection) { return accumulator; }
  
  if(processedObjects.indexOf(collection) > -1) {
    return accumulator;  // already processed
  }
  
  // parent
  var accu = callback(accumulator, collection, rootKey);
  
  processedObjects.push(collection);
  
  var mapped = _.reduce(collection, function(result, obj, key) {
    if(_.isPlainObject(obj) || _.isArray(obj))
      return reduceNestedObjects(obj, callback, result, key, processedObjects);
    return result;
  }, accu);
  
  return mapped;
};


/**
 * For each including nested properties
 *
 * @param   {Object}    collection
 * @param   {function}  callback in the form of function(value, key, parent).
 * @param   {Array}     processedObjects
 * @param   {function}  circularCallback in the form of function(value, key, parent).
 * @api public
 */
exports.forEachNested = function forEachNested(collection, callback, processedObjects, circularCallback) {
  processedObjects = processedObjects || [];
  circularCallback = circularCallback || _.noop;
  if(!collection) { return; }
  
  _.forEach(collection, function(value, key, parent) {
    if(_.isObject(value) &&
      !(value instanceof Date) &&
      !(value instanceof RecordId)){
        if(processedObjects.indexOf(value) > -1) {
          return circularCallback(value, key, parent);  // already processed
        }
        processedObjects.push(collection);
        return forEachNested(value, callback, processedObjects, circularCallback);
    }
    return callback(value, key, parent);
  });
}; 


/**
 * Remove Circular References
 *
 * @param   {Object}  collection
 * @api public
 */
exports.removeCircularReferences = function removeCircularReferences(object) {
  this.forEachNested(object, _.noop, [], function(value, key, parent){
    if(value.id){
      parent[key] = value.id;
    }
    else {
      parent[key] = '[Circular]';
    }
  });
};


/**
 * Get Attribute As Object
 * 
 * @param   {Object}  schema
 * @param   {String}  columnName
 * @return  {Object}  object
 * @api public
 * 
 */
exports.getAttributeAsObject = function getAttributeAsObject(schema, columnName){
  if(!schema || !columnName) { return undefined; }
  
  if(schema[columnName]){
    return _.isString(schema[columnName]) ? { type: schema[columnName] } : schema[columnName];
  }
  
  return _.find(_.values(schema), { columnName: columnName });
};

/**
 * Extend
 * 
 * Extends a class in a simple manner.
 * 
 * @param  {Object}   parent
 * @param  {Object}   [source]
 * @return {Function}
 */
exports.extend = function extend(parent, source){
  source = source || {};
  var child;

  if (_.isFunction(source)) {
    child = function () { return source.apply(this, arguments); };
  }
  else if (source.hasOwnProperty('constructor')) {
    child = source.constructor;
  }
  else {
    child = function () { return parent.apply(this, arguments); };
  }
  
  // Inherit parent's prototype
  child.prototype = _.create(parent.prototype, { 'constructor': child });
  
  var keys, key, i, limit;
  
  // Inherit parent's properties
  for (keys = Object.keys(parent), key = null, i = 0, limit = keys.length; i < limit; i++) {
    key = keys[i];
    if (key !== 'prototype') {
      child[key] = parent[key];
    }
  }
  
  // Overwrite with source's properties
  for (keys = Object.keys(source), key = null, i = 0, limit = keys.length; i < limit; i++) {
    key = keys[i];
    if (key !== 'constructor' && key !== 'prototype' && source.hasOwnProperty(key)) {
      child[key] = source[key];
    }
  }

  // Overwrite with source's prototype properties  
  if(source.prototype){
    for (keys = Object.keys(source.prototype), key = null, i = 0, limit = keys.length; i < limit; i++) {
      key = keys[i];
      if (key !== 'constructor') {
        child.prototype[key] = source.prototype[key];
      }
    }
  }
  
  child.prototype.$super = parent;
  
  return child;
};

/* istanbul ignore next: debug code */
/**
 * Prints collection properties
 *
 * @param   {Object}  collection
 * @return  {String}  result
 * @api public
 */
exports.inspectCollection = function inspectCollection(collection) {
  var name = collection.identity || collection.tableName;
  var result = 'Details of ' + name + ':';
  var collectionKey;
  for (collectionKey in collection) {
    if (collection[collectionKey] &&
      !_.isFunction(collection[collectionKey]) &&
      ['waterline', 'connections', 'query', '_schema', '_callbacks', 'adapter'].indexOf(collectionKey) === -1) {
        result += ' - ' + collectionKey + ': ' + require('util').inspect(collection[collectionKey]);
    }
  }
  return result;
}; 
