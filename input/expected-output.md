# What you should see

The customer uploads plans or types. The officer screen has no input, so it only watches. The inputs are in `customer-chat.txt`.

To start a new run, open http://localhost:5173 and upload the plan or type the first line. Copy the URL into a second window and change `/permits/` to `/office/`. That window is the officer side.

The chat replies are written by the model, so their wording changes between runs. The findings, statuses, and numbers do not.

The steps below are the typed run. The run with plans comes after them.

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

# The run with plans

This run uses `sample-deck-plan.pdf` and `sample-deck-plan-revised.pdf` from this folder. Each plan takes about 5 seconds to read.

## Plan step 1. Upload sample-deck-plan.pdf and click Start my pre-review

**Customer.** The chat shows "Attached plan: sample-deck-plan.pdf". The reply says what the file is and lists what it read: 16 ft long, 12 ft wide, 36 in above the ground, attached, the ledger, an 18 ft rear setback, a 36 in railing, an exit door, and a door landing. The whole sheet fills in, and nothing stays UNKNOWN. The address is the project site, not the drafting studio in Campbell. The setback is the deck's 18 ft, not the house's 30 ft. The button reads "Run pre-review".

**Officer.** The title changes to the address, and the header adds 16 × 12 ft, 36 in above grade, attached. Status stays Intake, revision 1. All four checklist rows say Waiting.

## Plan step 2. Paste "yes, that's right"

**Customer.** The chat accepts it and says it has all it needs. The sheet does not change.

**Officer.** Nothing changes.

## Plan step 3. Click Run pre-review

**Customer.** Four cards arrive. The connection card passes this time, because the plan shows the ledger.

| Card | Status |
| --- | --- |
| Your deck needs a building permit | PASS |
| Your railing needs to be taller | CORRECTION |
| Connection details are noted | PASS |
| A City planner needs to check this one | NEEDS HUMAN VERIFICATION |

The chat explains the railing, and says you can tell it the change or upload a revised plan.

**Officer.** The same as the typed run, except that Ledger connection to the house shows PASS. A yellow banner says "Waiting for the homeowner: Guard height needs attention."

## Plan step 4. Upload sample-deck-plan-revised.pdf and click Send

This takes about 15 seconds.

**Customer.** The reply lists the plan again with a 42 in railing, then shows the REVISION 2 SUBMITTED tag. The sheet changes to 42 in and Revision 2. The railing card flips to PASS, and the chat offers "Go to the packet".

**Officer.** The header says Revision 2. Guard height reruns and flips to PASS. Ledger connection can rerun too, because the model can word the ledger differently on a second read. It stays PASS. The feed ends with "Pre-review complete. SJ-ZONING-01 carries into the packet." A green banner says "Carried into the packet: Rear setback."

## Plan step 5. Click Go to the packet

**Customer.** The same packet as the typed run, with the plan's ledger and the 18 ft setback filled in. The Still required list has four items, because the ledger is no longer open.

**Officer.** Nothing changes.

## What must never appear

- The word "approved" as a result.
- A permit number or a city seal.
- Raw JSON on either screen.
