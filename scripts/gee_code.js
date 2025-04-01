//////////////////////////////////////////////////////////////////////////////////////////////
// Script: gee_code.js
// Author: Jon González-Ibarzabal (https://orcid.org/0009-0001-2278-1245)
// Date: March 2025
//
// Description:
// This script characterizes the fire season and evaluates the availability of Sentinel-2 
// images in each sampling unit of the S2BAVG grid. It performs the following tasks:
//
// 1. Computes burned area per unit using the MODIS MCD64A1 Collection 6.1 or the FireCCI51 BA products.
// 2. Calculates the temporal distribution of VIIRS active fire detections (hotspots), including:
//    - p15 and p85 percentiles (fire season boundaries)
//    - A refined fire season based on semester-level concentration of detections, with p0/p70 or p30/p100.
// 3. Derives the actual fire season period per unit (date_pre_fireseason to date_post_fireseason).
// 4. Computes the number of VIIRS detections during the fire season.
// 5. Analyzes Sentinel-2 image availability:
//    - Total number of Sentinel-2 images per tile and year.
//    - Number of images during the fire season.
//    - Number of cloud-free images during the fire season.
//    - Median interval between observations in each case.
//
// The output is exported as a CSV table containing all indicators for each tile.
//
// Note: This script is intended to be executed in the Google Earth Engine JavaScript Code Editor
// (https://code.earthengine.google.com/).
//
// Note: The script is designed to work with the S2BAVG grid, which is a tessellation of Sentinel-2 
//////////////////////////////////////////////////////////////////////////////////////////////
//
//////////////////////////////////////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////////////////////////////////////
//Define the year    /////////////////////////////////////////////////////////////////////////
var year = '2023';   /////////////////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////////////////////////////////////


// Convert the string to an integer
var yearNum = ee.Number.parse(year);
// Load the polygon asset
var polygons = ee.FeatureCollection('projects/ee-jonglezibarzabal/assets/S2_tiles_land_vfinal');

// Define the date range
var startDate = year + '-01-01';
var endDate = year +'-12-31';

// Load the FireCCI51 and MCD64A1 products
//var fireCCI51 = ee.ImageCollection('ESA/CCI/FireCCI/5_1').filterDate(startDate, endDate).select('BurnDate');
var mcd64a1 = ee.ImageCollection('MODIS/061/MCD64A1').filterDate(startDate, endDate).select('BurnDate');

// Function to calculate unique burned area (avoiding summing multiple burns in the same area)
function calculateUniqueBurnedArea(imageCollection, polygons) {
  var burnedArea = imageCollection.map(function(image) {
    return image.gt(0).selfMask().multiply(ee.Image.pixelArea()); 
  }).max();
  var areaByPolygon = burnedArea.reduceRegions({
    collection: polygons,
    reducer: ee.Reducer.sum(),
    scale: 125,
    crs: 'EPSG:4326',
    tileScale: 2
  });
  return areaByPolygon;
}
// Calculate the burned area for each product
//var fireCCI51UniqueBurnedArea = calculateUniqueBurnedArea(fireCCI51, polygons);
var mcd64a1UniqueBurnedArea = calculateUniqueBurnedArea(mcd64a1, polygons);

// Combine the burned area results into a single collection for export
var combinedBurnedAreaResults = polygons.map(function(feature) {
  var name = feature.get('Name');
  var land_area = feature.get('land_area');
  //var fireCCI51Unique = fireCCI51UniqueBurnedArea.filter(ee.Filter.eq('Name', name)).first().get('sum');
  var mcd64a1Unique = mcd64a1UniqueBurnedArea.filter(ee.Filter.eq('Name', name)).first().get('sum');
  //var firecci51_burned_perc = ((ee.Number(fireCCI51Unique).float()).divide(ee.Number(land_area).float())).multiply(100);
  var mcd64a1_burned_perc = ((ee.Number(mcd64a1Unique).float()).divide(ee.Number(land_area).float())).multiply(100);
  
  
  return feature.set({
    'mcd64a1_area': ee.Number(mcd64a1Unique).format('%.2f'),
    //'firecci51_area': ee.Number(fireCCI51Unique).format('%.2f'),
    'mcd64a1_burned_perc': ee.Number(mcd64a1_burned_perc).format('%.2f'),
    //'firecci51_burned_perc': ee.Number(firecci51_burned_perc).format('%.2f'),
  });
});

