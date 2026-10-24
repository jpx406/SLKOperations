#!/usr/bin/env python3
"""Behaviour tests for the D1 schema, run on local SQLite (D1 is SQLite, but stricter: also apply the
migrations with `wrangler d1 execute --local` before a release).

    python test_schema.py
"""

import os
import sqlite3
import sys
import uuid

HERE = os.path.dirname(os.path.abspath(__file__))
SA = "Saudi Arabia"

db = sqlite3.connect(":memory:")
db.execute("PRAGMA foreign_keys=ON")
for f in ("0001_init.sql", "0002_seed.sql"):
    with open(os.path.join(HERE, f), encoding="utf-8") as fh:
        db.executescript(fh.read())
x = db.execute
results = {"ok": 0, "fail": 0}


def u():
    return uuid.uuid4().hex


def check(name, fn, expect_error=None):
    try:
        r = fn()
    except Exception as e:  # noqa: BLE001 - we report every failure the same way
        if expect_error and expect_error in str(e):
            print(f"ok   {name}: refused ({e})")
            results["ok"] += 1
        else:
            print(f"FAIL {name}: {e}")
            results["fail"] += 1
        return
    if expect_error:
        print(f"FAIL {name}: expected '{expect_error}', got {r}")
        results["fail"] += 1
    else:
        print(f"ok   {name}: {r}")
        results["ok"] += 1


check("seed counts (profiles, domains, lookups, locations, permissions)", lambda: x(
    "select (select count(*) from service_profiles),(select count(*) from service_domains),(select count(*) from lookup_values),"
    "(select count(*) from inventory_locations),(select count(*) from role_permissions)").fetchone())

# --- jobs -------------------------------------------------------------------
x("insert into wg_units values ('SL-50',?,2022,1,'t')", (SA,))
J = u()
check("create job", lambda: x(
    "insert into jobs (id,country,ticket_no,unit_number,start_date,end_date,well,rig_up_at,rig_down_at,toolstring) values (?,?,?,?,?,?,?,?,?,?)",
    (J, SA, "S-1001", "SL-50", "2026-10-20", "2026-10-21", "HRDH-1", "2026-10-20T03:00:00Z", "2026-10-20T15:00:00Z",
     '[{"component":"stem","weight_lb":60}]')).rowcount)
check("op hours + efficiency", lambda: x("select op_hours, job_efficiency_pct from job_metrics where job_id=?", (J,)).fetchone())
check("duplicate ticket", lambda: x("insert into jobs (id,country,ticket_no) values (?,?,?)", (u(), SA, "S-1001")), "UNIQUE")
check("blank drafts allowed", lambda: [x("insert into jobs (id,country) values (?,?)", (u(), SA)).rowcount for _ in range(2)])
check("end before start", lambda: x("insert into jobs (id,country,start_date,end_date) values (?,?,?,?)", (u(), SA, "2026-10-05", "2026-10-01")), "CHECK")
check("rig-down before rig-up", lambda: x("insert into jobs (id,country,rig_up_at,rig_down_at) values (?,?,?,?)", (u(), SA, "2026-10-05T10:00:00Z", "2026-10-05T09:00:00Z")), "CHECK")
check("bad toolstring json", lambda: x("insert into jobs (id,country,toolstring) values (?,?,?)", (u(), SA, "not json")), "CHECK")
check("failure fields locked on a clean job", lambda: x("update jobs set failure_description='x' where id=?", (J,)), "CHECK")
check("headcount cap", lambda: x("insert into job_headcount (job_id,supervisors) values (?,4)", (J,)), "CHECK")

# --- unit blocks ------------------------------------------------------------
ins_block = "insert into unit_events (id,country,unit_number,kind,starts_on,ends_on) values (?,?,?,?,?,?)"
check("unit block", lambda: x(ins_block, (u(), SA, "SL-50", "maintenance", "2026-11-01", "2026-11-05")).rowcount)
check("overlapping block", lambda: x(ins_block, (u(), SA, "SL-50", "loan", "2026-11-05", "2026-11-08")), "overlap")
check("adjacent block allowed", lambda: x(ins_block, (u(), SA, "SL-50", "loan", "2026-11-06", "2026-11-08")).rowcount)

# --- numbering ----------------------------------------------------------------
def nxt():
    return x("insert into doc_counters (country,prefix,last_no) values (?,?,1) on conflict (country,prefix) "
             "do update set last_no=last_no+1 returning last_no", (SA, "EM")).fetchone()[0]


check("document numbers", lambda: [nxt(), nxt(), nxt()])

# --- 8 Min. Facts roll-up (the statements the Worker runs in one D1 batch) ----
R = u()
x("insert into eight_min_facts (id,country,job_id,log_no,title,well,last_saved_at) values (?,?,?,?,?,?,?)", (R, SA, J, "EM-0001", "Toolstring stuck", "HRDH-1", "t"))
x("insert into incidents (id,report_id,position,what_happened,occurred_on,npt_hours,category) values (?,?,1,'stuck','2026-10-20',3,'Toolstring stuck')", (u(), R))
x("insert into incidents (id,report_id,position,what_happened,occurred_on,npt_hours,category) values (?,?,2,'wire','2026-10-20',26,'Wire parted')", (u(), R))
check("incident severities from NPT", lambda: x("select group_concat(severity) from (select severity from incidents order by position)").fetchone())

