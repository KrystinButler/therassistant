export type ServiceLineValues = { cptCode:string; modifier1:string; units:number; chargeAmountCents:number; placeOfService:string };
type Existing = Record<string,unknown>;
export function validateServiceLineValues(v:ServiceLineValues):void {
  if (!/^[A-Z0-9]{4,5}$/.test(v.cptCode)) throw new Error("Enter a valid 4–5 character CPT/HCPCS code.");
  if (v.modifier1 && !/^[A-Z0-9]{2}$/.test(v.modifier1)) throw new Error("Modifier must be two characters.");
  if (!Number.isInteger(v.units) || v.units<1) throw new Error("Units must be a whole number greater than zero.");
  if (!Number.isInteger(v.chargeAmountCents) || v.chargeAmountCents<=0) throw new Error("Enter a charge amount greater than $0.");
  if (!/^\d{2}$/.test(v.placeOfService)) throw new Error("Enter a two-digit place-of-service code.");
}
export function normalizedServiceLine(input:{cptCode:string;modifier1:string;units:number;chargeDollars:string;placeOfService:string}):ServiceLineValues{
  const dollars=Number(input.chargeDollars);
  const result={cptCode:input.cptCode.trim().toUpperCase(),modifier1:input.modifier1.trim().toUpperCase(),units:input.units,
    chargeAmountCents:input.chargeDollars.trim()&&Number.isFinite(dollars)?Math.round(dollars*100):0,placeOfService:input.placeOfService.trim()};
  validateServiceLineValues(result);
  return result;
}
export function matchingServiceLineExists(rows:Existing[],values:ServiceLineValues){
  return rows.some(row=>String(row.cpt_hcpcs_code??"").trim().toUpperCase()===values.cptCode&&
    String(row.modifier1??"").trim().toUpperCase()===values.modifier1&&
    String(row.place_of_service_code??"").trim()===values.placeOfService);
}