// Filter out empty geometries
var polygons_withareas = combinedBurnedAreaResults.filter(ee.Filter.notNull(['Name']));

// Function to calculate the p15 and p85 percentiles of hotspot dates throughout the year
var calculateHSpercentiles = function(polygon) {
  // Hotspots
  var hs = ee.FeatureCollection('projects/ee-jonglezibarzabal/assets/hs_viirs_'+ year)
    .filterBounds(polygon.geometry());
  hs = hs
    .filter(ee.Filter.gt('ACQ_DATE', ee.Date(startDate).millis()))
    .filter(ee.Filter.lt('ACQ_DATE', ee.Date(endDate).advance(1, 'day').millis()));

  // Extract detection dates in millis
  var acqDates = hs.aggregate_array('ACQ_DATE');

  // Calculate the 15th and 85th percentiles
  var percentiles = ee.List(acqDates).reduce(ee.Reducer.percentile([15,85]));
  var p15 = percentiles['p15']
  var p85 = percentiles['p85']
  
  // Return the percentiles as a property of the polygon
  return polygon.set({'percentiles': percentiles});
};

// Add the percentiles of the entire year to the polygons
var polygons_withareas_percentiles = polygons_withareas.map(calculateHSpercentiles);

// Remove the 'percentiles' property (Object) to add the p15 and p85 columns individually
var updateProperties = function(feature) {
  // Get the percentiles object
  var percentiles = ee.Dictionary(feature.get('percentiles'));
  // Extract p15 and p85 values from percentiles
  var p15 = percentiles.get('p15');
  var p85 = percentiles.get('p85');
  // Create a new feature by copying all properties and adding new ones
  var newFeature = ee.Feature(feature.geometry())  // Retain geometry
    .set(feature.toDictionary(feature.propertyNames().remove('percentiles')))  // Copy all other properties except 'percentiles'
    .set('p15', p15)  // Add p15 property
    .set('p85', p85)  // Copy all other properties
    .set('Name', feature.get('Name'))
    .set('biome', feature.get('biome'))
    .set('land_area', feature.get('land_area'))
    .set('land_perc', feature.get('land_perc'))
    .set('orbits', feature.get('orbits'))
    .set('tile_area', feature.get('tile_area'));
  
  return newFeature;
};

// Apply the function to each feature in the collection
var updatedFeatures = polygons_withareas_percentiles.map(updateProperties);

// Function to convert percentiles from millis to YYYY/MM/dd format, and calculate the number of days between the two dates
var addDateProperties = function(feature) {
  // Get 'p15' and 'p85' as Objects and check if they are non-null
  var date_p15_millis = ee.Algorithms.If(feature.get('p15'), ee.Number(feature.get('p15')), null);
  var date_p85_millis = ee.Algorithms.If(feature.get('p85'), ee.Number(feature.get('p85')), null);
  // Convert the millisecond values to ee.Date objects, if they exist
  var date_p15 = ee.Algorithms.If(date_p15_millis, ee.Date(date_p15_millis).format('YYYY-MM-dd'), null);
  var date_p85 = ee.Algorithms.If(date_p85_millis, ee.Date(date_p85_millis).format('YYYY-MM-dd'), null);
  // Calculate the difference in days between date_p15 and date_p85
  var days_p15_p85 = ee.Algorithms.If(
    date_p15_millis && date_p85_millis,
    ee.Date(date_p85_millis).difference(ee.Date(date_p15_millis), 'day').round(),
    null
  );
  
  // Set the new date properties on the feature, including handling of null values
  return feature.set({
    'date_p15': date_p15,
    'date_p85': date_p85,
    'days_p15_p85': days_p15_p85
  });
};

