# ------------------------------------------------------------------------------
# Script: BA_stats.r
# Author: Magí Franquesa (https://orcid.org/0000-0003-3101-0394)
# Date: March 2025

# Description:
# This script calculates the annual burned area (in square meters and percentage)
# for each sampling unit in the S2BAVG grid using VIIRS VNP64A1 Collection 2
# burned area product (burndate.tif files). The script processes all available
# burndate.tif files for the indicated years, merging monthly tiles into a single
# raster and extracting the burned area for each sampling unit. The results are then
# stored in a new GeoPackage with the same structure as the original S2BAVG grid.

# Requirements:
# - R packages: terra, sf, dplyr, fasterize, exactextractr
# - Input:
#   * VIIRS burndate.tif files organized as downloaded from the University of 
#     Maryland FTP server:
#     - FTP: ftp://fuoco.geog.umd.edu
#     - Server: fuoco.geog.umd.edu
#     - Login name: fire
#     - Password: burnt
#     - Directory: /data/VIIRS/C2/VNP64A1/TIFF
#   * A GeoPackage with the S2BAVG geometries (`geometries` layer)
# - Output:
#   * Annual statistics written into the specified output GeoPackage
# ------------------------------------------------------------------------------

# Define working directories (edit these as needed)
# Suggested folder structure:
#   - ./data/VNP64A1/TIFF             → input burndate.tif files
#   - ./data/S2BAVG.gpkg              → input GeoPackage
#   - ./output/S2BAVG_update.gpkg     → output GeoPackage
#   - ./temp/mosaics                  → temporary mosaics

# Load required libraries
library(terra)
library(sf)
library(dplyr)
library(fasterize)
library(exactextractr)

# Define paths and directories
base_dir <- "./data/VNP64A1/TIFF" # Directory with burndate.tif files
gpk_path <- "./data/S2BAVG.gpkg"  # Input GeoPackage
output_gpkg <- "./output/S2BAVG_update.gpkg"  # Output GeoPackage
temp_dir     <- "./temp/mosaics"  # Temporary directory for mosaics
modis_crs_hdf <- "./data/modis_crs.hdf"  # MODIS Sinusoidal CRS HDF file

start_year <- 2016  # Start year for processing
end_year <- 2023  # End year for processing

#Get MODIS Sinusoidal Projection (SR-ORG:6974)
# NOTE: This HDF file is used only to retrieve the CRS of the MODIS sinusoidal projection.
r <- rast(modis_crs_hdf)
modis_sinusoidal_proj <- crs(r)

# Ensure temp directory exists
if (!dir.exists(temp_dir)) dir.create(temp_dir, recursive = TRUE)
if (!dir.exists(dirname(output_gpkg))) dir.create(dirname(output_gpkg), recursive = TRUE)

# Load sampling unit geometries
geometries <- st_read(gpk_path, layer = "geometries")
geometries_wgs84 <- st_read(gpk_path, layer = "geometries")

# Reproject geometries to match the raster's CRS
if (st_crs(geometries) != st_crs(r)) {
  geometries <- st_transform(geometries, crs(r))
}

##############################################################
# FUNCTIONS
##############################################################
# Function to find all burndate.tif files for a given year & month
find_burndate_tifs <- function(base_dir, year, month) {
  # Search for all burndate.tif files across WinXX folders
  search_pattern <- paste0(base_dir, "/Win*/", year, "/*burndate.tif")
  all_files <- Sys.glob(search_pattern)

  # Filter files matching the correct month (using DOY)
  month_files <- c()

  for (file in all_files) {
    filename <- basename(file)

    # Extract year and DOY from the filename
    parts <- unlist(strsplit(filename, "\\."))
    year_str <- substr(parts[2], 2, 5)  # Extract year (e.g., "2012")
    doy_str <- substr(parts[2], 6, 8)  # Extract DOY (e.g., "061")
    doy <- as.numeric(doy_str)

    # Convert DOY to month
    date <- as.Date(doy - 1, origin = paste0(year_str, "-01-01"))
    if (format(date, "%m") == sprintf("%02d", month)) {
      month_files <- c(month_files, file)
    }
  }

  return(month_files)
}

# Function to merge multiple raster tiles into a single monthly raster
merge_monthly_tiles <- function(tif_list, year, month) {
  if (length(tif_list) == 0) {
    print(paste("No burndate.tif tiles found for", year, "-", month, ". Skipping."))
    return(NULL)
  }

  # Load raster files, filtering out missing or unreadable files
  rasters <- lapply(tif_list, function(f) {
    if (file.exists(f)) return(rast(f)) else return(NULL)
  })

  # Remove any NULL rasters
  rasters <- Filter(Negate(is.null), rasters)

  # Check if we still have valid rasters
  if (length(rasters) == 0) {
    print(paste("No valid rasters to merge for", year, "-", month))
    return(NULL)
  }

  # **Fixing the mosaic function call**
  mosaic_raster <- do.call(mosaic, rasters)

  # Save the temporary merged raster
  merged_tif <- file.path(temp_dir, paste0("burned_area_", year, "_", month, ".tif"))
  writeRaster(mosaic_raster, merged_tif, overwrite = TRUE)

  return(merged_tif)
}

