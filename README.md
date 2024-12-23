The Geopackage S2BAVG is a database created for validating burned area products using Sentinel-2 images.
The geometries layer contains the geometries of the sampling units and permanent attributes.
For variable attributes, there is a table for each year, starting from the availability of Sentinel-2 images.

Below is a description of each attribute:
-Name:		Unit ID.
-orbits:		Names of the Sentinel-2 orbits that completely overlap the unit.
-tile_area:		Total area in m².
-land_area:		Land area in m².
-land_perc:		Percentage of land area over the total area. (land_area / tile_area).
-biome:		The biome with the largest area in the unit.
-mcd64a1_area:		Total burned area at least once throughout the year, according to the MCD64A1 product, in m². 
-mcd64a1_burned_perc:		Percentage of mcd64a1_area over the land area. (mcd64a1_area/land_area).
-firecci51_area:		Total burned area at least once throughout the year, according to the FireCCI51 product, in m².
-firecci51_burned_perc:		Percentage of firecci51_area over the land area. (firecci51_area/land_area).
-viirs_count_year:		Total number of VIIRS AF (VNP14IMGTDL) points detected throughout the year.
-image_days_year:		Total number of days with at least one Sentinel-2 image covering at least 99% of the unit throughout the year.
-median_days_interval_year:		median interval of days between consecutive days of image_days_year
-semester:		Estimated semester as the main fire season of the year. If the value is 0, it represents a single fire season throughout the year, and 1 or 2 represent two fire seasons (with the change of the year). The value represents which of the two seasons contains more fires.
-date_pre_fireseason:		Estimated start date of the fire season.
-date_post_fireseason:		Estimated end date of the fire season.
-days_fireseason:		Total number of days in the estimated fire season.
-viirs_count_fireseason:		Total number of VIIRS (VNP14IMGTDL) points detected in the fire season.
-image_days_fireseason:		Total number of days with at least one Sentinel-2 image covering at least 99% of the unit in the fire season.
-median_days_interval_fireseason:		Median interval of days between consecutive days of image_days_fireseason.
-image_days_fireseason_nocloudy:		Total number of days with at least one low-cloud Sentinel-2 image covering at least 99% of the unit in the fire season.
-median_days_interval_fireseason_nocloudy:		Median interval of days between consecutive days of image_days_fireseason_nocloudy.


The sampling.py file is a Python script created to design the sampling for an annual BA validation using S2BAVG.
At the beginning of the code, the following inputs need to be filled in:
-gpk_path: The directory of the S2BAVG.gpkg file.
-output_sampling_path: The directory where the sampling design result will be saved.
-year: The year to be sampled (available from 2016).
-ba_data: The BA product to be used for stratifying the sample: 'firecci51' (available from 2016 to 2020) or 'mcd64a1'.
-total_sample_size: Defines the sample size. The final sample size may slightly differ to ensure a minimum number of samples in each stratum.
-land_perc_filter: Criterion to remove units with a percentage of land area below the specified threshold (from 0 to 100).
-nocloudy_interval_filter: Criterion to remove units with higher median intervals between consecutive low-cloud Sentinel-2 images.