// Apply the function to each feature in the burned_season collection
var polygons_bareas_bseasons = updatedFeatures.map(addDateProperties);

// Function to calculate the semester with the most hotspots for features with more than 180 days between date_p15 and date_p85.
// For that semester, calculate p0 and p70 (if it's the first) or p30 and p100 (if it's the second)
var calculateHSsemester = function(feature) {
  // Hotspots data
  var hs = ee.FeatureCollection('projects/ee-jonglezibarzabal/assets/hs_viirs_'+ year)
    .filterBounds(feature.geometry());
  hs = hs
    .filter(ee.Filter.gt('ACQ_DATE', ee.Date(startDate).millis()))
    .filter(ee.Filter.lt('ACQ_DATE', ee.Date(endDate).advance(1, 'day').millis()));

// Define the number of days for the first half of the year
var daysInFirstHalf = ee.Date(startDate).getRelative('year', 'day').mod(4).eq(0) ? 183 : 182;

// Filter hs points for the first half of the year
var hs_firstHalf = hs.filter(ee.Filter.lt('ACQ_DATE', ee.Date(startDate).advance(daysInFirstHalf, 'day').millis()));
var hs_firstHalf_count = hs_firstHalf.size();

// Filter hs points for the second half of the year
var hs_secondHalf = hs.filter(ee.Filter.gte('ACQ_DATE', ee.Date(startDate).advance(daysInFirstHalf, 'day').millis()));
var hs_secondHalf_count = hs_secondHalf.size();

  // Generate a random number between 1 and 2
  var randomSemester = ee.Image.random().multiply(2).floor().add(1).reduceRegion({
    reducer: ee.Reducer.first(),
    geometry: feature.geometry(),
    scale: 1000, 
    maxPixels: 1e6,
    tileScale: 2
  }).values().get(0); // Obtains the value as a number
  
  // Get the days_p15_p85 value
  var days_p15_p85 = ee.Number(feature.get('days_p15_p85'));

  // Check if days_p15_p85 is not null and greater than 180
  var semester = ee.Algorithms.If(days_p15_p85, 
                  ee.Algorithms.If(days_p15_p85.gt(180),
                  ee.Algorithms.If(hs_firstHalf_count.gt(hs_secondHalf_count), 1,
                  ee.Algorithms.If(hs_secondHalf_count.gt(hs_firstHalf_count), 2,
                  // Use randomSemester for equal counts
                  ee.Algorithms.If(hs_firstHalf_count.eq(hs_secondHalf_count), randomSemester, 0))),
                  0),  // Default to 0 if conditions are not met
                  0);  // Default to 0 if days_p15_p85 is null

  // Convert semester to ee.Number and set it to 0 if it's null
  semester = ee.Number(semester);

  // Calculate percentiles based on the semester
  var result = ee.Algorithms.If(semester.eq(1),  // Semester 1
    // For semester 1, calculate the 0th and 70th percentiles of hs_first183
    hs_firstHalf.reduceColumns(ee.Reducer.percentile([0, 70]), ['ACQ_DATE']),
    
    ee.Algorithms.If(semester.eq(2),  // Semester 2
      // For semester 2, calculate the 30th and 100th percentiles of hs_remaining
      hs_secondHalf.reduceColumns(ee.Reducer.percentile([30, 100]), ['ACQ_DATE']),
null
    )
  );
  
  // Set the semester, hs_first183_count, hs_remaining_count, and percentiles as new attributes
  return feature.set({
    'semester': semester,
    'hs_firstHalf_count': hs_firstHalf_count,
    'hs_secondHalf_count': hs_secondHalf_count
  }).set(result);
};

var polygons_with_semester = polygons_bareas_bseasons.map(calculateHSsemester);

