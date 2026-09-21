import type { CrmAccount, CrmPaymentPlan } from "./types";

function money(cents:number){return new Intl.NumberFormat("en-US",{style:"currency",currency:"USD"}).format(cents/100);}

export function buildCallScript(account:CrmAccount, plan?:CrmPaymentPlan|null) {
  const balance=money(account.currentBalanceCents);
  const installment=plan ? money(plan.installment_cents) : null;
  return [
    {title:"Opening / identity confirmation",body:`Hello, may I speak with ${account.customer_name}? This is [your name] calling on behalf of Therassistant regarding account ${account.account_number}. Before discussing the account, please confirm I am speaking with the correct person.`},
    {title:"Outstanding balance",body:`The current balance on the account is ${balance}. I am calling to discuss resolving that balance.`},
    {title:"Request payment in full",body:`Are you able to make payment in full for ${balance} today?`},
    {title:"Offer a payment plan",body:installment?`Your current payment plan is approximately ${installment} per installment. Would you like to review the schedule?`:"If paying the balance in full is not workable, we can discuss a payment plan and calculate installments that fit the account balance."},
    {title:"Secure payment link",body:"If you would rather enter your card yourself, I can text you a secure Square payment link. I will confirm the amount before sending it."},
    {title:"Promise to pay follow-up",body:"I am documenting the date and amount you have agreed to pay. I will confirm those details with you before ending the call."},
    {title:"Missed / overdue installment",body:"The scheduled installment has not been recorded as paid. I am calling to see whether you can make that payment today or whether the plan terms need to be reviewed."},
    {title:"If the customer cannot pay the proposed amount",body:"What amount and timing would be realistic for you? I can document that information and review the available payment-plan options."},
    {title:"Voicemail",body:"Hello, this is [your name] calling from Therassistant for " + account.customer_name + ". Please return our call regarding your account. Please do not leave payment card information in voicemail."},
    {title:"Closing",body:"Before we end the call, I want to confirm the next step and date we discussed. Thank you."},
  ];
}
