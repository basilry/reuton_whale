export type KimchiPremiumInput = {
  usdPrice: number;
  krwPrice: number;
  usdKrwFx: number;
};

export type KimchiPremiumSnapshot = {
  premiumPct: number;
  impliedFairKrw: number;
};

export function calcKimchiPremium({
  usdPrice,
  krwPrice,
  usdKrwFx,
}: KimchiPremiumInput): KimchiPremiumSnapshot {
  const impliedFairKrw = usdPrice * usdKrwFx;
  const premiumPct = ((krwPrice / impliedFairKrw) - 1) * 100;

  return {
    premiumPct,
    impliedFairKrw,
  };
}

export function calcOptionalKimchiPremium(input: {
  usdPrice: number | null;
  krwPrice: number | null;
  usdKrwFx: number | null;
}): KimchiPremiumSnapshot | null {
  if (
    input.usdPrice == null ||
    input.krwPrice == null ||
    input.usdKrwFx == null ||
    !Number.isFinite(input.usdPrice) ||
    !Number.isFinite(input.krwPrice) ||
    !Number.isFinite(input.usdKrwFx) ||
    input.usdPrice <= 0 ||
    input.krwPrice <= 0 ||
    input.usdKrwFx <= 0
  ) {
    return null;
  }

  return calcKimchiPremium({
    usdPrice: input.usdPrice,
    krwPrice: input.krwPrice,
    usdKrwFx: input.usdKrwFx,
  });
}