// Function to convert all percentiles from millis to YYYY/MM/dd format
var addSemesterDateProperties = function(feature) {
  var date_p0_millis = ee.Algorithms.If(feature.get('p0'), ee.Number(feature.get('p0')), null);
  var date_p70_millis = ee.Algorithms.If(feature.get('p70'), ee.Number(feature.get('p70')), null);
  var date_p30_millis = ee.Algorithms.If(feature.get('p30'), ee.Number(feature.get('p30')), null);
  var date_p100_millis = ee.Algorithms.If(feature.get('p100'), ee.Number(feature.get('p100')), null);

  var date_p0 = ee.Algorithms.If(date_p0_millis, ee.Date(date_p0_millis).format('YYYY-MM-dd'), null);
  var date_p70 = ee.Algorithms.If(date_p70_millis, ee.Date(date_p70_millis).format('YYYY-MM-dd'), null);
  var date_p30 = ee.Algorithms.If(date_p30_millis, ee.Date(date_p30_millis).format('YYYY-MM-dd'), null);
  var date_p100 = ee.Algorithms.If(date_p100_millis, ee.Date(date_p100_millis).format('YYYY-MM-dd'), null);

  // Set the new date properties on the feature, including handling of null values
  return feature.set({
    'date_p0': date_p0,
    'date_p70': date_p70,
    'date_p30': date_p30,
    'date_p100':date_p100
  });
};

// Apply the function to each feature in the collection
var polygons_with_semester_dates = polygons_with_semester.map(addSemesterDateProperties);

// Define the start and end date of the burning period depending on the value of semester
var addDatePrePost = function(feature) {
  // Get the semester value
  var semester = ee.Number(feature.get('semester'));

  // Define the conditional logic for date_pre and date_post
  var date_pre = ee.Algorithms.If(semester.eq(0),
                  feature.get('date_p15'),  // Semester 0: date_pre = date_p15
                  ee.Algorithms.If(semester.eq(1),
                    feature.get('date_p0'),  // Semester 1: date_pre = date_p0
                    feature.get('date_p30')  // Semester 2: date_pre = date_p30
                  )
                );

  var date_post = ee.Algorithms.If(semester.eq(0),
                   feature.get('date_p85'),  // Semester 0: date_post = date_p85
                   ee.Algorithms.If(semester.eq(1),
                     feature.get('date_p70'),  // Semester 1: date_post = date_p70
                     feature.get('date_p100')  // Semester 2: date_post = date_p100
                   )
                 );
                 
  var datePreNotNull = ee.Algorithms.If(date_pre, 1, 0);  // Returns 1 if not null, 0 if null
  var datePostNotNull = ee.Algorithms.If(date_post, 1, 0);  // Same for date_post
  
  date_pre = ee.Algorithms.If(
  ee.Number(datePreNotNull).eq(1),
  date_pre,
  ee.Date(year + '-01-01').format('YYYY-MM-dd')
);
  date_post = ee.Algorithms.If(
  ee.Number(datePostNotNull).eq(1),
  date_post,
  ee.Date(year + '-12-31').format('YYYY-MM-dd')
); 
  

  // Return the feature with the new properties
  return feature.set({
    'date_pre_fireseason': date_pre,
    'date_post_fireseason': date_post
  });
};

// Apply the function to your FeatureCollection
var polygons_with_semester_datesprepost = polygons_with_semester_dates.map(addDatePrePost);

//print(polygons_with_semester_datesprepost);

