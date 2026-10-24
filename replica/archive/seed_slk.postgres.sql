-- SLK Operations: Slickline seed (run after schema.sql)
-- Generic slickline industry lists to start from. Every list is editable in Operation → Database (S24).
-- Review with SLK operations before go-live. Lines marked CONFIRM are assumptions.
-- Not seeded on purpose: real units, wire serials, PCE asset numbers, people, inventory items, JRA questions
-- (load those from NESR's own registers and the controlled QHSE form).

begin;

insert into countries (code, name, timezone) values ('SA', 'Saudi Arabia', 'Asia/Riyadh')
on conflict (code) do nothing;

create temporary table _c on commit drop as select id from countries where code = 'SA';

-- ---------------------------------------------------------------------------
-- Service domains and services
-- flags: perf = tubing punch / perforating, fish = fishing details, plug = plug/lock details,
--        mem = memory survey details, expl = needs explosives
-- ---------------------------------------------------------------------------

insert into service_domains (country_id, name)
select (select id from _c), d from unnest(array[
  'Well Access & Clean-out',
  'Flow Control (Plugs, Locks, SSSV)',
  'Gas Lift & Circulation',
  'Surveys & Diagnostics',
  'Fishing',
  'Well Integrity',
  'Perforating & Cutting'
]) d
on conflict (country_id, name) do nothing;

with s(name, domain, perf, fish, plug, mem, expl, sort) as (values
  ('Gauge Cutter / Drift Run',             'Well Access & Clean-out', false,false,false,false,false, 10),
  ('Tag Fill / TD Check',                  'Well Access & Clean-out', false,false,false,false,false, 20),
  ('Sand Bailing (Pump / Hydrostatic)',    'Well Access & Clean-out', false,false,false,false,false, 30),
  ('Wax / Scale / Paraffin Cutting',       'Well Access & Clean-out', false,false,false,false,false, 40),
  ('Hydrate / Obstruction Clearing',       'Well Access & Clean-out', false,false,false,false,false, 50),
  ('Set Plug',                             'Flow Control (Plugs, Locks, SSSV)', false,false,true,false,false, 60),
  ('Pull Plug',                            'Flow Control (Plugs, Locks, SSSV)', false,false,true,false,false, 70),
  ('Set / Pull Lock Mandrel',              'Flow Control (Plugs, Locks, SSSV)', false,false,true,false,false, 80),
  ('Set / Pull WR-SSSV',                   'Flow Control (Plugs, Locks, SSSV)', false,false,true,false,false, 90),
  ('Set / Pull Separation Sleeve / Insert','Flow Control (Plugs, Locks, SSSV)', false,false,true,false,false,100),
  ('Shift Sliding Sleeve (SSD) Open / Close','Gas Lift & Circulation', false,false,false,false,false,110),
  ('Pull / Set Gas Lift Valve',            'Gas Lift & Circulation', false,false,false,false,false,120),
  ('Pull / Set Dummy Valve',               'Gas Lift & Circulation', false,false,false,false,false,130),
  ('Set Circulation / Equalizing Device',  'Gas Lift & Circulation', false,false,false,false,false,140),
  ('Static Gradient Survey (SGS)',         'Surveys & Diagnostics', false,false,false,true,false,150),
  ('Flowing Gradient Survey (FGS)',        'Surveys & Diagnostics', false,false,false,true,false,160),
  ('Pressure Build-Up (PBU) / Fall-Off',   'Surveys & Diagnostics', false,false,false,true,false,170),
  ('BHP / BHT Survey',                     'Surveys & Diagnostics', false,false,false,true,false,180),
  ('Memory PLT',                           'Surveys & Diagnostics', false,false,false,true,false,190),
  ('Memory Caliper',                       'Surveys & Diagnostics', false,false,false,true,false,200),
  ('Bottom-Hole Sampling',                 'Surveys & Diagnostics', false,false,false,true,false,210),
  ('Lead Impression Block (LIB)',          'Fishing', false,true,false,false,false,220),
  ('Wire / Toolstring Fishing',            'Fishing', false,true,false,false,false,230),
  ('Junk Retrieval (Magnet / Basket)',     'Fishing', false,true,false,false,false,240),
  ('Tubing Integrity / Leak Check Tools',  'Well Integrity', false,false,false,false,false,250),
  ('Check Valve / Standing Valve Set-Pull','Well Integrity', false,false,true,false,false,260),
  ('Tubing Punch',                         'Perforating & Cutting', true,false,false,false,true,270),
  ('Slickline Tubing Cutter',              'Perforating & Cutting', false,true,false,false,true,280),
  ('Other',                                null, false,false,false,false,false,999)
)
insert into services (country_id, name, domain_id, is_perforation, is_pipe_recovery, is_plug, is_memory, is_explosive, sort)
select (select id from _c), s.name, d.id, s.perf, s.fish, s.plug, s.mem, s.expl, s.sort
from s left join service_domains d on d.name = s.domain and d.country_id = (select id from _c)
on conflict (country_id, name) do nothing;

-- ---------------------------------------------------------------------------
-- Lookup lists
-- ---------------------------------------------------------------------------

with l(kind, value, sort) as (values
  -- accounts / areas: the same client structure as the WL hub (seen in the recon); CONFIRM for SLK
  ('account','DWO-A',10),('account','DWO-P',20),('account','SAWCOD',30),('account','NAWCOD',40),('account','UNC',50),('account','Other',99),
  ('area','DWO',10),('area','UNC',20),('area','SG UNC',30),('area','JAF',40),('area','EXP',50),('area','KHRS',60),('area','NGO',70),
  ('area','SGO',80),('area','CGO',90),('area','NGG',100),('area','SGG',110),('area','RFG',120),('area','CGG',130),('area','HDG',140),
  ('area','CA',150),('area','SHYB',160),('area','RTC',170),('area','NAWCOD-L',180),('area','NAWCOD-O',190),('area','North Arabia',200),
  ('area','Offshore',210),('area','Other',999),

  ('conveyance','Slickline (solid wire)',10),('conveyance','Braided line',20),('conveyance','Digital slickline',30),
  ('conveyance','Slickline with tractor',40),('conveyance','Other',99),

  ('well_type','Oil',10),('well_type','Gas',20),('well_type','Water',30),('well_type','Injector',40),('well_type','Observation',50),('well_type','Other',99),

  ('casing_type','Tubing',10),('casing_type','Casing',20),('casing_type','Liner',30),('casing_type','N/A',90),('casing_type','Other',99),
  ('casing_od','2 3/8"',10),('casing_od','2 7/8"',20),('casing_od','3 1/2"',30),('casing_od','4"',40),('casing_od','4 1/2"',50),
  ('casing_od','5"',60),('casing_od','5 1/2"',70),('casing_od','7"',80),('casing_od','N/A',90),('casing_od','Other',99),
  ('casing_grade','J-55',10),('casing_grade','L-80',20),('casing_grade','N-80',30),('casing_grade','C-90',40),('casing_grade','T-95',50),
  ('casing_grade','P-110',60),('casing_grade','13Cr',70),('casing_grade','Super 13Cr',80),('casing_grade','25Cr',90),('casing_grade','Other',99),

  ('fluid_type','Oil',10),('fluid_type','Gas',20),('fluid_type','Water / Brine',30),('fluid_type','Diesel',40),('fluid_type','Mixed',50),('fluid_type','Other',99),

  ('wire_type','Solid',10),('wire_type','Braided',20),('wire_type','Digital (e-slickline)',30),
  ('wire_size','0.092"',10),('wire_size','0.108"',20),('wire_size','0.125"',30),('wire_size','0.140"',40),('wire_size','0.160"',50),
  ('wire_size','3/16" braided',60),('wire_size','7/32" braided',70),('wire_size','Other',99),

  ('pressure_rating','5,000 psi',10),('pressure_rating','10,000 psi',20),('pressure_rating','15,000 psi',30),
  ('lubricator_size','2 1/2"',10),('lubricator_size','3"',20),('lubricator_size','4"',30),('lubricator_size','5"',40),
  ('stuffing_box_type','Standard stuffing box',10),('stuffing_box_type','Hydraulic packing nut',20),('stuffing_box_type','Liquid seal (braided)',30),
  ('grease_panel_type','Air',10),('grease_panel_type','Intensifier',20),('grease_panel_type','Other',99),

  ('jar_type','Spang (mechanical) jar',10),('jar_type','Tubular jar',20),('jar_type','Hydraulic jar',30),('jar_type','Spring jar',40),('jar_type','Accelerator',50),
  ('rope_socket_type','Wedge',10),('rope_socket_type','Spool / knot',20),('rope_socket_type','Braided line socket',30),

  -- plug / lock and nipple families are generic industry names; CONFIRM against the fleet's stock
  ('nipple_profile','X',10),('nipple_profile','XN',20),('nipple_profile','R',30),('nipple_profile','RN',40),
  ('nipple_profile','F (selective)',50),('nipple_profile','R (no-go)',60),('nipple_profile','DB',70),('nipple_profile','Other',99),
  ('lock_type','X lock mandrel',10),('lock_type','XN lock mandrel',20),('lock_type','R lock mandrel',30),('lock_type','RN lock mandrel',40),
  ('lock_type','Collar lock',50),('lock_type','Slip lock',60),('lock_type','Other',99),
  ('plug_type','PX plug',10),('plug_type','PR plug',20),('plug_type','Equalizing plug',30),('plug_type','Pump-open plug',40),
  ('plug_type','Collar stop',50),('plug_type','Bridge plug (slickline set)',60),('plug_type','N/A',90),('plug_type','Other',99),

  -- Failure Roster / Knowledge Hub categories, slickline flavour
  ('failure_category','Wire parted',10),('failure_category','Wire damage / kink',20),('failure_category','Toolstring stuck',30),
  ('failure_category','Jarring failure',40),('failure_category','Lost tool / fish left in hole',50),('failure_category','Plug / lock not set',60),
  ('failure_category','Plug / lock not retrieved',70),('failure_category','Stuffing box / PCE leak',80),('failure_category','Wellhead / tree issue',90),
  ('failure_category','Memory tool no data',100),('failure_category','Surface equipment failure',110),('failure_category','Procedure not followed',120),
  ('failure_category','HSE',130),('failure_category','Other',999)
)
insert into lookup_values (country_id, kind, value, sort)
select (select id from _c), kind, value, sort from l
on conflict (country_id, kind, value) do nothing;

-- ---------------------------------------------------------------------------
-- Inventory locations (columns of the inventory tables)
-- ---------------------------------------------------------------------------

with loc(inventory, code, label, counts_as, sort) as (values
  ('explosive','bunker','Explosive Bunker','on_hand',10),
  ('explosive','shop','Slickline Shop','on_hand',20),
  ('explosive','at_location','At Location','at_well',30),
  ('explosive','fired','Used (Fired)','used',40),
  ('explosive','junk','Junk','junk',50),
  ('explosive','on_order','On Order','on_order',60),
  ('explosive','supplier','Supplier','external',70),
  ('hardware','warehouse','Warehouse','on_hand',10),
  ('hardware','shop','Slickline Shop','on_hand',20),
  ('hardware','on_unit','On Unit','on_hand',30),
  ('hardware','at_location','At Location','at_well',40),
  ('hardware','left_in_hole','Left in Hole','used',50),
  ('hardware','junk','Junk','junk',60),
  ('hardware','on_order','On Order','on_order',70),
  ('hardware','supplier','Supplier','external',80),
  ('mcr','warehouse','Warehouse','on_hand',10),
  ('mcr','shop','Slickline Shop','on_hand',20),
  ('mcr','at_location','At Location','at_well',30),
  ('mcr','consumed','Consumed','used',40),
  ('mcr','on_order','On Order','on_order',50),
  ('mcr','supplier','Supplier','external',60)
)
insert into inventory_locations (country_id, inventory, code, label, counts_as, sort)
select (select id from _c), inventory, code, label, counts_as, sort from loc
on conflict (country_id, inventory, code) do nothing;

-- Inventory categories are free text on items. Suggested set for the UI pill row:
--   explosive: Tubing Punch Charges · Cutter Charges · Power Charges · Igniters / Initiators
--   hardware:  Plugs & Prongs · Lock Mandrels · Running / Pulling Tools · Gauge Cutters & Drifts · Bailers ·
--              Fishing Tools · Gas Lift Valves · Memory Gauges · Toolstring (stem, jars, knuckle joints)
--   mcr:       Wire Reels · Stuffing Box Packing · Rope Sockets · O-rings & Seals · Shear Pins · Grease

commit;