# Function to reproject raster to MODIS Sinusoidal projection
reproject_raster <- function(input_raster, output_raster) {
  r <- rast(input_raster)

  # Check if reprojection is needed
  if (st_crs(r) == st_crs(modis_sinusoidal_proj)) {
    print(paste("Skipping reprojection:", input_raster, "is already in MODIS Sinusoidal"))
    return(input_raster)
  }

  # Reproject the raster to MODIS Sinusoidal projection
  r_proj <- project(r, modis_sinusoidal_proj, method = "near")
  writeRaster(r_proj, output_raster, overwrite = TRUE)

  return(output_raster) # Return the path to the reprojected raster
}

# Function to extract burned area from a raster
extract_burned_area <- function(raster_path, geometries) {
  if (is.null(raster_path)) {
    return(rep(0, nrow(geometries)))
  }

  # Reproject raster if necessary
  reprojected_raster <- gsub(".tif", "_modis_sinusoidal.tif", raster_path)
  reprojected_raster <- reproject_raster(raster_path, reprojected_raster)
  
  # Load raster and calculate pixel area
  r <- rast(reprojected_raster)
  pixel_resolution <- res(r)
  pixel_area <- prod(pixel_resolution)

  # Mask non-burned pixels (values outside 1-366)
  r_burned <- clamp(r, lower = 1, upper = 366, values = FALSE)

  # Use exactextractr to count burned pixels
  burned_pixel_counts <- exact_extract(r_burned, geometries, fun = "count")

  # Calculate burned area in square meters
  burned_areas <- burned_pixel_counts * pixel_area

  return(burned_areas)
}
##############################################################
##############################################################
# MAIN SCRIPT
##############################################################
# **Save the original geometries in the new GeoPackage**
st_write(geometries_wgs84, output_gpkg, layer = "geometries", delete_layer = TRUE)

# Loop through years defined by the user
for (year in start_year:end_year) {
  print(paste("Processing year", year, "..."))

  # Initialize yearly burned area storage
  total_burned_area_year <- rep(0, nrow(geometries))

  for (month in 1:12) {  # Loop through months 1 to 12
    print(paste("Processing", year, "-", month, "..."))

    # Find all tiles for this month
    burndate_tiles <- find_burndate_tifs(base_dir, year, month)

    # Merge tiles into a single mosaic
    merged_raster <- merge_monthly_tiles(burndate_tiles, year, month)

    if (!is.null(merged_raster)) {
      # Extract burned area for this month
      monthly_burned_area <- extract_burned_area(merged_raster, geometries)
      # **Sum monthly burned areas into yearly total**
      total_burned_area_year <- total_burned_area_year + monthly_burned_area
    }
  }

  # Convert to DataFrame and store in GeoPackage
  burned_df <- st_read(gpk_path, layer = as.character(year))

  # Crear un data frame con los valores de área quemada y el identificador 'Name'
  burned_area_df <- data.frame(
  Name = geometries$Name,  # Usar el identificador 'Name' de las geometrías
  vnp64a1_area = total_burned_area_year  # Valores de área quemada
  )

  # Unir los valores de área quemada al data frame original usando 'Name'
  burned_df <- burned_df %>% left_join(burned_area_df, by = "Name")

  # Join land_area from the geometries layer
  geometries_df <- st_drop_geometry(geometries)  # Drop geometry to work with a plain data frame
  burned_df <- burned_df %>% left_join(geometries_df %>% select(Name, land_area), by = "Name")

  # Calculate the percentage of burned area relative to land_area
  burned_df$vnp64a1_burned_perc <- ifelse(burned_df$vnp64a1_area == 0, 0, ifelse(burned_df$land_area > 0, (burned_df$vnp64a1_area / burned_df$land_area) * 100, 0))
  
  burned_df$vnp64a1_area <- round(burned_df$vnp64a1_area, 2)
  burned_df$vnp64a1_burned_perc <- round(burned_df$vnp64a1_burned_perc, 2)

  # Remove the geometry column (convert to a plain data frame)
  burned_df <- st_drop_geometry(burned_df)

  # Remove the land_area column (since it belongs to the geometries layer)
  burned_df <- burned_df %>% select(-land_area)

  # Reorder columns for consistency
  burned_df <- burned_df %>% select(Name, mcd64a1_area, mcd64a1_burned_perc, vnp64a1_area, vnp64a1_burned_perc, everything())

  # Save updated data back to GeoPackage
  st_write(burned_df, output_gpkg, layer = as.character(year), delete_layer = TRUE)
  print(paste("Updated", year, "with total burned area data."))
}