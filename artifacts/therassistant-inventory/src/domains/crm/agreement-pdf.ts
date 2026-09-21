import type { CrmAccount, CrmInstallment, CrmPaymentPlan } from "./types";

export const THERASSISTANT_AGREEMENT_BUSINESS = {
  name: "Therassistant LLC",
  phone: "303.500.2872",
  email: "admin@therassistant.com",
  website: "therassistant.com",
};

type AgreementLine = { text:string; bold?:boolean; size?:number; spaceAfter?:number };
export type AgreementModel = { agreementId:string; version:number; generatedDate:string; fileName:string; lines:AgreementLine[] };

const money=(c:number)=>new Intl.NumberFormat("en-US",{style:"currency",currency:"USD"}).format(c/100);
const formatDate=(d:string)=>new Date(d+"T00:00:00").toLocaleDateString("en-US",{year:"numeric",month:"long",day:"numeric"});

export function buildAgreementModel(account:CrmAccount,plan:CrmPaymentPlan,installments:CrmInstallment[]):AgreementModel{
  const version=Math.max(1,plan.agreement_version||1);
  const agreementId="TA-"+account.account_number+"-P"+plan.id.slice(0,8)+"-V"+version;
  const generatedDate=new Date().toLocaleDateString("en-US");
  const lines:AgreementLine[]=[
    {text:"THERASSISTANT PAYMENT PLAN AGREEMENT",bold:true,size:16,spaceAfter:8},
    {text:"DRAFT TEMPLATE - REVIEW BEFORE USE",bold:true,size:10,spaceAfter:10},
    {text:"Agreement ID: "+agreementId+"    Version: "+version+"    Generated: "+generatedDate},
    {text:"Creditor/Account Administrator: "+THERASSISTANT_AGREEMENT_BUSINESS.name},
    {text:"Contact: "+THERASSISTANT_AGREEMENT_BUSINESS.phone+" | "+THERASSISTANT_AGREEMENT_BUSINESS.email+" | "+THERASSISTANT_AGREEMENT_BUSINESS.website,spaceAfter:8},
    {text:"Customer: "+account.customer_name},
    {text:"Account/Reference Number: "+account.account_number},
    {text:"Balance at Plan Creation: "+money(plan.balance_at_creation_cents)},
    {text:"Down Payment: "+money(plan.down_payment_cents)},
    {text:"Amount Scheduled After Down Payment: "+money(plan.remaining_balance_cents),spaceAfter:10},
    {text:"PAYMENT TERMS",bold:true,size:12},
    {text:"The customer agrees to make payments according to the payment schedule below. Regular installments are "+money(plan.installment_cents)+" on a "+plan.frequency+" basis, beginning "+formatDate(plan.first_installment_date)+". The final installment may differ so the schedule equals the plan balance exactly."},
    {text:"Payments will be initiated manually by the customer or a Therassistant operator. The customer may pay by telephone through the secure Square Payment Desk or through a secure Square payment link.",spaceAfter:8},
    {text:"PAYMENT SCHEDULE",bold:true,size:12},
  ];
  for(const item of installments){
    lines.push({text:"Installment "+item.sequence_number+": "+formatDate(item.due_date)+" - "+money(item.amount_due_cents)});
  }
  lines.push(
    {text:"",spaceAfter:4},
    {text:"MISSED PAYMENTS",bold:true,size:12},
    {text:"If an installment is missed or remains unpaid after any stated grace period, the unpaid amount remains due. Therassistant may contact the customer to request payment or discuss a revised payment plan. A missed installment does not by itself change the written payment schedule.",spaceAfter:8},
    {text:"MODIFICATIONS",bold:true,size:12},
    {text:"Any material modification to the amount, frequency, due dates, or number of installments should be documented in a revised payment-plan agreement. Prior versions will remain part of the account record.",spaceAfter:8},
    {text:"CUSTOMER ACKNOWLEDGMENT",bold:true,size:12},
    {text:"By signing below, the customer acknowledges the account and payment schedule stated in this agreement and agrees to make the listed payments. This document does not authorize automatic debits; each payment must be manually initiated.",spaceAfter:12},
  );
  if(plan.special_terms){
    lines.push({text:"SPECIAL TERMS",bold:true,size:12},{text:plan.special_terms,spaceAfter:12});
  }
  lines.push(
    {text:"Customer Signature: __________________________________________"},
    {text:"Printed Name: ______________________________________________"},
    {text:"Date: ______________________",spaceAfter:12},
    {text:"Therassistant Representative: _________________________________"},
    {text:"Date: ______________________"},
  );
  return {agreementId,version,generatedDate,fileName:"Therassistant-Payment-Plan-"+account.account_number+"-v"+version+".pdf",lines};
}

