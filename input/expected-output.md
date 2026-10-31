# What you should see

The customer types. The officer screen has no input, so it only watches. The inputs are in `customer-chat.txt`.

To start a new run, open http://localhost:5173 and type the first line. Copy the URL into a second window and change `/permits/` to `/office/`. That window is the officer side.

The chat replies are written by the model, so their wording changes between runs. The findings, statuses, and numbers do not.

## Step 1. Paste the address line

**Customer.** The application sheet fills in 14630 Noble Ave, APN 59531001, zoning R-1-8, 16 ft, 12 ft, and 192 sq ft. The chat asks how high the deck is. The button reads "Still needed: height, attached or freestanding".

**Officer.** The title changes from "Address not confirmed yet" to the address. Status stays Intake, revision 1. All four checklist rows say Waiting. The Relay feed says "No messages yet."

## Step 2. Paste the height and railing line

**Customer.** The sheet shows 36 in high, Attached, and a 36 in railing. Ledger and Rear setback stay UNKNOWN. The button changes to "Run pre-review".

**Officer.** The header adds 16 × 12 ft, 36 in above grade, attached. Nothing else moves, because the review has not started.

## Step 3. Click Run pre-review

This takes about 8 seconds.

**Customer.** The button says Reviewing, then four cards arrive under "What the reviewers found".

| Card | Status |
| --- | --- |
| Your deck needs a building permit | PASS |
| Your railing needs to be taller | CORRECTION |
| Show how the deck connects | NEEDS INFORMATION |
| A City planner needs to check this one | NEEDS HUMAN VERIFICATION |

The chat then explains that the railing is 36 in and must be at least 42 in, and cites 2025 CRC R321.1.1, R321.1.2. The steps at the top stop on Make changes.

**Officer.** The stepper moves through Ready, In review, and Corrections. The checklist pills show Reviewing…, then the same four results. A yellow banner says "Waiting for the homeowner: Guard height needs attention." The Relay feed shows Intake, Clerk, Building, and Zoning talking, and ends with "Sent back to the homeowner: CRC-GUARD-01 needs attention." The audit trail lists each status change.

## Step 4. Paste the railing fix

This takes about 8 seconds.

**Customer.** The chat shows a REVISION 2 SUBMITTED tag. The sheet changes to 42 in and Revision 2. The railing card flips to PASS and now reads "Your railing height works". The PRE-REVIEW COMPLETE stamp lands on the sheet, and the chat offers "Go to the packet".

**Officer.** The header says Revision 2. Only Guard height reruns and flips to PASS. The other three keep their results. The feed shows "Zoning finished revision 2: nothing in its scope changed." and ends with "Pre-review complete. SJ-ZONING-01 and SJ-DETAIL-01 carry into the packet." The stepper finishes on Pre-review complete, and a green banner says "Carried into the packet: Rear setback, Ledger connection to the house." Those two items can appear in either order, here and in the feed.

## Step 5. Click Go to the packet

**Customer.** The Draft permit packet opens under a red UNOFFICIAL DRAFT banner. It has the project summary, the property with its city source and time, all four findings with citations and links, a Still required list of five items, how to file at SJPermits, and a Print button.

**Officer.** Nothing changes.

## What must never appear

- The word "approved" as a result.
- A permit number or a city seal.
- Raw JSON on either screen.
