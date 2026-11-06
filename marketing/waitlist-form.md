# SearchTrail waiting list form

Set this up in a form tool such as Tally, Google Forms or Typeform, then link the landing page's
"Join the waiting list" button to it. Keep it to about two minutes.

The form is deliberately open about audience and review tool: the answers to questions 4, 5 and 9
tell you which kind of user and which destination the demand actually comes from.

## Intro text
Thanks for your interest in SearchTrail. Tell us how your team searches Microsoft 365 today and what
goes wrong. We'll use your answers to plan our first pilots and to contact you.
(Confirm this wording matches how you'll actually use the data.)

## Questions

1. **Name** (short text, required)
2. **Work email** (email, required)
3. **Organization** (short text, optional)
4. **What kind of organization?** (single choice, required)
   - Company (in-house legal, compliance, HR or IT)
   - Law firm
   - eDiscovery or legal services provider
   - Government agency (federal)
   - Government agency (state, county or city)
   - Other
5. **What do you search Microsoft 365 for?** (multiple choice, pick all that apply)
   - Litigation and discovery
   - Internal investigations (HR, compliance, fraud)
   - Public records or FOIA requests
   - Regulatory or audit requests
   - Data subject or privacy requests
   - Other (please describe)
6. **Your role** (single choice)
   - Attorney or legal counsel
   - eDiscovery, litigation support or records staff
   - FOIA or public records officer
   - Compliance, HR or investigations
   - IT or security
   - Other
7. **Which Microsoft cloud do you use?** (single choice)
   - Commercial Microsoft 365
   - GCC
   - GCC High
   - DoD
   - Not sure
8. **Which Microsoft 365 licenses?** (single choice)
   - E5 or G5
   - E3 or G3
   - Not sure
9. **Where do Purview results go for review?** (multiple choice, pick all that apply)
   - Everlaw
   - Relativity
   - Another review tool (please name it)
   - Downloaded files we review ourselves
   - We review inside Purview
10. **About how many of these searches does your team run each month?** (single choice)
    - 1 to 5
    - 6 to 20
    - 21 to 100
    - More than 100
11. **What goes wrong with Purview results today?** (multiple choice, pick all that apply)
    - Far too many irrelevant items
    - The same message or document many times over
    - Teams chats are hard to read or arrive in fragments
    - Attachments or linked files are missing
    - Encrypted files can't be opened
    - Exporting and loading into review takes too long
    - Hard to show how we searched
    - Other (please describe)
12. **In your own words, what's the biggest headache?** (long text, optional)
13. **How would your organization prefer to run a tool like this?** (single choice)
    - A hosted service
    - Inside our own environment
    - No preference
    - Not sure
14. **Can we contact you for a 20-minute call?** (yes or no)

## Why each question matters
- **4, 5 and 6** show which audiences respond: companies, law firms, providers or government, and
  for which kind of search. That's the main thing this round of validation should answer.
- **7, 4 and 13** decide what security authorization you'd need: none if it runs inside the
  customer's environment, FedRAMP for federal or GovRAMP for state and local if it's hosted. They
  also show whether GCC High support has to come early.
- **8** tells you whether they have eDiscovery Premium, which the Graph eDiscovery APIs need.
- **9** shows which review tools matter, and how many people just want a download.
- **11 and 12** tell you what "bad results" actually means. If most answers are "far too many
  irrelevant items" or "hard to show how we searched", SearchTrail fits as designed. If most are
  duplicates or broken Teams chats, the product may need to change.
- **10** gives a rough sense of volume and how much each team could save.