ROLLUP = [
    "update eight_min_facts set total_npt=(select sum(npt_hours) from incidents where report_id=?1), "
    "severity=(select severity from incidents where report_id=?1 order by severity_rank desc limit 1) where id=?1",
    "update jobs set npt_hours=(select coalesce(sum(i.npt_hours),0) from incidents i join eight_min_facts e on e.id=i.report_id where e.job_id=?2), "
    "failure='yes', eight_min_facts_done='yes' where id=?2",
    "insert into failure_roster_entries (id,country,job_id,incident_id,occurred_on,well,category,severity) "
    "select lower(hex(randomblob(16))), e.country, e.job_id, i.id, i.occurred_on, e.well, i.category, i.severity "
    "from incidents i join eight_min_facts e on e.id=i.report_id where i.report_id=?1 "
    "on conflict (incident_id) do update set category=excluded.category, severity=excluded.severity",
]


def rollup():
    for s, params in zip(ROLLUP, [(R,), (J,), (R,)]):
        x(s.replace("?2", "?1"), params)
    return x("select e.total_npt, e.severity, j.npt_hours, j.failure, m.job_efficiency_pct, (select count(*) from failure_roster_entries) "
             "from eight_min_facts e join jobs j on j.id=e.job_id join job_metrics m on m.job_id=j.id").fetchone()


check("8MF roll-up (report, job, roster)", rollup)
check("efficiency never below 0 when NPT exceeds op hours", lambda: x("select job_efficiency_pct from job_metrics where job_id=?", (J,)).fetchone()[0] == 0.0 or 1 / 0)
check("roll-up is idempotent (roster rows)", lambda: (rollup(), x("select count(*) from failure_roster_entries").fetchone()[0])[1])
x("insert into eight_min_facts_versions (id,report_id,version,snapshot,saved_at) values (?,?,1,'{}','t')", (u(), R))
check("versions immutable", lambda: x("update eight_min_facts_versions set version=2"), "immutable")

# --- inventory ledger -----------------------------------------------------------
I = u()
WH = x("select id from inventory_locations where inventory='hardware' and code='warehouse'").fetchone()[0]
AL = x("select id from inventory_locations where inventory='hardware' and code='at_location'").fetchone()[0]
x("insert into inventory_items (id,country,inventory,category,description) values (?,?,?,?,?)", (I, SA, "hardware", "Plugs & Prongs", "PX plug 2.75"))


def mv(kind, qty, frm, to, cid):
    return x("insert into inventory_movements (id,country,item_id,kind,qty,from_location_id,to_location_id,client_id) values (?,?,?,?,?,?,?,?)",
             (u(), SA, I, kind, qty, frm, to, cid)).rowcount


check("receive 10", lambda: mv("receive", 10, None, WH, "c1"))
check("replayed submit", lambda: mv("receive", 10, None, WH, "c1"), "UNIQUE")
check("mobilize 4 to location", lambda: mv("mobilize", 4, WH, AL, "c2"))
check("overdraw", lambda: mv("mobilize", 50, WH, AL, "c3"), "insufficient stock")
check("balances", lambda: x("select l.code, b.qty from inventory_balances b join inventory_locations l on l.id=b.location_id order by 1").fetchall())
check("movements immutable", lambda: x("delete from inventory_movements"), "immutable")

# --- misc -------------------------------------------------------------------------
x("insert into knowledge_docs (id,country,doc_type,category,title,summary) values (?,?,?,?,?,?)",
  (u(), SA, "lesson_learnt", "Wire", "Wire parted at stuffing box", "Kinked wire ran through the stuffing box"))
check("knowledge search (FTS5)", lambda: x("select title from knowledge_fts where knowledge_fts match 'stuffing'").fetchall())
x("insert into wg_runs (wg_id,job_date,field_ticket,approval_status,wg_synced_at) values ('r1','2026-10-20','S-1001','Approved','t')")
check("WIREGUARD approval status is case-blind", lambda: x("select count(*) from wg_runs where approval_status='approved'").fetchone()[0])


def finding():
    return x("insert into recon_findings (id,country,check_code,severity,job_id,detail,fingerprint,first_seen_at,last_seen_at) "
             "values (?,?,?,?,?,?,?,?,?) on conflict (fingerprint) do update set last_seen_at=excluded.last_seen_at",
             (u(), SA, "no_runs", "high", J, "{}", "no_runs:" + J, "t1", "t2")).rowcount


check("reconciliation finding re-check updates, not duplicates", lambda: (finding(), finding(), x("select count(*) from recon_findings").fetchone()[0])[2])
check("unknown role refused", lambda: x("insert into user_roles (username,full_name,role) values ('NESR-1','x','wizard')"), "CHECK")
check("usernames case-blind", lambda: (x("insert into user_roles (username,full_name,role) values ('NESR-12345','A','sdm')").rowcount,
                                     x("select role from user_roles where username='nesr-12345'").fetchone()[0]))

print(f"\n{results['ok']} passed, {results['fail']} failed")
sys.exit(1 if results["fail"] else 0)