var calculateHSNumber = function(feature) {
  // Hotspots data
  var hs = ee.FeatureCollection('projects/ee-jonglezibarzabal/assets/hs_viirs_'+ year)
    .filterBounds(feature.geometry());

  hs = hs
    .filter(ee.Filter.gt('ACQ_DATE', ee.Date(startDate).millis()))
    .filter(ee.Filter.lt('ACQ_DATE', ee.Date(endDate).advance(1, 'day').millis()));

  var semester = ee.Number(feature.get('semester'));

  // Define the conditional logic for date_pre_millis
  var date_pre_millis = ee.Algorithms.If(
    semester.eq(0), 
    feature.get('p15'),  
    ee.Algorithms.If(
      semester.eq(1),
      feature.get('p0'),  // Semester 1: date_pre = date_p0
      feature.get('p30')  // Semester 2: date_pre = date_p30
    )
  );

  // Define the conditional logic for date_post_millis
  var date_post_millis = ee.Algorithms.If(
    semester.eq(0),
    feature.get('p85'),  // Semester 0: date_post = date_p85
    ee.Algorithms.If(
      semester.eq(1),
      feature.get('p70'),  // Semester 1: date_post = date_p70
      feature.get('p100')  // Semester 2: date_post = date_p100
    )
  );

  // Check if date_pre_millis is null, and if so, set it to startDate
  date_pre_millis = ee.Algorithms.If(
    date_pre_millis,  // If date_pre_millis is not null
    date_pre_millis,  // Use it
    ee.Date(startDate).millis()  // Otherwise use startDate
  );

  // Check if date_post_millis is null, and if so, set it to endDate
  date_post_millis = ee.Algorithms.If(
    date_post_millis,  // If date_post_millis is not null
    date_post_millis,  // Use it
    ee.Date(endDate).millis()  // Otherwise use endDate
  );

  // Only calculate hs_prepost if both dates are not null
  var hs_prepost = hs
    .filter(ee.Filter.gt('ACQ_DATE', ee.Date(date_pre_millis).millis()))
    .filter(ee.Filter.lt('ACQ_DATE', ee.Date(date_post_millis).advance(1, 'day').millis()));
  
  var date_post_post_millis = ee.Date(date_post_millis).advance(1, 'day').millis();

  var bseason_days = ee.Date(date_post_post_millis).difference(ee.Date(date_pre_millis), 'day').round();

  // Ensure that hs_prepost is explicitly converted to a FeatureCollection for size calculation
  hs_prepost = ee.FeatureCollection(hs_prepost);

  // Get the size of the filtered collection
  var hs_prepost_count = hs_prepost.size();

  // Filter hs points for the first 183 days
  var hs_year_count = hs.size();

  // Set the semester, hs_first183_count, hs_remaining_count, and percentiles as new attributes
  return feature.set({
    'viirs_count_year': hs_year_count,
    'viirs_count_fireseason': hs_prepost_count,
    'days_fireseason': bseason_days
  });
};


var polygons_with_semester_datesprepost_hscount = polygons_with_semester_datesprepost.map(calculateHSNumber);


