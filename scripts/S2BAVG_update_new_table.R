library(sf)

gpkg <- "E:/Downloads/S2BAVG.gpkg"

st_layers(gpkg)

tab <- read.csv(
  "E:/Downloads/2025.csv",
  stringsAsFactors = FALSE
)
nrow(tab)

# Escribir como nueva capa "2024"
st_write(
  tab,
  gpkg,
  layer = "2025",
  append = FALSE
)
