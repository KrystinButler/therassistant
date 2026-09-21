# Therassistant CRM Design Specification

**Date:** 2026-09-21  
**Product:** Therassistant CRM  
**Status:** Proposed for implementation  
**Relationship to other systems:** Standalone CRM. It is not part of the Therassistant EHR and must not depend on EHR clinical, claims, or patient-chart workflows.

## 1. Purpose

Therassistant CRM will manage collection/customer accounts and the work performed on those accounts. The existing Square Payment Desk becomes the payment function inside the CRM rather than a separate workflow.

The CRM must be simple enough for non-technical operators to use from a phone while speaking with a customer. Brandon Burelle will be the first account, but the architecture must support additional collection accounts without redesign.

## 2. Primary Users and Permissions

### Admin
The admin can:
- Create and delete CRM accounts.
- Edit all account details.
- Set and correct original balances.
- Manage CRM users.
- Perform all operator actions.
- View all account activity.

### Operator
Operators can:
- Open and work existing accounts.
- Log calls.
- Add notes.
- Set follow-up dates.
- Upload and view documents.
- Take manual Square payments.
- Generate and copy/text Square payment links.
- Create payment plans.
- Modify active payment plans.
- Generate/download payment-plan agreements.
- Upload returned signed agreements.
- Mark agreements Sent, Signed, or Declined.

Operators cannot:
- Create or delete CRM accounts.
- Manage CRM users.
- Change the original account balance.

Every write action must record the acting user and timestamp.

## 3. CRM Navigation

Primary mobile-first navigation:
- Accounts
- Follow-Ups
- Payments
- Users (admin only)

Opening an account shows:
- Overview
- Payment Plan
- Calls
- Documents
- Payments
- Notes
- Activity

The mobile account screen must place these quick actions near the top:
- Take Payment
- Text Payment Link
- Log Call
- Add Document
- Help / Call Script

Desktop layouts may use additional columns, but phone layouts must avoid wide tables and use stacked cards with large tap targets.

## 4. Collection Account

Each account includes:
- Account ID
- Account/reference number
- Customer name
- Phone
- Email
- Address
- Original balance
- Current balance
- Total payments received
- Account status
- Next follow-up date
- Created by
- Created at
- Updated at

Recommended account statuses:
- Active
- Payment Plan
- Paid
- Closed

Original balance is admin-controlled. Current balance is derived from the original balance and completed payments rather than manually maintained by operators.

## 5. Calls

Operators can create call-log entries containing:
- Automatic date/time
- Direction: inbound or outbound
- Outcome/disposition
- Notes
- Promise-to-pay amount, when applicable
- Promise-to-pay date, when applicable
- Next follow-up date
- Operator identity

Recommended dispositions:
- Paid
- Payment Plan Discussed
- Promise to Pay
- No Answer
- Left Voicemail
- Follow-Up Needed
- Dispute / Question
- Other

Saving a call may update the account's next follow-up date.

## 6. Help / Call Script

Every account includes a Help / Call Script action.

On mobile, the script opens in a slide-up or full-screen panel so an operator can read it during a call.

Script sections include:
- Opening and identity confirmation
- Explaining the outstanding balance
- Requesting payment in full
- Offering a payment plan
- Explaining installment terms
- Taking a manual card payment
- Offering a secure payment link
- Promise-to-pay follow-up
- Missed or overdue installment
- Customer cannot afford the proposed amount
- Voicemail
- Closing and confirming next steps

The script should insert account information where useful, such as customer name, current balance, and next installment amount. Script content is guidance only and does not automatically change account data.

## 7. Notes

Operators can add general account notes separate from call logs.

Each note stores:
- Account ID
- Note text
- Author
- Created timestamp

Notes are append-only in the activity history. If editing is later added, the system must preserve an audit trail.

## 8. Documents

Documents are account-specific and stored privately in Supabase Storage.

Supported initial document types:
- PDF
- Word documents
- Images/photos
- Other ordinary office files that Supabase Storage accepts within configured size limits

Document metadata includes:
- Account ID
- Display name
- Storage path
- MIME type
- File size
- Document category
- Uploaded by
- Uploaded at

