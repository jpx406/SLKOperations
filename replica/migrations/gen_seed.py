#!/usr/bin/env python3
"""Writes 0002_seed.sql: service domains, profiles for WIREGUARD's job types, local lookups,
inventory locations and default role permissions. Standard library only.

    python gen_seed.py

Units, fields, rigs, job locations, job types, wires and drums are NOT seeded: they come from
WIREGUARD through the sync job (see ../integration-wireguard.md).
"""

import os
import uuid

COUNTRY = "Saudi Arabia"          # WIREGUARD's country naming
HERE = os.path.dirname(os.path.abspath(__file__))


def q(v):
    if v is None:
        return "NULL"
    if isinstance(v, (int, float)):
        return str(v)
    return "'" + str(v).replace("'", "''") + "'"


def rid():
    return uuid.uuid4().hex


DOMAINS = [
    "Well Access and Clean-out",
    "Flow Control (Plugs, Locks, SSSV)",
    "Gas Lift and Circulation",
    "Surveys and Diagnostics",
    "Fishing",
    "Well Integrity",
    "Perforating and Cutting",
]

# WIREGUARD job types exactly as exported (double spaces included).
# flags: plug, fishing, memory, perforation, explosive.  CONFIRM = check with SLK ops.
PROFILES = [
    ("Break ceramic disc",                  "Flow Control (Plugs, Locks, SSSV)", 0, 0, 0, 0, 0),
    ("DPU RAZOR",                           "Flow Control (Plugs, Locks, SSSV)", 1, 0, 0, 0, 0),  # CONFIRM: setting tool run
    ("Equalizing Prong",                    "Flow Control (Plugs, Locks, SSSV)", 1, 0, 0, 0, 0),
    ("Gauge Cutter",                        "Well Access and Clean-out",         0, 0, 0, 0, 0),
    ("Interwell Plugs",                     "Flow Control (Plugs, Locks, SSSV)", 1, 0, 0, 0, 0),
    ("Memory Gauges",                       "Surveys and Diagnostics",           0, 0, 1, 0, 0),
    ("Memory Logging",                      "Surveys and Diagnostics",           0, 0, 1, 0, 0),
    ("O&C Otis & Baker  Sliding Side Door", "Gas Lift and Circulation",          0, 0, 0, 0, 0),
    ("Other",                               None,                                0, 0, 0, 0, 0),
    ("PERFORATORS",                         "Perforating and Cutting",           0, 0, 0, 1, 1),
    ("R&P ACDC",                            "Gas Lift and Circulation",          0, 0, 0, 0, 0),  # CONFIRM
    ("R&P Blanking  (ESP completion)",      "Flow Control (Plugs, Locks, SSSV)", 1, 0, 0, 0, 0),
    ("R&P Bridge plugs",                    "Flow Control (Plugs, Locks, SSSV)", 1, 0, 0, 0, 0),
    ("R&P Downhole Gauges",                 "Surveys and Diagnostics",           0, 0, 1, 0, 0),
    ("R&P GAS LIFT VALVES",                 "Gas Lift and Circulation",          0, 0, 0, 0, 0),
    ("R&P Gauge hanger",                    "Surveys and Diagnostics",           0, 0, 1, 0, 0),
    ("R&P Otis & Baker SSSV",               "Flow Control (Plugs, Locks, SSSV)", 1, 0, 0, 0, 0),
    ("R&P PR Otis",                         "Flow Control (Plugs, Locks, SSSV)", 1, 0, 0, 0, 0),
    ("R&P PX & PXN Otis",                   "Flow Control (Plugs, Locks, SSSV)", 1, 0, 0, 0, 0),
    ("Sand bailer",                         "Well Access and Clean-out",         0, 0, 0, 0, 0),
    ("Tubing Drift",                        "Well Access and Clean-out",         0, 0, 0, 0, 0),
]

