# Production Cost Model (500 Users)

Date: 2026-02-14  
Scope: Vercel + Supabase + Inngest (Deepgram excluded)

## Fixed user behavior inputs
- 500 users
- 10 new transcripts/user/week
- 2 login sessions/user/day
- 3.5 transcript visits/login
- 2 edit sessions/login
- 20 edits/edit session
- 2 exports/login

Derived monthly volume:
- Logins: 30,000
- New transcripts: 21,667
- Transcript visits: 105,000
- Edits: 1,200,000
- Exports: 60,000

## Missing-assumption inputs (scenario-driven)
- Average media size per transcript (MB)
- Fraction of media played per visited transcript
- Media retention window (months)
- Time spent on list pages per login (drives polling reads)
- Avg projects row payload (KB)
- DB footprint per transcript (MB) and DB retention window

## Pricing references used
- Vercel Pro includes 1M function invocations/month and 1TB Fast Data Transfer/month. Overage includes $0.60 per 1M invocations and regional Fast Data Transfer rates.
- Supabase Pro includes 100 GB storage, 250 GB uncached egress, 8 GB DB disk. Overage: $0.021/GB storage, $0.09/GB uncached egress, $0.125/GB DB disk.
- Inngest Pro includes 1M executions and 5M events per month. Overage: $50 per 1M executions, $0.50 per 1M events.

## Scenario output summary

| Scenario | Monthly Total | Fixed | Variable | Supabase Egress Cost | Supabase Storage Cost | Supabase DB Cost |
|---|---:|---:|---:|---:|---:|---:|
| Lean | $174.63 | $120.00 | $54.63 | $48.42 | $4.57 | $1.64 |
| Expected | $306.95 | $120.00 | $186.95 | $142.44 | $31.23 | $13.28 |
| Heavy | $939.70 | $120.00 | $819.70 | $460.99 | $264.50 | $94.21 |

## Notes
- Vercel and Inngest overages are $0 in all three scenarios at this volume.
- Supabase egress is the dominant risk driver.
- If retention is not enforced, storage and DB costs grow month-over-month.
- This model intentionally excludes Deepgram charges.

CSV for spreadsheet use:
- `.docs/cost-models/production-cost-model-500-users.csv`
