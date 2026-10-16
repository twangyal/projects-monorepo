# Coupled membrane swatches (#268)

User outcome: compare warp, weft and bias-cut in-plane material response, including contraction/shear, before integrating a defensible material law into garments. The current independent axial and bending strips cannot supply this. Follow research256; preserve the full professional cloth destination and ACTIVE status.

## Decision

Use a small SI constant-strain triangle finite-element solve rather than an analytical drawing (which cannot test assembly) or immediate garment-engine replacement (which confounds material, timestep and contact). Two repository-authored illustrative stable orthotropic profiles have density kg/m² and C11/C22/C12/G12 N/m. Energy per rest area is 0.5*(C11*e1²+2*C12*e1*e2+C22*e2²+G12*gamma12²). Engineering gamma is twice tensor shear. Rotate the strain basis from fixed flat material coordinates; visual print orientation is unrelated.

A 5–50cm rectangle,0–2N total axial force,0/45/90degree grain,4/8 cells per side and either diagonal. Uniform right-edge x traction uses half nodal end weights. All left-edge x displacements are zero; only bottom-left y is fixed. Thus the left edge can contract; this is not a fully clamped grip. Other edges are traction-free. Assemble area*B^T*C*B, eliminate fixed DOFs, solve with partial pivoting and recompute internal forces/energy from original assembly. At most162 total DOFs. No physical timestep or thickness factor: C is already a membrane resultant coefficient.

Profiles: compliant density.18,C11=200,C22=100,C12=20,G12=40; firm density.32,C11=1200,C22=600,C12=60,G12=200. Values are invented demonstrations, not measured fabrics. Require positive density/C11/C22/G12 and C11*C22>C12². Reject nonfinite values and supported-range violations; refuse analytical uniform-traction global/material normal or engineering shear strain above10%, with only8*machine-epsilon relative equality allowance. No silent clamping.

## Flow and boundaries

Body & drape gets a collapsed independent Membrane swatch comparison. Inputs, Compare/Cancel/Retry and current-input-only JSON mirror the existing owned-worker labs. Render actual undeformed/deformed triangular meshes on one shared physical scale for both profiles; show displacement, contraction/shear, mass, energy and residual. JSON retains complete inputs/profiles, units, rest mesh, displacements, per-element strains/stress resultants, energy, reactions and free-force residual.

No garment solver, schema, save/history or dependencies change. Generic independent-experiment ownership marker preserves garment drafts and pending asset/import authority. Input changes, explicit cancel and pagehide retire workers and late replies; navigation preserves fields. No gravity, bending, dynamics, buckling, contact, nonlinear cloth or fit claim.

## Evidence

Independent uniform-stress compliance supplies strain/displacement and energy oracles at0/90/45degree grain. Verify triangle pure-shear energy, rigid infinitesimal rotation/translation, coupling positivity, force balance, mass/density/geometry independence,4/8cells and both diagonals. These affine patch checks establish assembly consistency, not general nonuniform convergence or physical cloth validity. Native desktop/phone export/mesh, exact backup/raw drafts and actual held-worker/asset races; full project checks, source/main CI and independent review. Preserve failures and unavailable physical evidence. Source background: MIT16.20 Paul Lagace2002 Unit6 plane stress/strain; the membrane normalization and chosen coefficients are derived here, not copied specimen data.
