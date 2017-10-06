var geojsonvt = require('geojson-vt');
var vtpbf = require('vt-pbf');
var GeoJSONWrapper = vtpbf.GeoJSONWrapper;
var SphericalMercator = require('@mapbox/sphericalmercator');

var VectorTilesGenerator = function(options) {
  this.projection = new SphericalMercator({
    size: 256
  });
  this.pgPool = options.pgPool;
  this.cacheOptions = options.cache;
};

VectorTilesGenerator.prototype.tile = function(opts) {
  var tile = {
    x: opts.x,
    y: opts.y,
    z: opts.z
  };
  tile.bounds = this.projection.bbox(opts.x, opts.y, opts.z, false, '900913');
  tile.bbox = [
    'ST_SetSRID(',
      'ST_MakeBox2D(',
        'ST_MakePoint(', tile.bounds[0], ', ', tile.bounds[1], '), ',
        'ST_MakePoint(', tile.bounds[2], ', ', tile.bounds[3], ')',
      '), ',
      '3857',
    ')'
  ].join('');
  tile.bbox_4326 = 'ST_Transform('+tile.bbox+', 4326)';
  tile.geom_hash = 'Substr(MD5(ST_AsBinary(the_geom)), 1, 10)';
  return tile;
};

VectorTilesGenerator.prototype.performQuery = function(sql, tile) {
  //replacing patterns between two '!' like !bbox!
  var templatePattern = /!([0-9a-zA-Z_\-]+)!/g;
  sql = sql.replace(templatePattern, function(match){
    match = match.substr(1, match.length-2);
    return tile[match];
  });
  //actually performing query
  return this.pgPool.connect()
    .then(function(client) {
      return client.query(sql, tile)
        .then(function(result){
          client.release();
          return result.rows;
        })
        .catch(function(e){
          client.release();
          throw e;
        });
    });
};

VectorTilesGenerator.prototype.queryResultsToGeoJSON = function(queryResultsRows) {
  var features = queryResultsRows.map(function(elt){
    var properties = {};
    for (var attribute in elt) {
      if (attribute !== 'the_geom_geojson') {
        properties[attribute] = elt[attribute];
      }
    }
    return {
      type: 'Feature',
      geometry: JSON.parse(elt.the_geom_geojson),
      properties: properties
    };
  });
  var geojson = {
    type: 'FeatureCollection',
    features: features
  };
  return Promise.resolve(geojson);
};

VectorTilesGenerator.prototype.get = function(queries, opts) {
  var self = this;
  var tile = this.tile(opts);
  return Promise.all(Object.keys(queries).map(function(key){
    var sql = queries[key];
    return self.performQuery(sql, tile)
    .then(function(queryResultsRows){
      return self.queryResultsToGeoJSON(queryResultsRows)
      .then(function(geojson){
        var govt = geojsonvt(geojson, {
          maxZoom: opts.z+1,
          indexMaxZoom: opts.z-1
        });
        var pbf = govt.getTile(opts.z, opts.x, opts.y);
        return {
          name: key,
          geojson: geojson,
          pbf: pbf
        };
      });
    });
  }))
  .then(function(layers) {
    var pbfOptions = {};
    for(var i in layers) {
      var layer = layers[i];
      if(layer.pbf){
        //construct the GeoJSONWrapper here, so that we can tell him the version !
        pbfOptions[layer.name] = new GeoJSONWrapper(layer.pbf.features);
        pbfOptions[layer.name].name = layer.name;
        pbfOptions[layer.name].version = 2;
      }
    }
    if(pbfOptions.length === 0) {
      return undefined;
    }
    // we use fromVectorTileJs instead of fromGeojsonVt because we constructed the GeoJSONWrapper ourselves
    var buff = vtpbf.fromVectorTileJs({layers: pbfOptions});
    if(buff) {
      buff = new Buffer(buff.buffer);
    }
    return buff;
  });
};

module.exports = VectorTilesGenerator;
