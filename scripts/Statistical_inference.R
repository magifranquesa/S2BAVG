# ------------------------------------------------------------------------------
# Script: Statistical_inference.R
# Author: Marc Padilla
# Description:
# This script performs the statistical inference of accuracy metrics for a given
# burned area product using reference data from stratified random samples.
# The workflow includes:
# - Reading precomputed error matrices per sampling unit
# - Computing area-weighted estimates of metrics like DC, Ce, Oe, relB at global scale
# - Estimating the same metrics per biome (stratum)
# - Exporting the results as CSV files
#
# This script relies on the functions defined in BA_val_fun.R and uses a design-based
# inference approach as outlined in Stehman (1997) and Franquesa et al. (2022).
# ------------------------------------------------------------------------------

# Load required libraries
# Load required libraries
library(abind)    # for adrop function
library(foreign)   # for read.dbf
library(dplyr)     # for data manipulation
library(sf)         # for spatial data handling

# Load custom functions
source("./scripts/BA_val_fun.R")

# ------------------------------------------------------------------------------
# Load error matrices for all sampled units
# ------------------------------------------------------------------------------
# Load the error matrices for all sampled units
# The error matrices should be in a CSV or txt file with columns 'su', 'tb', 'ce', 'oe', and 'tub'
# The 'su' (sample unit) column should contain the sampling unit IDs, following the format:
# 'pre-fire-date_post-fire-date_suID' (e.g., '20190730_20190916_35PQL')
# The 'tb', 'ce', 'oe', and 'tub' columns should contain the area in m2 for each category.

em<- read.table('./data/matrix_error/ErrorMats_test.txt',sep = ';', header = TRUE)

# Compute accuracy metrics for each sampling unit
# tb=true burned, ce=commission error, oe=omission error, tb=true unburned
metrics<- metrics_fun_yx(em$tb, em$ce, em$oe, em$tub)

# Merge with sampling unit data
metrics<- data.frame(su = em$su, metrics)

metrics_m <- metrics %>%
  mutate(m_area = tb + ce + oe + tub) %>%
  select(su, m_area)
metrics<- merge(metrics_m, metrics, by='su')

# ------------------------------------------------------------------------------
# Load strata sizes and biome information
# ------------------------------------------------------------------------------
# Load the sample size data for each stratum
# The sample size data should contain the number of sampling units (Nh) for each stratum
# and the corresponding biome information.
# The data should be in a CSV file with columns 'strata', 'Nh', 'biome', and 'biome_group'
# The 'biome_group' column should contain the biome classification for each stratum.
# The 'biome' column should contain the biome code for each stratum.
# The 'strata' column should contain the stratum code for each stratum.

str_size<- read.table('./outputs/sampling/sampling_summary_firecci51_2019.csv',sep = ',', header = TRUE)
ndf<- str_size[,c('strata','Nh')]
colnames(ndf) = c('strat','N')

biomes<-str_size[,c('biome','biome_group')] %>% unique()
colnames(biomes) = c('biome_code','biome')

# ------------------------------------------------------------------------------
# Load sampling reference units attributes (stratum, area, lapse, biome)
# ------------------------------------------------------------------------------
su <- read.csv('./data/reference_data/reference_units_2019_test.csv')
# The reference units data should contain the sampling unit ID, stratum, area, lapse, and biome code.
su = su[,c('su', 'strat', 'lapse', 'area', 'biome_code')]

# Add variable M = total area of the sampling unit (e.g., m²)
su$M = su$area # * 365
su<-merge(biomes, su, by= 'biome_code')

# ------------------------------------------------------------------------------
# Merge reference data, metrics, and SU attributes
# ------------------------------------------------------------------------------

metrics<-merge(su,metrics,by= 'su')
metrics$strat = as.character(metrics$strat)
metrics$m= metrics$m_area # * metrics$lapse
colnames(metrics)

accuracy = tapply(metrics$strat,metrics$strat,function(x)length(x))

# ------------------------------------------------------------------------------
# GLOBAL ACCURACY ESTIMATION
# ------------------------------------------------------------------------------

#dat= metrics
N.df = ndf
mets = c('DC','Ce','Oe','relB')
#mets2 =c('tb','ce','oe','tub','BAref','DC','Ce','Oe','relB')
global_accuracy<- strat_clustsizes(dat= metrics, N.df = ndf, mets = mets, GetDetails = FALSE)

# ------------------------------------------------------------------------------
# BIOME-LEVEL ACCURACY ESTIMATION
# ------------------------------------------------------------------------------

# Loop over biomes
accuracy_per_biome = list()
biomes = levels(as.factor(as.character(metrics$biome)))

for (biome in biomes){
  metrics_b = metrics[metrics$biome == biome,]
  accuracy_per_biome[[biome]] = strat_clustsizes(dat= metrics_b, N.df = ndf, mets = mets2)
}

# ------------------------------------------------------------------------------
# EXPORT RESULTS
# ------------------------------------------------------------------------------

global_accuracy
accuracy_per_biome
write.csv(global_accuracy, './outputs/accuracy_metrics/global_accuracy.csv',row.names = FALSE)
write.csv(accuracy_per_biome, './outputs/accuracy_metrics/biome_accuracy.csv',row.names = FALSE)