// Function to add columns to each feature
var addImageStats = function(feature) {

  var datePre = feature.get('date_pre_fireseason');
  var datePost = feature.get('date_post_fireseason');
  var date_post_post = ee.Date(datePost).advance(1, 'day');
  var datePre_str = ee.Date(ee.String(feature.get('date_pre_fireseason')));
  var datePost_str = ee.Date(ee.String(feature.get('date_post_fireseason')));
  var difference = datePre_str.difference(datePost_str, 'day');
  var isEqual = difference.eq(0);
  var geometry = feature.geometry();
  var name = feature.get('Name');
  var tile = ee.String(feature.get('Name')).slice(0, 5);
  
  ////////////////////////////////////////////////
  //////////////////////YEAR//////////////////////
  ////////////////////////////////////////////////

  // Sentinel-2 collection for the year
  var s2Collection = ee.ImageCollection('COPERNICUS/S2_HARMONIZED')
      .filter(ee.Filter.calendarRange(yearNum, yearNum, 'year'))
      .filter(ee.Filter.eq('MGRS_TILE', tile))
      //.filterBounds(geometry)
      .filter(ee.Filter.notNull(['system:time_start']));
  
  // Function to check the full coverage of each image
  var checkCoverage = function(image) {
    var intersection = image.geometry().intersection(geometry, ee.ErrorMargin(500, 'meters'));
    var areaIntersection = intersection.area();
    var areaGeometry = geometry.area();
    return image.set('coverage', areaIntersection.divide(areaGeometry));
  };

  
  var fullyCoveredImages = ee.ImageCollection(s2Collection.map(checkCoverage)
                            .filter(ee.Filter.gte('coverage', 0.99)));
                            
  var images_days_year = fullyCoveredImages.aggregate_array('system:time_start');
    images_days_year = ee.List(images_days_year)
      .map(function(time) {
        return ee.Algorithms.If(
          ee.Algorithms.IsEqual(time, null),
          null,
          ee.Date(time).format("YYYY-MM-dd")  // Only day
        );
      })
      .filter(ee.Filter.notNull(['item']))
      .distinct(); 
  var images_days_year_count = images_days_year.size();
  
  // Check if the collection is not empty before calculating dates
  var medianDiff_year = null;

  if (images_days_year_count.gt(0)) {
    // Get the image dates and avoid duplicate days
    var dates_year = images_days_year;
    
    // Check if there is more than one date to calculate differences
    if (dates_year.size().gt(1)) {
      var dateDiffs_year = ee.List(dates_year.slice(1)).zip(dates_year)
        .map(function(datePair) {
          var d1 = ee.Date(ee.List(datePair).get(0));
          var d2 = ee.Date(ee.List(datePair).get(1));
          return d1.difference(d2, 'day');
        });

      // Calculate the median and mean of date differences
      medianDiff_year = ee.List(dateDiffs_year).reduce(ee.Reducer.median());
    }
  }
    // Add columns to the feature, assigning null if any collection is empty or does not have enough dates


  ////////////////////////////////////////////////
  ////////////////////PREPOST/////////////////////
  ////////////////////////////////////////////////
  var s2Collection_prepost = ee.ImageCollection(
    ee.Algorithms.If(
      isEqual, 
      ee.ImageCollection([]),  // If they are equal, empty collection
      fullyCoveredImages.filterDate(datePre, date_post_post) // If not, filter by date
    )
  );

  var images_days_prepost = s2Collection_prepost.aggregate_array('system:time_start');
  images_days_prepost = ee.List(images_days_prepost)
      .map(function(time) {
        return ee.Algorithms.If(
          ee.Algorithms.IsEqual(time, null),
          null,
          ee.Date(time).format("YYYY-MM-dd")  // Only day
        );
      })
      .filter(ee.Filter.notNull(['item']))
      .distinct(); 
  var images_days_prepost_count = images_days_prepost.size();


var medianDiff_prepost = ee.Number(1000); // Initialize to 0
var medianDiff_prepost_nocloudy = ee.Number(1000);
var prepostnocloudy_count = ee.Number(1000);

if (images_days_prepost_count.gt(1)) {  // Only if there is more than one image
  // Get the image dates
  var dates_prepost = images_days_prepost;

  // Check if there is more than one date to calculate differences
  if (dates_prepost.size().gt(1)) {
    var dateDiffs_prepost = ee.List(dates_prepost.slice(1)).zip(dates_prepost)
      .map(function(datePair) {
        var d1 = ee.Date(ee.List(datePair).get(0));
        var d2 = ee.Date(ee.List(datePair).get(1));
        return d1.difference(d2, 'day');
      });

    // Calculate the median and mean of date differences
 medianDiff_prepost = 
      ee.List(dateDiffs_prepost).reduce(ee.Reducer.median());
  }

    
  ////////////////////////////////////////////////
  ////////////////////NOCLOUDS////////////////////
  ////////////////////////////////////////////////

// Filter Sentinel-2 images according to cloudiness metadata
var lowCloudMeta = s2Collection_prepost.filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', 5));
var highCloudMeta = s2Collection_prepost.filter(ee.Filter.gte('CLOUDY_PIXEL_PERCENTAGE', 5));

// For images with >5% cloudiness, apply filtering with cloudProbability
var cloudProbabilityCollection = ee.ImageCollection('COPERNICUS/S2_CLOUD_PROBABILITY')
  .filter(ee.Filter.stringEndsWith('system:index', tile))
  .filterDate(datePre, date_post_post);

// Join the Sentinel-2 and cloudProbability collections
var joinedCollection = ee.ImageCollection(ee.Join.saveFirst('cloudProbability').apply({
  primary: highCloudMeta,
  secondary: cloudProbabilityCollection,
  condition: ee.Filter.equals({
    leftField: 'system:index',
    rightField: 'system:index'
  })
}));

// Function to check the cloud-free fraction using cloudProbability
var cloudFreeFilter = function(image) {
  var cloudProb = ee.Image(image.get('cloudProbability'));
  var cloudMask = cloudProb.lt(50);  // Mask for cloud probability < 50%
  var cloudFreeFraction = ee.Number(cloudMask.reduceRegion({
    reducer: ee.Reducer.mean(),
    geometry: geometry,
    scale: 30,
    maxPixels: 1e9,
    tileScale: 2
  }).get('probability'));
  
  // Handle the case when cloudFreeFraction is null
  cloudFreeFraction = ee.Algorithms.If(
    cloudFreeFraction,
    cloudFreeFraction,
    ee.Number(0) // If null, assign 0 as cloud-free fraction
  );

  // Consider cloud-free if the cloud-free fraction is high
  return image.set('cloud_free_fraction', cloudFreeFraction)
              .set('isCloudFree', ee.Algorithms.If(ee.Number(cloudFreeFraction).gte(0.85), 1, 0));
};

// Apply the cloudiness filter to high-cloud images
var highCloudFiltered = joinedCollection.map(cloudFreeFilter)
  .filter(ee.Filter.eq('isCloudFree', 1));

// Combine cloud-free images from both approaches
var noCloudImages = lowCloudMeta.merge(highCloudFiltered);
 var prepostnocloudy_days = noCloudImages.aggregate_array('system:time_start');
   prepostnocloudy_days = ee.List(prepostnocloudy_days)
    .map(function(time) {
      return ee.Algorithms.If(
        ee.Algorithms.IsEqual(time, null),
        null,
        ee.Date(time).format("YYYY-MM-dd")  // Only day
      );
    })
    .filter(ee.Filter.notNull(['item']))
    .distinct();  // Remove duplicate days
    
    prepostnocloudy_days = prepostnocloudy_days.sort();
    var prepostnocloudy_days_count = prepostnocloudy_days.size()

// Calculate dates and differences only if there is more than one cloud-free image
if (prepostnocloudy_days_count.gt(1)) {
  var dates_prepost_nocloudy = prepostnocloudy_days;


  if (dates_prepost_nocloudy.size().gt(1)) {
    var dateDiffs_prepost_nocloudy = ee.List(dates_prepost_nocloudy.slice(1)).zip(dates_prepost_nocloudy)
      .map(function(datePair) {
        var d1 = ee.Date(ee.List(datePair).get(0));
        var d2 = ee.Date(ee.List(datePair).get(1));
        return d1.difference(d2, 'day');
      });

    // Calculate the median and mean of date differences
    medianDiff_prepost_nocloudy = ee.List(dateDiffs_prepost_nocloudy).reduce(ee.Reducer.median());
  }
}

}
return feature.set({
    'image_days_year': images_days_year_count,
    'median_days_interval_year': medianDiff_year,
    'image_days_fireseason:': images_days_prepost_count,
    'median_days_interval_fireseason': medianDiff_prepost,
    'image_days_fireseason_nocloudy': prepostnocloudy_days_count,
    'median_days_interval_fireseason_nocloudy': medianDiff_prepost_nocloudy,
  });
};      

var polygons_with_semester_datesprepost_hscount_images = polygons_with_semester_datesprepost_hscount.map(addImageStats);

// Export the final result
Export.table.toDrive({
  collection: polygons_with_semester_datesprepost_hscount_images,
  description: year,
  folder: 's2_teselation',
  fileNamePrefix: year,
  fileFormat: 'CSV',
  selectors: ['Name', 'mcd64a1_area','mcd64a1_burned_perc', /*'firecci51_area','firecci51_burned_perc',*/'viirs_count_year','image_days_year','median_days_interval_year','semester','date_pre_fireseason', 'date_post_fireseason','days_fireseason','viirs_count_fireseason','image_days_fireseason','median_days_interval_fireseason','image_days_fireseason_nocloudy','median_days_interval_fireseason_nocloudy']
});