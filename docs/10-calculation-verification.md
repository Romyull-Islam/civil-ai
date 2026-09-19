# CivilMate calculators: methods, code clauses and verification

**For:** the licensed structural and geotechnical engineers reviewing CivilMate before release.
**Status:** software-verified against published worked examples and an independent library. The review and signature of a licensed engineer are still required.
**Date:** September 2026.

Every number a CivilMate answer gives comes from these deterministic calculators. The language model only chooses the calculator and explains the result, and a numeric check rejects any figure in the answer that no calculator produced.

The source code is in `src/lib/eng/`. The automated tests are in `tests/eng.test.ts` and `tests/published-examples.test.ts`. There are 124 tests, and all of them pass. Run them with `npm test`.

## How the calculators were verified

1. **Published worked examples.** The test file `tests/published-examples.test.ts` contains 29 of them. Each test names its source, and the inputs and answers are taken exactly as printed. Where a result differs from the source, the test comment explains why. Two kinds of difference occur:
   - differences between SI and US constants
   - rounding in charts or tables that the source read by eye

   Three sources contained errors of their own. We document those errors in the tests rather than copy them.
2. **An independent strain-compatibility library.** We compared the column interaction engine with the open-source library *concreteproperties*:
   - 40 points on 4 sections, for both the ACI/BNBC and the IS 456 stress models
   - all points agree within 0.5%
   - the exception is where a bar lies exactly on the edge of the stress block. There the maximum difference is 3.7%, because we model bars as points and concreteproperties models them as circles.
3. **Hand checks.** Engineering tests are written against hand-derived values, and the test comments show the working. Examples:
   - the IS 456 Annex G closed form
   - SP-16 Table F compression-steel stresses
   - IS 456 Table 19 τc values
   - the moment magnifier for a slender column

## Design codes and what each calculator does

The default code is **BNBC 2020**, Bangladesh. We read its provisions from the official gazette (Bangladesh Gazette Extra, 11 Feb 2021). BNBC Part 6 Chapter 6 follows the ACI 318M-11 strength method. We keep BNBC separate from ACI 318-19 because the two differ on several points:

| Item | BNBC 2020 |
|---|---|
| Shear | Vc = 0.17√f'c, with no size effect (Sec 6.4) |
| Punching shear | Three-expression vc, with no λs (6.4.10.2.1) |
| Tension-controlled strain | 0.005 |
| Column steel | 1% to 6%, preferably 4% or less (6.3.9.1) |
| Minimum slab and footing steel | 0.0018×420/fy, not less than 0.0014. Use 1.5 times this for brick-aggregate concrete (8.1.11.2) |
| Steel yield strength | fy ≤ 550 MPa; shear reinforcement fyt ≤ 420 MPa |

### Reinforced concrete: `rc.ts`, `column.ts`, `rcCode.ts`

