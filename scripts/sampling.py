# ------------------------------------------------------------------------------
# Script: sampling.py
# Author: Jon González-Ibarzabal (https://orcid.org/0009-0001-2278-1245)
# Co-authors: 
# - Magí Franquesa: Environmental Hydrology Climate and Human Activity Interactions,
#   Geoenvironmental Processes, IPE-CSIC (magi.franquesa@ipe.csic.es).
#   orcid: https://orcid.org/0000-0003-3101-0394
# Date: March 2025
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# any later version.
#
# This program is distributed in the hope that it will be useful,
# but WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
# GNU General Public License for more details.
#
# You should have received a copy of the GNU General Public License
# along with this program. If not, see <http://www.gnu.org/licenses/>
# <http://www.gnu.org/licenses/gpl.txt/>.

# Description:
# This script generates a stratified random sample of tiles for burned area (BA)
# validation based on fire activity and image availability. The sampling is applied 
# to a yearly layer within the S2BAVG grid GeoPackage.

# The process includes:
# 1. Merging the geometries with annual burned area data (FireCCI51 or MCD64A1).
# 2. Computing fire activity thresholds (80th percentile) by biome.
# 3. Assigning each tile to a stratum (biome × fire activity: high/low).
# 4. Filtering tiles based on land cover proportion and cloud-free observation frequency.
# 5. Allocating the total sample size proportionally to the size and fire activity of each stratum.
# 6. Ensuring a minimum of 2 tiles per stratum.
# 7. Saving:
#    - The stratification layer (`stratification_<year>`)
#    - The final selected sample (`selected_<year>`)

# Inputs:
# - gpk_path: GeoPackage with the S2BAVG grid and per-year burned area layers.
# - ba_data: Burned area product used for stratification ('firecci51', 'mcd64a1', or 'vnp64a1').

# Outputs:
# - A new GeoPackage with two layers: one for stratification and one for the selected sample.

# Usage (command-line):
# python sampling.py --gpk_path ./data/S2BAVG.gpkg --output_sampling_path ./outputs/sampling \
#   --year 2023 --ba_data mcd64a1 --total_sample_size 100 --land_perc_filter 50 --nocloudy_interval_filter 10
# ------------------------------------------------------------------------------

import geopandas as gpd
import pandas as pd
import numpy as np
import argparse
import os

def main(gpk_path, output_sampling_path, year, ba_data, total_sample_size, land_perc_filter, nocloudy_interval_filter):
    
    if int(year) < 2016:
        raise ValueError("Year must be greater than 2016")
    
    os.makedirs(output_sampling_path, exist_ok=True)
    output_dir = output_sampling_path

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
    
    biome_code_map = {
    'Tropical Forest': 1,
    'Temperate Forest': 2,
    'Boreal Forest': 3,
    'Tropical Savanna': 4,
    'Temperate Savanna': 5,
    'Mediterranean': 6,
    'Deserts & Xeric Shrublands': 7,
    'Tundra': 8}
    
    merged_data['id_stratum'] = merged_data.apply(
    lambda row: f"{year}_{biome_code_map.get(row['biome'], 'XX')}_1"
    if row[ba_data + '_fire_activity'] == 'high'
    else f"{year}_{biome_code_map.get(row['biome'], 'XX')}_0",
    axis=1)

    # Convert data types
    for column in merged_data.columns:
        if column == 'date_pre' or column == 'date_post':
            merged_data[column] = pd.to_datetime(merged_data[column])
        elif merged_data[column].dtype == 'object':
            merged_data[column] = merged_data[column].astype(str)

    output_filename = os.path.join(output_dir, f"sampling_{ba_data}_{year}.gpkg")
    merged_data.to_file(output_filename, layer='stratification_' + year, driver='GPKG')
    print(f"Stratification saved in {output_sampling_path}")

    # Filtering
    filtered_data = merged_data[
        (merged_data['land_perc'] >= land_perc_filter) & 
        (merged_data['median_days_interval_fireseason_nocloudy'] <= nocloudy_interval_filter) & 
        (merged_data['median_days_interval_fireseason_nocloudy'].notnull())
    ]
    
    filtered_data = filtered_data.copy()
    # Guardar las teselas filtradas
    filtered_data.to_file(output_filename, layer='filtered_' + year, driver='GPKG')
    print(f"Filtered tiles saved in {output_filename}")

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
    sampled_data.to_file(output_filename, layer='selected_' + year, driver='GPKG')

    print(f"Selected samples saved in {output_sampling_path}")

    # Summary by stratum
    summary_df = (
        filtered_data.groupby('id_stratum')
        .agg(
            biome_group=('biome', 'first'),
            biome=('biome', lambda x: biome_code_map.get(x.iloc[0], 'XX')),
            ba=(ba_data + '_fire_activity', 'first'),
            Nh=('id_stratum', 'count')
        )
        .reset_index()
    )

    selected_counts = (
        sampled_data.groupby('id_stratum')
        .size()
        .reset_index(name='nh')
    )

    summary_df = summary_df.merge(selected_counts, on='id_stratum', how='left')
    summary_df['nh'] = summary_df['nh'].fillna(0).astype(int)

    summary_df = summary_df.rename(columns={'id_stratum': 'strata'})
    summary_df.insert(0, 'Stratum', range(1, len(summary_df)+1))

    # save CSV
    csv_filename = os.path.join(output_sampling_path, f"sampling_summary_{ba_data}_{year}.csv")
    summary_df.to_csv(csv_filename, index=False)
    print(f"Sampling summary saved to {csv_filename}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Generate stratified sampling for BA validation")
    parser.add_argument("--gpk_path", type=str, required=True, help="Path to the S2BAVG.gpkg file")
    parser.add_argument("--output_sampling_path", type=str, required=True, help="Path to save the sampling results")
    parser.add_argument("--year", type=str, required=True, help="Year to sample (from 2016)")
    parser.add_argument("--ba_data", type=str, choices=['firecci51', 'mcd64a1', 'vnp64a1'], required=True, help="BA product for stratification")
    parser.add_argument("--total_sample_size", type=int, required=True, help="Total sample size")
    parser.add_argument("--land_perc_filter", type=int, default=50, help="Minimum land percentage to include (0-100)")
    parser.add_argument("--nocloudy_interval_filter", type=int, default=10, help="Max median days between cloud-free images")

    args = parser.parse_args()

    main(args.gpk_path, args.output_sampling_path, args.year, args.ba_data, args.total_sample_size, args.land_perc_filter, args.nocloudy_interval_filter)
