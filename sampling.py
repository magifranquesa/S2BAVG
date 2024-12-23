import geopandas as gpd
import pandas as pd
import numpy as np

#################################################################################################################
#################################################################################################################
#######          INPUTS         #################################################################################
#################################################################################################################
#################################################################################################################

#Insert S2BAVG.gpkg file path 
gpk_path = r'C:\insert_path\S2BAVG.gpkg'

#Insert output sampling file path
output_sampling_path = r'C:\insert_output_path\sampling.gpkg'

#Insert the year for sampling (available from 2016 to the last year)
year = '2019'

#select the BA stratification criteria product:
#'firecci51'(available from 2016 to 2020) OR 
#'mcd64a1' (all years available)
ba_data = 'firecci51'

# Define the total selected sample size
total_sample_size = 100

#Sampling Units filtering
land_perc_filter = 50
nocloudy_interval_filter = 10






#################################################################################################################
#######          STRATIFICATION         #########################################################################
#################################################################################################################


geometries = gpd.read_file(gpk_path, layer='geometries')
data_year = gpd.read_file(gpk_path, layer=year)

# Merge the two layers based on 'Name'
merged_data = gpd.GeoDataFrame(geometries.merge(data_year, on='Name'))
merged_data = merged_data.rename(columns={'geometry_x': 'geometry'})
# Eliminar cualquier columna de geometría redundante y mantener solo la necesaria
if 'geometry_y' in merged_data.columns:
    merged_data = merged_data.drop(columns=['geometry_y'])
merged_data = gpd.GeoDataFrame(merged_data, geometry='geometry')

# Compute 80th percentile thresholds for fire activity by biome
thresholds = (
    merged_data.groupby('biome')[ba_data + '_burned_perc']
    .quantile(0.8)
    .rename(ba_data+'_fire_activity_threshold')
    .reset_index()
)
# Join thresholds back to the data
merged_data = merged_data.merge(thresholds, on='biome')

# Classify fire activity as 'high' or 'low'
merged_data[ba_data+'_fire_activity'] = merged_data.apply(
    lambda row: 'high' if row[ba_data+'_burned_perc'] > row[ba_data+'_fire_activity_threshold'] else 'low',
    axis=1
)

# Create the stratification by combining biome and fire activity
merged_data['stratum'] = merged_data['biome'] + '_' + merged_data[ba_data+'_fire_activity']

# Convert all object types to string types, unless date_pre and date_post (to date type)
for column in merged_data.columns:
    if column == 'date_pre' or column == 'date_post':
        merged_data[column] = pd.to_datetime(merged_data[column])
    elif merged_data[column].dtype == 'object':
        merged_data[column] = merged_data[column].astype(str)

# Ensure that the active geometry colum is correct
merged_data = gpd.GeoDataFrame(merged_data, geometry='geometry')

#Save the stratification
merged_data.to_file(output_sampling_path, layer='stratification_' + year, driver='GPKG')
print(f"Stratification saved in GeoPackage: {output_sampling_path}")


#################################################################################################################
#######        SAMPLE ALLOCATION         ########################################################################
#################################################################################################################

# Count the units in each stratum before filtering
stratum_counts_before = merged_data['stratum'].value_counts()

# Filter the units according to land_perc and median_days_interval_fireseason_nocloudy
filtered_data = merged_data[(merged_data['land_perc'] >= land_perc_filter) & 
                            (merged_data['median_days_interval_fireseason_nocloudy'] <= nocloudy_interval_filter) & 
                            (merged_data['median_days_interval_fireseason_nocloudy'].notnull())]

# Calculate the mean burned area (BA) extent per stratum
filtered_data['BA_mean_stratum'] = filtered_data.groupby('stratum')[ba_data + '_burned_perc'].transform('mean')

# Calculate the sample size for each stratum using the formula nh ∝ Nh * sqrt(BAh)
stratum_sizes = filtered_data['stratum'].value_counts()
stratum_BA = filtered_data.groupby('stratum')['BA_mean_stratum'].mean()
stratum_sample_sizes = (stratum_sizes * np.sqrt(stratum_BA)).round().astype(int)
total_allocated = stratum_sample_sizes.sum()

# Adjust the total sample size to approximately sum to 100
stratum_sample_sizes = (stratum_sample_sizes / total_allocated * total_sample_size).round().astype(int)
difference = total_sample_size - stratum_sample_sizes.sum()
if difference > 0:
    # Add additional units to the strata with the largest sample size
    for stratum in stratum_sample_sizes.nlargest(difference).index:
        stratum_sample_sizes[stratum] += 1
elif difference < 0:
    # Remove additional units from the strata with the largest sample size
    for stratum in stratum_sample_sizes.nlargest(-difference).index:
        if stratum_sample_sizes[stratum] > 2:  # Ensure it does not reduce below 2
            stratum_sample_sizes[stratum] -= 1
# Check if there are strata with less than two units and add additional units if necessary
for stratum, sample_size in stratum_sample_sizes.items():
    if sample_size < 2:
        additional_units_needed = 2 - sample_size
        stratum_sample_sizes[stratum] += additional_units_needed

# Create an empty sample
sampled_data = pd.DataFrame()
# Perform random sampling within each stratum
for stratum, sample_size in stratum_sample_sizes.items():
    stratum_data = filtered_data[filtered_data['stratum'] == stratum]
    if sample_size > len(stratum_data):
        sample_size = len(stratum_data)
    stratum_sample = stratum_data.sample(n=sample_size, random_state=1, replace=False)
    sampled_data = pd.concat([sampled_data, stratum_sample])
sampled_data = sampled_data.drop(columns=['BA_mean_stratum'])

# Save the sampling
sampled_data.to_file(output_sampling_path, layer='selected_' + year, driver='GPKG')
print(f"Selected samples saved in GeoPackage: {output_sampling_path}")