**Beam: flexure and shear**
- **BNBC and ACI:**
  - Whitney block with φ = 0.9, tension-controlled.
  - When a singly reinforced section cannot be tension-controlled, compression steel is added by strain compatibility at the tension-controlled limit.
  - Minimum steel: max(0.25√f'c, 1.4)/fy·b·d.
  - Shear: Vc = 0.17√f'c·b·d, with √f'c ≤ 8.3 MPa. Vs ≤ 0.66√f'c·b·d.
  - Stirrup spacing: s ≤ d/2 and 600 mm, or d/4 and 300 mm at high shear.
  - The Av,min spacing is also enforced, and fyt ≤ 420 MPa.
- **IS 456:**
  - Annex G singly reinforced beam, and doubly reinforced when Mu > Mu,lim.
  - fsc comes from the strain, using the SP-16 Table A design curve. This matches SP-16 Table F within 1 MPa.
  - Shear: τc from Table 19 and τc,max from Table 20. fyv ≤ 415 MPa (cl. 40.4).
  - Minimum stirrups per cl. 26.5.1.6.
- **Verified against:**
  - NPTEL Design Problem 3.1 (Ast 837.75 and 895.84 mm²)
  - NPTEL doubly reinforced beam Problems 4.1 and Q.1
  - NPTEL shear, m6l14
  - SP-16 Table F
  - IS 456 Table 19
  - Whitney equilibrium

**Column: axial force with uniaxial or biaxial moment**
- **Section analysis:**
  - Strain compatibility on the actual bar positions.
  - ACI: 0.85f'c block with β1.
  - IS: parabolic-rectangular block, and the 3D/7 pivot when the neutral axis lies outside the section (cl. 39.1).
- **BNBC and ACI:**
  - φ from εt; φPn ≤ 0.80φPo.
  - Biaxial bending by the Bresler reciprocal method, on the uncapped curves, then the cap. A linear check is used below 0.1f'cAg.
- **IS:**
  - Minimum eccentricity per cl. 25.4.
  - Biaxial bending per cl. 39.6.
  - Slender columns per cl. 39.7.1, with the k reduction.
- **Slenderness (ACI and BNBC):**
  - Limits: 34 − 12(M1/M2) ≤ 40 when braced; 22 when unbraced.
  - δns = Cm/(1 − Pu/0.75Pc), using the smaller of the two permitted EI expressions.
  - M2,min = Pu(15 + 0.03h).
  - The check fails if δns > 1.4.
  - Sway frames are refused: the engineer must supply moments from a second-order analysis.
- **Minimum moment:** applied about one axis at a time, as both codes require.
- **Default assumption:** single curvature with equal end moments. This is the worst case.
- **Verified against:**
  - StructurePoint / Wight Ex. 11-1 interaction points, φPn,max and pure bending
  - PCA Notes Ex. 11.1 slender column (δns 2.02, Mc within 1%)
  - NPTEL SP-16 chart examples (uniaxial and biaxial)
  - concreteproperties
- **Limits of this calculator:**
  - Rectangular tied columns with bars round the perimeter only.
  - Spiral, circular and L-shaped columns are not covered.

**One-way slab**
- **BNBC and ACI:**
  - Minimum thickness from Table 6.6.1 / ACI 7.3.1.1, multiplied by 0.4 + fy/700.
  - Loads: max(1.4D, 1.2D + 1.6L).
  - Moments from the ACI approximate coefficients: end span 1/11 and 1/10; interior span 1/16 and 1/11.
  - Bar spacing ≤ 3h and 450 mm.
  - Shear: BNBC uses 0.17√f'c. ACI 318-19 uses 0.66λs·ρw^(1/3)√f'c, because slabs have no Av,min.
- **IS 456:**
  - Loads: 1.5(D + L).
  - Moment and shear coefficients from Tables 12 and 13.
  - Span/d check with the Fig. 4 modification factor, taken from the actual steel stress.
  - Shear: k·τc per cl. 40.2.1.1.
  - Spacing ≤ 3d and 300 mm.
- **Verified against:** the BNBC thickness table (3600/24 = 150 mm) and the brick-aggregate minimum steel.

**Isolated square footing**
- Plan size from the allowable net pressure. Footing and backfill weight are taken as 10% of the column load unless another value is given.
- Depth chosen so that one-way and punching shear pass:
  - IS: τc at the actual steel percentage, and ks·0.25√fck.
  - BNBC: 0.17√f'c, and the three-expression vc.
  - ACI 318-19: the ρw^(1/3) equation with λs.
- Minimum steel per code.
- Development length:
  - IS: cl. 26.2.1.
  - BNBC and ACI: the simplified equation, with ψg under ACI 318-19.
- Column bearing: IS cl. 34.4; ACI 22.8.
- **Verified against:**
  - the formula components of the StructurePoint / Wight Ex. 15-2 footing, for BNBC / ACI 318-14 (φvc 164, 246 and 332 psi)
  - the ACI 318-19 λs example
  - NPTEL IS footing m11l29: plan size 2.6 m and pressure 0.333 MPa
- **Limits of this calculator:**
  - Square footings under concentric load only.
  - Eccentric and combined footings are not covered.

### Steel beams: `steel.ts`

**Section tables**
- **ISMB from IS 808:2021**, the current standard. Seven sizes (100 to 200, 300 and 600) differ from the legacy SP 6(1):1964 tables still found in textbooks.
- **W-shapes from the AISC Shapes Database v15.**

**IS 800:2007**
- Section classification per Table 2. Semi-compact sections take βb = Ze/Zp.
- Md ≤ 1.2Ze·fy/γm0, or 1.5Ze·fy/γm0 for cantilevers (cl. 8.2.1.2).
- Lateral-torsional buckling per cl. 8.2.2, with Mcr from Annex E-1.1 using the published It and Iw.
- High-shear moment reduction per cl. 9.2.2.
- Deflection limits from Table 6.

**AISC 360-16**
- F2: Lp, Lr, Cb, and the plastic, inelastic and elastic LTB zones.
- G2: φv = 1.0 for rolled I-shapes.

**Verified against**
- AISC Manual Table 3-2 Lp and Lr for all 8 W-shapes
- AISC Design Examples F.1-2B (φMn 305 kip-ft) and F.1-3B (288 kip-ft)
- IS 800 LTB example, ISMB 225: Mcr 87.79, λLT 0.996, χLT 0.669, fbd 151.9 MPa, Md 52.91 kN·m

### Geotechnical: `soil.ts`

**Bearing capacity**
- **Terzaghi:**
  - Nc and Nq by the closed form.
  - Nγ from Das's table (after Kumbhojkar), per degree from 20° to 40°.
  - Shape factors and water-table correction included.
- **IS 6403:**
  - Vesic factors, with shape, depth and inclination factors and the W′ water factor.
- **Local shear:** c′ = 2c/3 and tanφ′ = 2tanφ/3.
- **Factor of safety:** 3 by default; BNBC Sec 3.9.3 allows 2 to 3.

**Settlement**
- Clay:
  - Primary consolidation of normally and over-consolidated clay.
  - Stress spread by the 2:1 method.
- Sand:
  - Allowable pressure for a target settlement from SPT N60 (Meyerhof, as modified by Bowles).
- BNBC limits for isolated footings (Sec 3.9.4.7): 25 mm on sand, 40 mm on clay.

**Rankine earth pressure**
- Pressure is integrated over the wall height, with surcharge, tension crack and water table.
- The resultant and its height above the base are calculated.

**Verified against**
- Das square footing, qult 1078.29 kPa
- Structville's four water-table cases
- Two US-unit Terzaghi examples
- NPTEL IS 6403 factors (Nc, Nq, Nγ, dc, dq)
- Das Ex. 11.5 settlement (63.9 mm)
- A two-layer over-consolidated clay (158 mm and 14 mm)
- The 2:1 method (21.13 kPa, 43.15 mm)
- Bowles Ex. 4-12: SPT pressures 255.4, 200.6, 170.7 and 157 kPa
- Three Rankine cases: surcharge; tension crack (38.25 kN/m at 1.12 m); water table (389.3 kN/m at 2.95 m)

### Planning: `layout.ts`

**Room sizes: BNBC 2020 Part 3 (default)**

| Room | Minimum | Clause |
|---|---|---|
| Habitable room | 9.5 m² net, 2.9 m wide | Sec 1.14.2.2 |
| Kitchen | 4 m² and 1.5 m wide; 7.5 m² and 2.2 m wide with dining | Sec 1.14.3.2 |
| Bathroom | Per Table 3.1.10 | Table 3.1.10 |
| Store | 1.5 m² | Sec 1.14.9 |
| Parking stall | 2.4 × 4.8 m | Appendix F.7.1 |

The Indian NBC 2016 room sizes are available as an option.

**Dhaka Mohanagar Imarat Bidhimala 2025**
- It replaced the 2008 rules on 14 Dec 2025.
- Front setback (Rule 41): at least 4.5 m from the road centre and at least 1.5 m from the boundary.
- Side and rear setbacks by number of storeys (Table 1).
- Maximum ground coverage by plot size (Table 3).
- FAR by road width (Table 5). This is an upper bound: the DAP area FAR may be lower and must be checked.

**Plot shapes (`plot.ts`)**
- **Shapes:** rectangle, square, trapezoid, four sides plus one diagonal (surveyor's measurement), L-shape, triangle, corner cut, flag lot, corner coordinates, or a traverse of lengths and bearings.
- **Traverses:** the misclosure is reported and corrected by the compass (Bowditch) rule.
- **Areas:** exact (shoelace formula). Coverage and FAR now use this true area. Previously irregular plots used 85% of the bounding box, which was wrong.
- **Setbacks:** applied per edge. Road edges get the front setback, edges facing away from the road get the rear setback, and all others the side setback.
- **Buildable area:** found on a grid of about 1/400 of the plot size, so it is conservative by at most one cell. Rooms are planned on the largest rectangle inside it.
- **Tests:** hand-computed areas for every shape, closure precision, bearings, feet, and a check that every room lies inside the real boundary.

**US houses (`standard: "IRC2021"`)**
- **Room sizes:** habitable rooms at least 70 sq ft and 7 ft in every direction (R304.1, R304.2); kitchens are exempt. Water-closet space at least 30 in wide with 21 in clear in front (R307.1). These are unchanged in the IRC 2018, 2021 and 2024.
- **Programme:** room areas follow typical US practice and are not code minimums.
- **Zoning:** no zoning values are assumed. Setbacks, coverage and height come from the local ordinance, and the planner flags them when they are missing.

### Roads: `roadgeo.ts` (42 tests)

**Standards covered**
- **AASHTO**, metric and US units.
- **RHD** Geometric Design Standards (2000 draft): Tables 2.1–2.3, 5.1–5.4 and 6.1–6.3, all read from the PDF.
- **LGED** Rural Roads (2005).
- **IRC** forms, which Bangladesh practice often borrows.

**What is calculated**
- **Radius and superelevation:** R = V²/127(e + f).
  - The AASHTO minimum-radius tables are reproduced by rounding to the **nearest** metre (NYSDOT M2-13/14; TxDOT for US units).
  - Required e uses AASHTO Method 5 with running speeds, and matches NYSDOT and TxDOT within 0.1%.
- **Stopping sight distance:** 0.278Vt + 0.039V²/a, with grade correction.
- **Crest and sag curves:** both the S < L and S ≥ L cases, always picking the valid one. A published USACE example (98.88 m) is wrong for this reason; the correct value is 89.09 m.
- **Horizontal curve elements and setting out:** PT = PC + L.

**Published examples reproduced**
- Wikibooks
- NPTEL chapters 13, 15, 17 and 18
- RHD pages 26 and 32
- Indiana Example 44-3.2
- Engineering Hulk and Mathalino

**Values checked against sources (September 2026)**
- **IRC friction factors for SSD:** these equal NPTEL Chapter 13, Table 13.1 (after IRC): 0.40 up to 30 km/h, 0.38 at 40, 0.37 at 50, 0.36 at 60 and 0.35 from 80 km/h. NPTEL's worked example uses 0.36 at 65 km/h. A test covers this.
- **Maximum relative gradient:** only the Indiana Figure 43-3E values (20–120 km/h) are used, and US speeds up to 75 mph at the equivalent values. Above that, the designer enters the value from their DOT manual. State tables differ (for example TxDOT RDM Table 4-8 and Iowa DOT Table 2B.2), so no national value is assumed. The unverified 130 km/h / 80 mph value was removed.
- **Sag comfort length:** the AASHTO comfort formula was removed because no source was found. The output instead states the TxDOT rule (Roadway Design Manual 4.8.2): comfort lengths are about 50% of the headlight lengths and are for special cases only. The IRC comfort formula is kept; NPTEL Chapter 18's worked example (73.1 m) verifies it.

### Pavements: `pavement.ts` (37 tests)

**AASHTO 1993 flexible (structural number) and rigid (slab thickness)**
- The rigid equation uses the constant 1.624×10⁷. The FHWA web page misprints it.
- ZR uses the exact inverse normal. It matches AASHTO Table 4.1 to 0.001 except at 99.99%, where the table prints −3.750 and the exact value is −3.719.
- Reproduced to ±0.05:
  - flexible: AASHTO Fig. 3.1 and Appendix H; FHWA NHI-05-037 Chapter 6 and Appendix C; JICA Bangladesh
  - rigid: AASHTO Fig. 3.7 and Appendix I; FHWA Chapter 6

**Traffic**
- Cumulative ESAL/msa by the RHD, LGED, IRC:37 and AASHTO methods; the published examples reproduce.
- The AASHTO load-equivalency (LEF) equation reproduces Table D.4.

**RHD Pavement Design Guide 2005 catalogue**
- The Appendix 2 example reproduces: 40 + 90 mm asphalt, 250 mm base Type I, 200 mm sub-base and 300 mm improved subgrade.
- **Improved subgrade:** the guide's Table 6 (250/150/100 mm on CBR 2/3/4 %) conflicts with its Appendix 1 (300/250/200 mm on CBR 3/4/5 %). The guide's own worked example (Appendix 2, CBR 3 %) specifies 300 mm, which matches Appendix 1; Table 6 would give 150 mm. Appendix 1 is therefore the default, and a test covers this. Table 6 remains selectable.

### Concrete mix design: `mixdesign.ts` (36 tests)

**ACI 211.1**, SI and inch-pound tables, with code checks for ACI 318 (USA) or BNBC 2020 (Bangladesh)
- **BNBC 2020 checks:**
  - f'cr from Part 6 Ch. 5
  - Table 6.5.6 w/c when there are no trial data
  - Table 6.8.3 durability minimums
  - brick chips (khoa) prohibited in severe environments
- **Examples reproduced within ±2 kg:**
  - ACI 211.1 Appendix 2 (SI)
  - ACI 211.1 Examples 1 and 2 (inch-pound)
  - PCA EB001 Example 1, using PCA's own rules as input overrides
- **f'cr in psi:** verified against PCA EB001 (14th ed.), Table 9-11 (inch-pound) and Eq. 9-1 to 9-3, which are adapted from ACI 318. Three PCA worked examples are tests:
  - Example 1: 3500 psi with no data gives 4700 psi.
  - Example 4: 4000 psi with s = 300 psi gives 4402 psi.
  - Metric example: 35 MPa with s = 2.0 MPa gives 37.7 MPa.

**IS 10262:2019 with IS 456 durability**
- The Annex A M40 example reproduces.
- The w/c from Fig. 1 is a digitised curve (±1 MPa). It is always labelled as approximate and can be overridden.

### Drainage: `drainage.ts` (7 tests)

- **Methods:**
  - rational method (SI and US), with HEC-22 frequency factors
  - Kirpich time of concentration
  - Manning for full and part-full pipes and for channels
  - pipe sizing with a self-cleansing velocity check (0.9 m/s storm, 0.6 m/s sanitary)
- **Examples reproduced:** HEC-22 Examples 3-3 and 5-1, and the gutter example.
- **Rainfall intensity** must come from the local IDF curve; for the USA that is NOAA Atlas 14.

### Subdivision and landscape: `subdivision.ts`, `landscape.ts` (11 tests)

**Subdivision layout**
- **Method:** the tract is cut into rows of lots parallel to the existing road: road | lots | back-to-back lots | new street | lots… An optional access street runs back from the road.
- **Lots:** each row's usable length is divided equally, so every lot is at least the minimum frontage. Open space is taken from the rows farthest from the road.
- **Tests:** hand-computed layouts (39, 36 and 34 lots; 50 lots on a 10-acre US tract), plus a check that every lot lies inside an irregular boundary.
- **US fire access:** IFC 2024 §503.2.1 (20 ft clear width) and §503.2.5 (dead ends longer than 150 ft need a turnaround), both read from the code text.
- **Local rules are inputs, never assumed:** zoning values, and Bangladesh project rules (Private Residential Land Development Rules 2004), whose numbers could not be verified online.
- **Scope:** this is a yield study. Street curves, intersections, cul-de-sacs, grading and utilities are not laid out.

**Landscape**
- **Plant counts:** triangular spacing uses an area of 0.866s² per plant, a geometric identity.
- **Water budget:** the California Model Water Efficient Landscape Ordinance (MWELO) equations and factors, read from 23 CCR ch. 2.7 Appendix A. The regulation has no numerical example, so the tests are hand-computed.
- **Sprinkler precipitation rate:** the 96.3 factor is unit conversion (1 gpm on 1 ft² for an hour = 96.25 in).

### Cost estimates and schedules: `estimate.ts`, `schedule.ts`

- **Cost estimate:** amount = quantity × rate. Overhead, profit, contingency and taxes are applied on the running total and rounded to 2 decimals per line. Rates are never filled in by the software.
- **Schedule:** critical path method (CPM) with FS/SS/FF/SF links and lags, calendars for Bangladesh and US weekends, and holidays. Milestones take their predecessor's finish date.
- **Tests:** a hand-computed textbook network and a precedence network with lags.
- **Excel export:** the workbook formulas are recalculated independently by LibreOffice and match the engine exactly.

### Quantities and units

- **Concrete:**
  - Ratio or grade, input in cft or m³.
  - Dry volume factor 1.54.
  - Cement taken as 1440 kg/m³ in 50 kg bags.
- **Bricks:** the Bangladesh standard brick, 9.5 × 4.5 × 2.75 in, which gives 11.5 bricks per cft.
- **Land units:** 1 katha = 720 sft exactly; 1 decimal = 435.6 sft.
- **Rebar weight:** d²/162 kg/m.

### Code library (`codes.ts`)

**BNBC entries: checked against the gazette in September 2026.** The six entries are live loads, seismic zones, wind speeds, concrete design basis, presumptive bearing capacity, and room sizes with the Dhaka rules. All six had errors before the check. The main corrections:

- Mymensingh is in Zone 4 (Z = 0.36).
- An ordinary flat roof carries 1.00 kN/m².
- The presumptive bearing values of Table 6.3.7 are single values from 50 to 440 kPa.
  - The values for sand and gravel are halved when the water table is high.
  - The table applies only to buildings of two storeys or less.
- The minimum footing depth is 1.5 m in cohesive soil and 2 m in cohesionless soil.

**Entries for other countries have not yet been checked against the published codes.** These are the IS, ACI/ASCE, GB, BCP, Nepal NBC and Eurocode entries. They are short summaries, and each needs a check before it is relied on.

## What the reviewing engineer should check

1. **The BNBC values in `rcCode.ts` and the tables above**, against your copy of BNBC 2020. We read them from the gazette, but a second reading is the point of this review.
2. **The assumptions a practising engineer might set differently:**
   - the 10% allowance for footing self-weight
   - the conservative default of single curvature for column end moments
   - the dry volume factor of 1.54
   - the brick size and mortar allowances
3. **The things these calculators deliberately do not do:**
   - frame analysis
   - sway-frame second-order analysis
   - seismic detailing (special moment frames, BNBC Ch. 8)
   - torsion
   - two-way slabs
   - eccentric or combined footings
   - pile design
   - crack width
   - long-term deflection

   The tools refuse, or say so plainly, when asked to do these.
4. **Spot-check 5 to 10 real project designs** from your office against CivilMate's output. Send any disagreement to the developers with the inputs.

**Signed off by (name, licence no., date):** ______________________
