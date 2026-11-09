# Rig Up and Tool String diagrams: analysis

**Goal.** Build the NESR Rig Up Diagram (QAF14009) and Slickline String Diagram (QAF14010) inside the job. Today they are filled in by hand in Excel. In the app they would be quick to put together, checked against the standards while you build, and printed in the same QAF format.

**Mock.** [mock.html](mock.html) opens in any browser and works with sample data. Screenshots:
- [shot-1-rigup.png](shot-1-rigup.png)
- [shot-2-toolstring.png](shot-2-toolstring.png)
- [shot-3-phone.png](shot-3-phone.png)

---

## 1. What the Excel forms hold today

| | QAF14009 Rig Up Diagram | QAF14010 Slickline String Diagram |
|---|---|---|
| Header | Client, Well, Field / Rig, Date, D.O.S. No. | Client, Well, Field, Rig / Site, Date, Job Reference, Run No., Prepared by |
| Per row | Description, Rating (e.g. 10K H2S), ID in, Top connection, Bottom connection, Length ft and m | Outer diameter, Fishing neck, Tool length ft and m, Top connection, Bottom connection, Description |
| Drawing | "Assembly" column with pictures copied from a side library and placed by hand | Same, from a second picture library |
| Footer | Total length ft and m, Prepared by, Reviewed by, Page | Total length (jar open), Total depth MD / TVD |
| Pick lists | 23 PCE parts, 4 ratings (3K–15K H2S), IDs 2–7 in, 13 connections | about 56 tools, with fishing neck, OD and connection lists |

**Problems found in the workbook.** These are good reasons to move it into the app.

1. **The rig-up total skips the Bleed-off Sub.** The formula `SUM(BP15,BP20,…,BP55)` leaves out row BP40. The sheet shows 39.00 ft; the real total is 41.00 ft.
2. **The string total in feet is labelled "m".** The sheet shows "21.92 m" for a total that is in feet.
3. **Header cells link to another workbook** (`'[1]D.O.S Data'`). Without it they show `0` or `#CONNECT!`.
4. **Nothing checks that parts connect.** In the sample string, row 1's rope socket ends in 1 1/16"-10 but row 2 starts with 1.875" QLS. That mismatch goes unnoticed.
5. **Drawings are loose pictures.** They don't follow the rows, so reordering a row leaves the picture behind. The string sheet's Description column is empty.
6. **Missing lengths and typos.** The stuffing box has no length. Several labels are misspelled: Ratting, Bleed of Sub, Guage cutter.

## 2. Information needed

### a. From the job, already in the app (no new typing)
- **Header:** client, well, field, rig/unit, date, job reference, D.O.S. number, run number, prepared by (signed-in user).
- **Design and Preparation values:**
  - MPWHP or THP;
  - H₂S ppm;
  - minimum restriction / tubing ID;
  - wire size;
  - the PCE set already picked;
  - lubricator length;
  - the current tool string list (component, OD, length, weight).
- **Total depth MD / TVD:** from the well data, or typed on the form.

### b. A parts catalogue (new: grows the existing Database › PCE list)

| Field | PCE part | Tool |
|---|---|---|
| Name, kind (stuffing box, lubricator, BOP, stem, jar…) | ✓ | ✓ |
| Working pressure 5K / 10K / 15K, service Standard / H₂S | ✓ | |
| ID (bore) in | ✓ | |
| OD in, fishing neck in | | ✓ |
| Top connection, bottom connection (one shared list) | ✓ | ✓ |
| Length ft | ✓ | ✓ (closed) |
| Weight lb, jar stroke ft | | ✓ |
| Number of rams (wireline valve) | ✓ | |
| Optional photo or drawing | ✓ | ✓ |
| Country / base, active, in stock | ✓ | ✓ |

- **Connections** become one shared list:
  - quick unions, e.g. 4.75"-4x2 (3.750") and 6.125"-4x2 (4.750");
  - flanges, e.g. 2 9/16" RBX153 10K;
  - tool threads: 1.875" QLS and 1 1/16"-10.
- The Pressure Standard §7.5 tables give every Otis and Bowen union with its bore, pressure and service, so they can be loaded from there.
- **Seed data:** the Excel side lists (23 PCE parts, about 56 tools) plus the Elmar catalogue's stack order.

### c. Per diagram (saved on the job)
- **Each row:** a catalogue part, plus any edits for this job, plus the asset serial number when picked. Each PCE part is tracked individually under Pressure Standard §8.3. The serial number links the diagram to the certificate date.
- **Status:** Draft, then Sent for review, then Reviewed (by whom, when). Today these are the "Prepared by" and "Reviewed by" boxes.

## 3. Checks the screen runs while you build

Each check cites its source. Like the current Preparation checks, they show the risk but never block saving. "Send for review" is the step that requires them to pass.

| Check | Rule | Source |
|---|---|---|
| Pressure rating | Lowest-rated part ≥ 1.2 × MPWHP. The wellsite test is 1.2 × MPWHP. | Pressure Std §9.1, §9.2.1, §9.2.3 |
| H₂S service | Sour well (H₂S > 0): every part must be H₂S service (NACE MR0175) | Pressure Std §6.2.2 |
| Connections | Each part's bottom connection must equal the next part's top connection. Otherwise "Add crossover" offers one. | Pressure Std §7.5, §7.6 |
| Bore | Smallest PCE ID ≥ largest tool OD + 0.25 in | Pressure Std §9.2.4 |
| Lubricator length | Lubricator ≥ tool string length (jar open) + 3 ft (1 m) | Pressure Std §9.2.5 |
| Tubing fit | Largest tool OD < minimum tubing ID (the OD-to-tubing table) | SOP-01 §7.16.2 |
| Weight | Stem weight ≥ balance weight (wire area × WHP) + 40 lb | SOP-01 §7.6, §7.16.6 |
| Required parts and barriers | Stuffing box, tool catcher and wireline valve are present. Above 1,500 psi, a dual-ram valve. | Pressure Std §9.2.7, §9.2.8, §9.2.10 |
| Colour band | Drawing bands follow the rating colours: 3K yellow, 5K red, 10K black, 15K white | Pressure Std §8.2 |

