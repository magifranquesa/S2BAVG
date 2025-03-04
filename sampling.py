import geopandas as gpd
import pandas as pd
import numpy as np
import argparse

def main(gpk_path, output_sampling_path, year, ba_data, total_sample_size, land_perc_filter, nocloudy_interval_filter):
    
    if int(year) < 2016:
        raise ValueError("Year must be greater than 2016")
    
    print(f"Loading data from {gpk_path} for year {year}...")

    geometries = gpd.read_file(gpk_path, layer='geometries')
    data_year = gpd.read_file(gpk_path, layer=year)

    merged_data = gpd.GeoDataFrame(geometries.merge(data_year, on='Name'))
    merged_data = merged_data.rename(columns={'geometry_x': 'geometry'})
    
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
    merged_data = merged_data.merge(thresholds, on='biome')

    merged_data[ba_data+'_fire_activity'] = merged_data.apply(
        lambda row: 'high' if row[ba_data+'_burned_perc'] > row[ba_data+'_fire_activity_threshold'] else 'low',
        axis=1
    )

    merged_data['stratum'] = merged_data['biome'] + '_' + merged_data[ba_data+'_fire_activity']

    # Convert data types
    for column in merged_data.columns:
        if column == 'date_pre' or column == 'date_post':
            merged_data[column] = pd.to_datetime(merged_data[column])
        elif merged_data[column].dtype == 'object':
            merged_data[column] = merged_data[column].astype(str)

    merged_data.to_file(output_sampling_path, layer='stratification_' + year, driver='GPKG')
    print(f"Stratification saved in {output_sampling_path}")

    # Filtering
    filtered_data = merged_data[
        (merged_data['land_perc'] >= land_perc_filter) & 
        (merged_data['median_days_interval_fireseason_nocloudy'] <= nocloudy_interval_filter) & 
        (merged_data['median_days_interval_fireseason_nocloudy'].notnull())
    ]
    
    filtered_data = filtered_data.copy()
    filtered_data['BA_mean_stratum'] = filtered_data.groupby('stratum')[ba_data + '_burned_perc'].transform('mean')

    stratum_sizes = filtered_data['stratum'].value_counts()
    stratum_BA = filtered_data.groupby('stratum')['BA_mean_stratum'].mean()
    stratum_sample_sizes = (stratum_sizes * np.sqrt(stratum_BA)).round().astype(int)
    total_allocated = stratum_sample_sizes.sum()

    stratum_sample_sizes = (stratum_sample_sizes / total_allocated * total_sample_size).round().astype(int)
    difference = total_sample_size - stratum_sample_sizes.sum()

    if difference > 0:
        for stratum in stratum_sample_sizes.nlargest(difference).index:
            stratum_sample_sizes[stratum] += 1
    elif difference < 0:
        for stratum in stratum_sample_sizes.nlargest(-difference).index:
            if stratum_sample_sizes[stratum] > 2:
                stratum_sample_sizes[stratum] -= 1

    for stratum, sample_size in stratum_sample_sizes.items():
        if sample_size < 2:
            additional_units_needed = 2 - sample_size
            stratum_sample_sizes[stratum] += additional_units_needed

    sampled_data = pd.DataFrame()
    for stratum, sample_size in stratum_sample_sizes.items():
        stratum_data = filtered_data[filtered_data['stratum'] == stratum]
        if sample_size > len(stratum_data):
            sample_size = len(stratum_data)
        stratum_sample = stratum_data.sample(n=sample_size, replace=False)
        sampled_data = pd.concat([sampled_data, stratum_sample])
    
    sampled_data = sampled_data.drop(columns=['BA_mean_stratum'])
    sampled_data.to_file(output_sampling_path, layer='selected_' + year, driver='GPKG')

    print(f"Selected samples saved in {output_sampling_path}")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Generate stratified sampling for BA validation")
    parser.add_argument("--gpk_path", type=str, required=True, help="Path to the S2BAVG.gpkg file")
    parser.add_argument("--output_sampling_path", type=str, required=True, help="Path to save the sampling results")
    parser.add_argument("--year", type=str, required=True, help="Year to sample (from 2016)")
    parser.add_argument("--ba_data", type=str, choices=['firecci51', 'mcd64a1'], required=True, help="BA product for stratification")
    parser.add_argument("--total_sample_size", type=int, required=True, help="Total sample size")
    parser.add_argument("--land_perc_filter", type=int, default=50, help="Minimum land percentage to include (0-100)")
    parser.add_argument("--nocloudy_interval_filter", type=int, default=10, help="Max median days between cloud-free images")

    args = parser.parse_args()

    main(args.gpk_path, args.output_sampling_path, args.year, args.ba_data, args.total_sample_size, args.land_perc_filter, args.nocloudy_interval_filter)
