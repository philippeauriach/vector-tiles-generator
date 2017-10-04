# vector-tiles-generator

## installation
```
vector-tiles-generator
```

## usage with express
```
var VectorTileGenerator = require('vector-tiles-generator');

//initialize once your generator
//you must provide your own pg-pool

var vectorTileGenerator = new VectorTileGenerator({
  pgPool: pool,
  cache: '//TODO'
});

app.get('/layer/:z/:x/:y.mvt', function(req, res) {
  var tile = {
    x: parseInt(req.params.x),
    y: parseInt(req.params.y),
    z: parseInt(req.params.z)
  };

  //nothing before zoom level 9
  if(tile.z < 9) {
    return res.status(204).send();  //204 empty status for mapbox
  }

  return vectorTileGenerator.get({
    points: `SELECT name, ST_AsGeoJSON(ST_Transform(way, 4326)) as the_geom_geojson
              FROM planet_osm_polygon WHERE way && !bbox!`  //!bbox! will be replaced
  }, tile)
  .then(function(result) {
    if(!result || result.length === 0) {
      return res.status(204).send();  //handle empty status for mapbox
    }
    return res.send(result);
  });
});
```