LOOKUPS = {
    "conveyance": ["Slickline (solid wire)", "Braided line", "Digital slickline", "Slickline with tractor", "Other"],
    "well_type": ["Oil", "Gas", "Water", "Injector", "Observation", "Other"],
    "casing_type": ["Tubing", "Casing", "Liner", "N/A", "Other"],
    "casing_od": ['2 3/8"', '2 7/8"', '3 1/2"', '4"', '4 1/2"', '5"', '5 1/2"', '7"', "N/A", "Other"],
    "casing_grade": ["J-55", "L-80", "N-80", "C-90", "T-95", "P-110", "13Cr", "Super 13Cr", "25Cr", "Other"],
    "fluid_type": ["Oil", "Gas", "Water / Brine", "Diesel", "Mixed", "Other"],
    "pressure_rating": ["5,000 psi", "10,000 psi", "15,000 psi"],
    "lubricator_size": ['2 1/2"', '3"', '4"', '5"'],
    "stuffing_box_type": ["Standard stuffing box", "Hydraulic packing nut", "Liquid seal (braided)"],
    "grease_panel_type": ["Air", "Intensifier", "Other"],
    "jar_type": ["Spang (mechanical) jar", "Tubular jar", "Hydraulic jar", "Spring jar", "Accelerator"],
    "rope_socket_type": ["Wedge", "Spool / knot", "Braided line socket"],
    "nipple_profile": ["X", "XN", "R", "RN", "F (selective)", "R (no-go)", "DB", "Other"],
    "lock_type": ["X lock mandrel", "XN lock mandrel", "R lock mandrel", "RN lock mandrel", "Collar lock", "Slip lock", "Other"],
    "plug_type": ["PX plug", "PXN plug", "PR plug", "Equalizing plug", "Pump-open plug", "Collar stop", "Bridge plug", "Interwell plug", "N/A", "Other"],
    "failure_category": ["Wire parted", "Wire damage / kink", "Toolstring stuck", "Jarring failure", "Lost tool / fish left in hole",
                         "Plug / lock not set", "Plug / lock not retrieved", "Stuffing box / PCE leak", "Wellhead / tree issue",
                         "Memory tool no data", "Surface equipment failure", "Procedure not followed", "HSE", "Other"],
}

LOCATIONS = [
    ("explosive", "bunker", "Explosive Bunker", "on_hand"), ("explosive", "shop", "Slickline Shop", "on_hand"),
    ("explosive", "at_location", "At Location", "at_well"), ("explosive", "fired", "Used (Fired)", "used"),
    ("explosive", "junk", "Junk", "junk"), ("explosive", "on_order", "On Order", "on_order"), ("explosive", "supplier", "Supplier", "external"),
    ("hardware", "warehouse", "Warehouse", "on_hand"), ("hardware", "shop", "Slickline Shop", "on_hand"),
    ("hardware", "on_unit", "On Unit", "on_hand"), ("hardware", "at_location", "At Location", "at_well"),
    ("hardware", "left_in_hole", "Left in Hole", "used"), ("hardware", "junk", "Junk", "junk"),
    ("hardware", "on_order", "On Order", "on_order"), ("hardware", "supplier", "Supplier", "external"),
    ("mcr", "warehouse", "Warehouse", "on_hand"), ("mcr", "shop", "Slickline Shop", "on_hand"),
    ("mcr", "at_location", "At Location", "at_well"), ("mcr", "consumed", "Consumed", "used"),
    ("mcr", "on_order", "On Order", "on_order"), ("mcr", "supplier", "Supplier", "external"),
]

MENUS = ["schedule", "jobs", "job_log", "pre_job_notes", "database", "failure_roster", "eight_min_facts", "quick_plan",
         "reconciliation", "statistics", "npt_analysis", "utilization", "competency", "attendance",
         "inventory_explosive", "inventory_hardware", "inventory_mcr", "wires", "knowledge_hub", "users", "audit", "ai_assistant"]

ALL = set(MENUS)
OPS = {"schedule", "jobs", "job_log", "failure_roster", "eight_min_facts", "reconciliation", "wires", "knowledge_hub", "ai_assistant"}
DASH = {"statistics", "npt_analysis", "utilization", "competency"}
INV = {"inventory_explosive", "inventory_hardware", "inventory_mcr"}