Recommended categories:
- Invoice
- Contract
- Correspondence
- Collection Notice
- Payment Plan Agreement
- Signed Payment Plan Agreement
- Other

Users must access files through authenticated, time-limited retrieval rather than public bucket URLs.

The mobile workflow must support uploading a file or photo directly from the device.

## 9. Payments

The existing Square Payment Desk remains the payment processor.

Payments are linked to a CRM account.

A completed payment stores or references:
- CRM account ID
- Square payment ID
- Amount
- Currency
- Payment status
- Receipt URL
- Card brand
- Card last four
- Operator
- Date/time
- Optional payment-plan installment ID

No full card number or CVV may be stored in Therassistant.

Completed payments reduce the account's derived current balance. Failed payments do not reduce the balance.

The existing idempotency protection remains in place.

## 10. Text Payment Link

Operators can generate a Square-hosted payment link for:
- Full current balance
- Next payment-plan installment
- Custom amount

The CRM must provide:
- Copy Link
- Text Payment Link

On a mobile device, Text Payment Link opens the device's messaging application with:
- Customer phone number
- Prewritten message
- Amount
- Secure Square payment URL

The CRM itself does not send SMS in the initial version.

Payment-link generation should be logged in Activity with the amount and operator. If Square webhook support is implemented in this phase, successful payment-link payments should reconcile automatically to the account. If not, manual reconciliation remains available and webhook reconciliation is a follow-up enhancement.

## 11. Payment Plans

Operators can create and modify payment plans.

Plan fields:
- Account ID
- Plan status
- Balance at plan creation
- Down payment
- Remaining balance
- Frequency: weekly, biweekly, monthly
- First installment date
- Installment amount
- Number of installments
- Final installment amount
- Final installment date
- Grace period, if used
- Special terms/notes
- Agreement status
- Created by
- Created at
- Updated by
- Updated at

Recommended plan statuses:
- Draft
- Active
- Completed
- Defaulted
- Cancelled

Agreement statuses:
- Not Generated
- Generated
- Sent
- Signed
- Declined

The CRM calculates the installment schedule. The final installment may differ from the regular installment amount to avoid rounding errors.

Operators can modify an active payment plan. A material change must:
1. Preserve the prior plan version in activity/history.
2. Recalculate the future schedule.
3. Generate a new agreement version.
4. Mark the revised agreement as requiring delivery/signature.

No electronic signature system is included.

## 12. Installments

Each payment plan has individual installment records:
- Sequence number
- Due date
- Amount due
- Amount paid
- Status
- Payment ID, when satisfied
- Paid date

Recommended installment statuses:
- Upcoming
- Due
- Paid
- Partial
- Overdue
- Waived

The CRM must show the next installment prominently on the account.

Manual Square payments can be applied to the next installment or a selected installment. Payments exceeding one installment may be allocated across multiple installments in chronological order.

## 13. Agreement Generation

The CRM includes a built-in payment-plan agreement template.

The generated agreement includes:
- Therassistant business information
- Customer information
- CRM account/reference number
- Balance being resolved
- Down payment, if applicable
- Installment amount
- Frequency
- Full payment schedule
- First payment date
- Final payment date
- Special terms
- Missed-payment/default language
- Modification language
- Customer acknowledgment
- Signature and date lines
- Agreement ID
- Agreement version
- Generation date

Workflow:
1. Operator creates or modifies a plan.
2. CRM generates the agreement.
3. Operator downloads the agreement.
4. Operator emails it using their normal email account.
5. Returned signed agreement is uploaded to Documents.
6. Operator marks agreement Signed, Declined, or Sent as appropriate.

The CRM does not send email and does not provide electronic signatures.

The exact legal/business wording of the agreement must be approved by the admin before production use.

## 14. Follow-Up Worklist

The CRM has a Follow-Ups screen showing accounts requiring attention.

An account can enter the worklist because of:
- Manually assigned follow-up date
- Promise-to-pay date
- Overdue payment-plan installment
- Operator-selected Follow-Up Needed disposition

Each item shows:
- Customer
- Current balance
- Reason
- Due date
- Last contact
- Quick action to open the account

No automated customer reminders are sent.

## 15. Activity Timeline