function ascii(value:string){return value.replace(/[^\x20-\x7E]/g," ");}
function escapePdf(value:string){return ascii(value).replace(/\\/g,"\\\\").replace(/\(/g,"\\(").replace(/\)/g,"\\)");}
function wrap(text:string,max=92){
  if(!text)return [""];
  const words=ascii(text).split(/\s+/);const out:string[]=[];let line="";
  for(const word of words){const next=line?line+" "+word:word;if(next.length>max&&line){out.push(line);line=word;}else line=next;}
  if(line)out.push(line);return out;
}
function byteLength(value:string){return new TextEncoder().encode(value).length;}

export function renderAgreementPdf(model:AgreementModel):Uint8Array{
  const flat:AgreementLine[]=[];
  for(const line of model.lines){
    for(const part of wrap(line.text,line.size&&line.size>=14?70:92))flat.push({...line,text:part});
    if(line.spaceAfter)flat.push({text:"",spaceAfter:line.spaceAfter});
  }
  const pages:AgreementLine[][]=[];let page:AgreementLine[]=[];let y=742;
  for(const line of flat){
    const step=(line.size??10)+4+(line.spaceAfter??0);
    if(y-step<55&&page.length){pages.push(page);page=[];y=742;}
    page.push(line);y-=step;
  }
  if(page.length||!pages.length)pages.push(page);

  const fontRegularId=3+pages.length*2;
  const fontBoldId=fontRegularId+1;
  const objects:string[]=[];
  objects[1]="<< /Type /Catalog /Pages 2 0 R >>";
  const kids=pages.map((_,i)=>String(3+i*2)+" 0 R").join(" ");
  objects[2]="<< /Type /Pages /Count "+pages.length+" /Kids ["+kids+"] >>";
  pages.forEach((lines,index)=>{
    const pageId=3+index*2;const contentId=pageId+1;let yy=742;let stream="";
    for(const line of lines){
      const size=line.size??10;const font=line.bold?"F2":"F1";
      if(line.text)stream+="BT /"+font+" "+size+" Tf 50 "+yy+" Td ("+escapePdf(line.text)+") Tj ET\n";
      yy-=size+4+(line.spaceAfter??0);
    }
    objects[pageId]="<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 "+fontRegularId+" 0 R /F2 "+fontBoldId+" 0 R >> >> /Contents "+contentId+" 0 R >>";
    objects[contentId]="<< /Length "+byteLength(stream)+" >>\nstream\n"+stream+"endstream";
  });
  objects[fontRegularId]="<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  objects[fontBoldId]="<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>";

  let pdf="%PDF-1.4\n";const offsets:number[]=[0];
  for(let id=1;id<objects.length;id++){offsets[id]=byteLength(pdf);pdf+=String(id)+" 0 obj\n"+objects[id]+"\nendobj\n";}
  const xref=byteLength(pdf);
  pdf+="xref\n0 "+objects.length+"\n0000000000 65535 f \n";
  for(let id=1;id<objects.length;id++)pdf+=String(offsets[id]).padStart(10,"0")+" 00000 n \n";
  pdf+="trailer\n<< /Size "+objects.length+" /Root 1 0 R >>\nstartxref\n"+xref+"\n%%EOF\n";
  return new TextEncoder().encode(pdf);
}

export function downloadPaymentPlanAgreement(account:CrmAccount,plan:CrmPaymentPlan,installments:CrmInstallment[]){
  const model=buildAgreementModel(account,plan,installments);
  const bytes=renderAgreementPdf(model);
  const arrayBuffer=bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength) as ArrayBuffer;
  const blob=new Blob([arrayBuffer],{type:"application/pdf"});
  const url=URL.createObjectURL(blob);
  const anchor=document.createElement("a");
  anchor.href=url;anchor.download=model.fileName;anchor.click();
  setTimeout(()=>URL.revokeObjectURL(url),1500);
  return model;
}
