metrics_fun_yx = function(tb, ce, oe, tub) {
  a = tb + ce + oe + tub
  Ce.y = ce
  Ce.x = tb + ce
  Oe.y = oe
  Oe.x = tb + oe
  DC.y = 2 * tb
  DC.x = 2 * tb + ce + oe
  relB.y = ce - oe
  relB.x = tb + oe
  bias.y = ce - oe
  B.y = ce - oe
  B.x = a
  BAref.y = tb + oe
  BAprod.y = tb + ce
  Ce = Ce.y / Ce.x
  Oe = Oe.y / Oe.x
  DC = DC.y / DC.x
  bias = bias.y
  B = B.y / B.x
  relB = relB.y / relB.x
  BAref = BAref.y
  BAprod = BAprod.y
  tb.y = tb
  ce.y = ce
  oe.y = oe
  tub.y = tub
  data.frame(Ce, Oe, DC, bias, relB, B, BAref, BAprod, a, tb, ce, oe, tub,
             Ce.y, Oe.y, DC.y, bias.y, relB.y, B.y, BAref.y, BAprod.y, tb.y, ce.y, oe.y, tub.y,
             Ce.x, Oe.x, DC.x, relB.x, B.x)
}

strat_clustsizes = function(dat, N.df, mets, GetDetails = FALSE) {
  # dat= type: dataframe; column names: *.y [*.x] strat m M (strat:string, M:size of TSA(m2)x total days of the year,m:(tb+ce+oe+tub) x lapse)
  # N.df= type: dataframe; column names: strat N

  # make stratum "mixed"
  n_h = tapply(dat[,"strat"], dat[,"strat"], function(x) length(x))
  h1n = names(n_h)[n_h < 2]
  dat = dat[dat[,"m"] > 0, ]
  n_h = tapply(dat[,"strat"], dat[,"strat"], function(x) length(x))
  h1n = c(h1n, names(n_h)[n_h < 2])
  h1n = unique(h1n)
  dat = dat[!is.element(dat[,"strat"], h1n), ]
  N.df = rbind(N.df, data.frame(strat = "mixed", N = sum(N.df[is.element(N.df[,"strat"], h1n), "N"])))
  N.df = N.df[!is.element(N.df[,"strat"], h1n), ]
  withx = is.element(paste(mets, ".x", sep = ""), names(dat))
  metsonlyy = mets[!withx]
  yx = array(rep(NA, dim(dat)[1] * length(mets) * 2), dim = c(dim(dat)[1], length(mets), 2), dimnames = list(dat$id, mets, c("y", "x")))
  yx[,,"y"] = data.matrix(dat[,paste(mets, ".y", sep = "")])
  if (sum(withx) > 0) yx[,withx,"x"] = data.matrix(dat[,paste(mets[withx], ".x", sep = "")])
  n = tapply(dat[,1], dat[,"strat"], function(x) length(x))
  n = array(rep(n, length(mets)), dim = c(length(n), length(mets)), dimnames = list(names(n), mets))
  y_ = yx[,mets,"y",drop = FALSE] / dat[,"m"]
  y_ = adrop(y_, drop = 3)
  yM = apply(dat$M * y_, 2, function(a) tapply(a, dat[,"strat"], sum))
  y_h = yM / n
  x_ = yx[,mets,"x",drop = FALSE] / dat[,"m"]
  x_ = adrop(x_, drop = 3)
  xM = apply(dat$M * x_, 2, function(a) tapply(a, dat[,"strat"], sum))
  x_h = xM / n
  N = array(as.numeric(rep(N.df[,"N"], length(mets))), dim = c(dim(N.df)[1], length(mets)), dimnames = list(N.df[,"strat"], mets))
  N = N[rownames(n), , drop = FALSE]
  Yh = N * y_h
  Y = apply(Yh, 2, sum)
  Xh = N * x_h
  X = apply(Xh, 2, sum)
  X[is.na(X)] = 1 
  R = Y / X
  Ra = t(array(R, dim = c(length(R), dim(yx)[1]), dimnames = list(names(R), rownames(yx))))
  dim(Ra) = c(dim(Ra), 1)
  u = (yx[,mets,"y",drop = FALSE] - Ra * yx[,mets,"x",drop = FALSE])
  u = adrop(u, drop = 3)
  u[,metsonlyy] = yx[,metsonlyy,"y"]
  u_ = u / dat[,"m"]
  usum = apply(u, 2, function(a) tapply(a, dat[,"strat"], sum))
  Msum = tapply(dat[,"M"], dat[,"strat"], sum)
  Msum = array(rep(Msum, length(mets)), dim = c(length(Msum), length(mets)), dimnames = list(names(Msum), mets))
  U__h = usum / Msum
  U__ha = U__h[dat[,"strat"], ]
  Su2 = apply((dat[,"M"]^2) * ((u_ - U__ha)^2), 2, function(a) tapply(a, dat[,"strat"], sum)) / (n - 1)
  varR = (1 / X^2) * apply(N * (N - n) * Su2 / n, 2, sum)
  sdR = sqrt(varR)
  result = matrix(c(R, sdR), byrow = TRUE, ncol = length(mets), dimnames = list(c("R", "sdR"), mets))
  if (GetDetails) {
    ysum = apply(yx[,mets,"y",drop = FALSE], 2, function(a) tapply(a, dat[,"strat"], sum))
    Y__h = ysum / Msum
    Y__ha = Y__h[dat[,"strat"], ]
    Sy2h = apply((dat[,"M"]^2) * ((y_ - Y__ha)^2), 2, function(a) tapply(a, dat[,"strat"], sum)) / (n - 1)
    Sy2 = apply(N * (N - n) * Sy2h / n, 2, sum)
    xsum = apply(yx[,mets,"x",drop = FALSE], 2, function(a) tapply(a, dat[,"strat"], sum))
    X__h = xsum / Msum
    X__ha = X__h[dat[,"strat"], ]
    Sx2h = apply((dat[,"M"]^2) * ((x_ - X__ha)^2), 2, function(a) tapply(a, dat[,"strat"], sum)) / (n - 1)
    Sx2 = apply(N * (N - n) * Sx2h / n, 2, sum)
    resh = array(c(y_h, x_h, sqrt(Su2), sqrt(Sy2h), sqrt(Sx2h)), dim = c(dim(U__h), 5), dimnames = append(dimnames(U__h), list(c("y_", "x_", "Su", "Sy", "Sx"))))
    result = list(result, list(result, Y, X, Sy2, Sx2, U__h, Su2, N, u_, dat[,"strat"]), resh)
    names(result[[2]]) = c("result", "Y", "X", "Sy2", "Sx2", "U", "Su2", "N", "u_", "strat")
  }
  result
}