Each account has one chronological activity timeline combining:
- Account creation
- Calls
- Notes
- Document uploads
- Agreement generation/status changes
- Payment-plan creation and modification
- Payment-plan installment status changes
- Manual Square payments
- Payment-link generation
- Follow-up changes

Each activity entry records:
- Activity type
- Timestamp
- Acting user
- Human-readable summary
- Related record ID when applicable

The timeline is intended as an operational audit trail and should not silently lose historical events when source records are updated.

## 16. Data Model

New tables:
- `crm_accounts`
- `crm_calls`
- `crm_notes`
- `crm_documents`
- `crm_payment_plans`
- `crm_payment_plan_versions`
- `crm_installments`
- `crm_activity`

Existing table changes:
- `payment_desk_transactions`: add nullable `crm_account_id`
- `payment_desk_transactions`: add nullable `crm_installment_id` if installment allocation is direct

Storage:
- Private Supabase Storage bucket for CRM documents.

All new public-schema tables must have Row Level Security enabled. Direct browser access should be minimized; sensitive operations should continue through authenticated backend APIs consistent with the existing Payment Desk architecture.

## 17. Backend/API

The existing authenticated Payment Desk API can be expanded or a dedicated CRM Edge Function can be introduced. The preferred design is a dedicated `crm-api` Edge Function so collections features remain isolated from Square payment-processing code.

The CRM API handles:
- Account reads/writes
- Calls
- Notes
- Follow-ups
- Payment plans and schedules
- Agreement metadata
- Document metadata and signed upload/download URLs
- Activity
- Admin-only account creation/deletion

The existing `payment-desk-api` continues handling Square payment operations and gains CRM-account linkage.

Both APIs authorize users against the same Therassistant CRM/Payment Desk user access model.

## 18. Frontend

The CRM frontend is hosted on the existing Vercel-backed Therassistant application.

Recommended routes:
- `/crm`
- `/crm/accounts/:id`
- Existing `/payment-desk` can remain as a compatibility entry point or redirect into the CRM payment workflow.

The app must be responsive and usable in current mobile browsers.

## 19. Initial Brandon Migration

Brandon Burelle is created as the first CRM account.

Existing Brandon Payment Desk transactions should be linked to his CRM account when they can be confidently identified.

No existing transaction should be linked based only on an unsafe guess. Ambiguous transactions remain unlinked until reviewed.

Existing documents, if any, can then be uploaded to his CRM account.

## 20. Explicitly Out of Scope

This CRM does not include:
- Therassistant EHR integration
- Clinical data or patient charts
- Claims or billing workqueues
- Electronic signatures
- Automatic recurring card charges
- Stored card-on-file charging
- Automatic payment retries
- Customer payment reminder texts
- CRM-sent email
- CRM-sent SMS in the initial version
- Patient collections functionality for healthcare encounters

## 21. Security and Audit Requirements

- Never store PAN or CVV.
- Keep Square access tokens server-side only.
- Keep the Supabase secret/service role server-side only.
- Use a private Storage bucket.
- Use time-limited authenticated file access.
- Enable RLS on all exposed-schema CRM tables.
- Preserve operator identity and timestamps for mutations.
- Enforce admin-only account creation/deletion and user management on the backend, not only in the UI.
- Run Supabase security advisors after schema/storage/auth changes.
- Keep payment idempotency controls.
- Do not expose CRM documents through public URLs.

## 22. Success Criteria

The first production release is successful when:
1. Admin can create Brandon's CRM account.
2. Operator can open it on a phone.
3. Operator can log a call and set a follow-up.
4. Operator can upload and retrieve a private document.
5. Operator can add a note.
6. Operator can take a Square payment linked to Brandon.
7. Operator can create a payment plan and see its installment schedule.
8. Operator can generate/download the agreement.
9. Operator can upload the returned signed agreement.
10. Operator can create/copy/text a Square payment link.
11. Account balance and installment statuses update correctly from completed manual payments.
12. Activity shows the major account events with user and timestamp.
13. Operator cannot create/delete CRM accounts or manage users.
14. Admin retains those privileged actions.
15. The CRM remains fully separate from the Therassistant EHR.
