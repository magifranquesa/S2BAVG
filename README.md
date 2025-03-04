# **S2BAVG - Sentinel-2 Burned Area Validation Grid**

## **Description**

The **S2BAVG** GeoPackage is a database designed for validating burned area (BA) products using Sentinel-2 images. It contains:

- A layer with the geometries of the sampling units and their permanent attributes.
- Annual tables with variable attributes since the availability of Sentinel-2 images.

### **Main Attributes**

- `Name`: Sampling unit ID.
- `orbits`: Sentinel-2 orbits that fully cover the unit.
- `tile_area`: Total area in m².
- `land_area`: Land area in m².
- `land_perc`: Percentage of land area over the total area (`land_area / tile_area`).
- `biome`: The dominant biome in the unit.
- `mcd64a1_area`: Total burned area at least once throughout the year according to **MCD64A1**.
- `firecci51_area`: Total burned area at least once throughout the year according to **FireCCI51**.
- `viirs_count_year`: Total number of VIIRS (VNP14IMGTDL) detections in the year.
- `image_days_year`: Days with at least one Sentinel-2 image covering at least 99% of the unit.
- `median_days_interval_year`: Median interval of days between Sentinel-2 images.
- `semester`: Estimated semester as the main fire season of the year.
- `date_pre_fireseason` and `date_post_fireseason`: Estimated start and end dates of the fire season.
- `viirs_count_fireseason`: Number of VIIRS detections in the fire season.
- `image_days_fireseason`: Number of Sentinel-2 image days in the fire season.
- `image_days_fireseason_nocloudy`: Sentinel-2 image days with low cloud cover in the fire season.
- `median_days_interval_fireseason_nocloudy`: Median interval between cloud-free Sentinel-2 images.

---

## **Generating Sampling with **``

The `` script generates stratified sampling for annual burned area validation. To ensure smooth execution, it is recommended to use a **conda environment**.

### **1. Creating and Activating a Conda Environment**

To avoid dependency conflicts, follow these steps to create a dedicated environment:

```bash
# Create a new conda environment named 's2bavg_env' with Python 3.9
conda create --name s2bavg_env python=3.9 -y

# Activate the environment
conda activate s2bavg_env

# Install required dependencies
conda install -c conda-forge geopandas pandas numpy -y
```

### **2. Running the Script**

Once the environment is set up, run the script using command-line arguments:

```bash
python sampling.py \
    --gpk_path "C:/path/to/S2BAVG.gpkg" \
    --output_sampling_path "C:/path/to/output/sampling.gpkg" \
    --year "2019" \
    --ba_data "firecci51" \
    --total_sample_size 100 \
    --land_perc_filter 50 \
    --nocloudy_interval_filter 10
```

### **3. Output Files**

The script generates a **GeoPackage** output file containing two main layers:

1. ``: Stratification layer based on biome and fire activity.
2. ``: Final selection of sampled units.

The output file will be stored at the location specified in `output_sampling_path`.

### **4. Deactivating the Conda Environment**

After execution, you can deactivate the environment with:

```bash
conda deactivate
```

---

## **Additional Notes**

- **Customization:** You can adjust the filtering criteria (`land_perc_filter`, `nocloudy_interval_filter`) and `total_sample_size` as needed.
- **Compatibility:** The script is designed for **Python 3.9** and later versions.
- **Validation:** You can open the `sampling.gpkg` file in GIS software like **QGIS** or **ArcGIS** to visualize results.

---

## **Advantages of Using Conda**

✅ **Isolated environment** prevents conflicts with other projects.\
✅ **Easy installation** of geospatial dependencies via **conda-forge**.\
✅ **Cross-platform compatibility** for Windows, Linux, and macOS.

This setup ensures a professional and reproducible workflow for generating burned area validation samples. Let us know if you need further modifications!