## 4. Similar apps and what to borrow

The web search found no off-the-shelf slickline tool that builds both diagrams. Five references are useful:

| App | What it does | What we borrow |
|---|---|---|
| **WirelineMaster** (your screenshot) | Library on the left (Assets / Images / Diagrams). The sheet is the canvas. Each row has handle, copy and delete. | The sheet is the printout; per-row tools; saved diagrams. |
| **NOV Elmar** printed rig-up sheets ([typical slickline rig-up](https://assets.nov.com/NCP4N68N/at/krmqf657np5gnjk66b4t6hcm/Typical_Elmar_Slickline_Pressure_Control_Rig-Up.pdf), [PCE string](https://nov.com/products/slickline-pressure-control-equipment-string)) | Standard top-to-bottom order of a slickline stack | "Smart order": a picked part drops into its place in the stack. |
| **NOV Cerberus** ([overview](https://www.scribd.com/document/451867501/Cerberus-Wireline-pdf)) | Each choice narrows the next (cable, tool string) | "Fits this job" filter: parts that don't meet the rating or H₂S are greyed out. |
| **Oliasoft WellDesign** ([String/BHA docs](https://oliasoft.gitbook.io/oliasoft-welldesigntm-public-docs/user-guides-1/string-bha)) | BHA entered top to bottom; ready-made BHAs imported from a library | Templates and "Copy from the last run on this well" |
| **Petromehras BHA Design** ([page](https://petromehras.com/component/mtree/drilling-completion-software/bha-design)), **AnTech StringView** ([article](https://oilit.com/HTML_Articles/2003_9_27.php)) | Click a cell and pick a tool; custom icons, snap to grid | Pick from a list rather than drawing freehand. Drawings come from the part's sizes, not hand placement. |

## 5. Recommended interface (as in the mock)

**Where it lives:** a new **Diagrams** section in the job's **02 Preparation** stage, below the toolstring, with two tabs: *Rig up (QAF14009)* and *Tool string (QAF14010)*. The current Preparation tool string table becomes this tool string, so the crew enters it once.

**Three panes on desktop:**
1. **Catalogue (left).**
   - Search box and a "Fits this job" filter.
   - Groups: Top of stack, Lubricators, Valves and subs, Crossovers and wellhead.
   - For the tool string: Top tools, Weight, Jars, Service tools.
   - Click a part and it goes to its correct place in the stack; or drag it to a row.
2. **The sheet (centre).**
   - The real QAF layout on white paper; what you see is what prints.
   - Click a row to select it.
   - Row tools: ↑ ↓ duplicate remove.
   - Drag to reorder.
   - A red pill between two rows shows a connection mismatch, with an **Add crossover** button.
3. **Details and checks (right).**
   - Edit the selected row: rating, ID/OD, connections, length, asset serial.
   - Live checks with their SOP references.
   - The job values that drive the checks.

**Toolbar:**
- Rig up / Tool string;
- **Start from** (templates, or copy from the last run on this well);
- Undo;
- ft / m;
- Print / PDF;
- **Send for review**.

**Keyboard:** ↑ ↓ moves between rows, Alt+↑ ↓ moves a part, Delete removes it, Ctrl+Z undoes.

**Phone and tablet:**
- One column, with the sheet first.
- On the real build, phones edit with a card list (one card per part, with ↑ ↓). The paper sheet is for viewing and the PDF.

**Drawings:**
- Generated from each part's own sizes: width from the connection or OD, plus a rating colour band.
- They always follow the rows, need no picture library, and print sharply.
- The Excel pictures can be attached later as optional photos on catalogue parts.

## 6. Build plan (after you approve the mock)

1. **Catalogue.** Grow the Database › PCE list into a parts catalogue (PCE and tools) with a shared connection list. Seed it from the Excel lists and the §7.5 union tables. Admins edit it in Database.
2. **Rig up diagram.** Saved on the job, with the editor, smart order, crossover fix and the checks above. The current PCE set picker and lubricator length fill from it.
3. **Tool string diagram.** Extend today's tool string (component, OD, length, weight) with fishing neck, connections and jar stroke. Same editor; totals with the jar open.
4. **PDF.** QAF14009 and QAF14010 through the existing form PDF code, with the header filled from the job.
5. **Review.** Send for review, then Reviewed by and date; the PDF attaches to the job. Templates, and copy from the last run on the well.

Each step gets tests for the checks: rating, H₂S, connections, bore, lubricator, weight.

## 7. Questions for you

1. **Runs:** one rig up per job and one tool string per **run**? The string form has a Run No.
2. **Reviewer:** who reviews, the supervisor or the base engineer? Does review have to happen before the job can move to Execution?
3. **Barrier table:** Pressure Standard §9.2.8 has slickline columns for oil/gas and low/high pressure. Which ones should the app apply? The mock uses "dual ram above 1,500 psi".
4. **Catalogue owner:** who keeps the parts list (lengths, weights, connections)? Should asset serials and certificate dates come from WIREGUARD or be entered here?
5. **Form revision:** keep the QAF numbers as Rev 0, or issue Rev 1 for the app version?
