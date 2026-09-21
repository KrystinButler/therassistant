import test from "node:test";import assert from "node:assert/strict";import {readFileSync} from "node:fs";
const detail=readFileSync(new URL("../src/domains/crm/AccountDetailPage.tsx",import.meta.url),"utf8");
const css=readFileSync(new URL("../src/domains/crm/crm.css",import.meta.url),"utf8");
const script=readFileSync(new URL("../src/domains/crm/call-script.ts",import.meta.url),"utf8");
test("account page exposes mobile quick actions",()=>{for(const label of ["Take Payment","Text Payment Link","Log Call","Add Document","Help / Call Script"])assert.match(detail,new RegExp(label));});
test("call script covers core collection scenarios",()=>{assert.match(script,/payment in full/i);assert.match(script,/payment plan/i);assert.match(script,/voicemail/i);assert.match(script,/cannot pay|cannot afford|cannot/i);});
test("CRM CSS has phone breakpoint and touch targets",()=>{assert.match(css,/@media\(max-width:640px\)/);assert.match(css,/min-height:44px/);assert.doesNotMatch(css,/min-width:\s*[89]\d{2}px/);});

test("follow-up worklist groups overdue today and upcoming",()=>{const follow=readFileSync(new URL("../src/domains/crm/FollowUpsPage.tsx",import.meta.url),"utf8");assert.match(follow,/Overdue/);assert.match(follow,/Today/);assert.match(follow,/Upcoming/);});