# role: (view set, edit set, delete set). admin passes every check in code and needs no rows.
ROLES = {
    "operations_manager":   (ALL - {"users"}, ALL - {"users", "audit", "inventory_explosive"}, {"jobs", "database"}),
    "maintenance_manager":  (OPS | {"database", "attendance"} | INV, {"database", "schedule", "inventory_hardware", "inventory_mcr"}, set()),
    "sdm":                  (OPS | DASH | {"pre_job_notes", "quick_plan", "attendance"} | INV,
                             {"schedule", "jobs", "eight_min_facts", "failure_roster", "reconciliation", "pre_job_notes", "quick_plan", "attendance"}, set()),
    "deputy_sdm":           (OPS | DASH | {"pre_job_notes", "quick_plan", "attendance"},
                             {"schedule", "jobs", "eight_min_facts", "reconciliation", "pre_job_notes", "quick_plan"}, set()),
    "sales":                (OPS | DASH | {"quick_plan"}, {"jobs", "quick_plan"}, set()),
    "director":             (ALL - {"users", "audit"}, set(), set()),
    "sqm":                  (ALL - {"users"}, {"eight_min_facts", "failure_roster", "knowledge_hub", "jobs", "attendance"}, set()),
    "slickline_supervisor": (OPS | {"pre_job_notes", "attendance"}, {"jobs", "eight_min_facts", "pre_job_notes"}, set()),
    "slickline_operator":   (OPS | {"attendance"}, {"jobs"}, set()),
    "assistant_operator":   ({"schedule", "jobs", "knowledge_hub", "ai_assistant", "attendance"}, set(), set()),
    "crew":                 ({"schedule", "jobs", "knowledge_hub", "ai_assistant", "attendance"}, set(), set()),
    "viewer":               ({"schedule", "jobs", "job_log", "knowledge_hub", "ai_assistant"} | DASH, set(), set()),
    "explosive_manager":    ({"schedule", "jobs", "knowledge_hub", "ai_assistant"} | INV, set(INV), set()),
    "explosive_admin":      ({"schedule", "jobs", "knowledge_hub", "ai_assistant"} | INV, set(INV), set(INV)),
    "storekeeper":          ({"schedule", "jobs", "ai_assistant"} | INV, {"inventory_hardware", "inventory_mcr"}, set()),
    "attendance_admin":     ({"attendance", "ai_assistant"}, {"attendance"}, set()),
    "slk_contact":          ({"schedule", "jobs", "pre_job_notes", "knowledge_hub", "ai_assistant"}, {"pre_job_notes"}, set()),
}


def main():
    out = ["-- SLK Operations D1 migration 0002 - seed (generated by gen_seed.py, do not edit by hand)",
           "-- Units, fields, rigs, job locations, job types, wires and drums come from WIREGUARD via sync, not from here.", ""]
    for i, d in enumerate(DOMAINS):
        out.append(f"INSERT OR IGNORE INTO service_domains (name, sort) VALUES ({q(d)}, {(i + 1) * 10});")
    out.append("")
    for name, dom, plug, fish, mem, perf, expl in PROFILES:
        out.append("INSERT OR IGNORE INTO service_profiles (job_type_name, domain, is_plug, is_fishing, is_memory, is_perforation, is_explosive) "
                   f"VALUES ({q(name)}, {q(dom)}, {plug}, {fish}, {mem}, {perf}, {expl});")
    out.append("")
    for kind, values in LOOKUPS.items():
        for i, v in enumerate(values):
            sort = 999 if v == "Other" else (i + 1) * 10
            out.append(f"INSERT OR IGNORE INTO lookup_values (id, country, kind, value, sort) VALUES ({q(rid())}, {q(COUNTRY)}, {q(kind)}, {q(v)}, {sort});")
    out.append("")
    for i, (inv, code, label, counts) in enumerate(LOCATIONS):
        out.append(f"INSERT OR IGNORE INTO inventory_locations (id, country, inventory, code, label, counts_as, sort) "
                   f"VALUES ({q(rid())}, {q(COUNTRY)}, {q(inv)}, {q(code)}, {q(label)}, {q(counts)}, {(i % 8 + 1) * 10});")
    out.append("")
    for role, (view, edit, delete) in ROLES.items():
        for m in MENUS:
            v, e, d = int(m in view or m in edit), int(m in edit), int(m in delete)
            if v or e or d:
                out.append(f"INSERT OR IGNORE INTO role_permissions (id, role, menu_key, can_view, can_edit, can_delete) "
                           f"VALUES ({q(rid())}, {q(role)}, {q(m)}, {v}, {e}, {d});")
    out.append("")
    with open(os.path.join(HERE, "0002_seed.sql"), "w", encoding="utf-8", newline="\n") as fh:
        fh.write("\n".join(out))
    print(f"wrote 0002_seed.sql ({len(out)} lines)")


if __name__ == "__main__":
    main()
