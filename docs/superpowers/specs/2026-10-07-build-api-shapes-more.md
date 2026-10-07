# Build API shapes: PDF/UA, compress, flatten, rotate, protect, convert — verified behaviour

**Date:** 2026-10-07
**Method:** every shape below was validated with the free no-file probe (see
`2026-09-16-build-api-shapes.md`) **and run for real once** on both backends —
hosted DWS (`https://api.nutrient.io/build`, Processor key) and a local Document Engine
(`pspdfkit/document-engine:latest` via `docker/document-engine/up.sh`). Outputs were checked
with `pdfinfo`, `pdftotext` and `qpdf`, tools outside the system under test. The two
backends agreed on every result below, down to near-identical output sizes.

Fixtures were made locally, not by the engine: a one-page PDF with body text, a filled
AcroForm text field and a FreeText annotation; a minimal `.docx`; a small PNG; and a 600×600
noise PNG converted to PDF (718 KB) to give compression something to work on.

## Validation is real for these fields

Both backends reject out-of-range values with a precise `failingPaths` entry, so these are
read, not ignored (contrast the engine's silent acceptance of unknown names):

| Field | Rejected value | Message |
| --- | --- | --- |
| `actions[].rotateBy` | `45` | must be 90, 180 or 270 |
| `output.optimize.imageOptimizationQuality` | `9` / `0` | must be ≤ 4 / ≥ 1 (reported as `image_optimization_quality`) |
| `output.user_permissions` | `["nonsense"]` | is invalid |

## Shapes, with what the real run proved

| Operation | Instructions beyond `parts` | Proven by |
| --- | --- | --- |
| PDF/UA | `actions: []`, `output: {type: "pdfua"}` | `pdfinfo` Tagged: yes; `pdfuaid` present; form `/V` kept (gains `/AP`) |
| Compress | `output: {type: "pdf", optimize: {imageOptimizationQuality: 1-4, mrcCompression?: true}}` | 718 KB → q4 187 KB, q1 35 KB, **q1 + MRC 22 KB** |
| Flatten | `actions: [{type: "flatten"}]` | widget + FreeText annotations 2 → 0; their text stays on the page |
| Rotate | `actions: [{type: "rotate", rotateBy: 90\|180\|270}]` | `pdfinfo` page rot: 90 |
| Protect | `output: {type: "pdf", user_password, owner_password, user_permissions: [...]}` | opens only with the user password; `qpdf --show-encryption` lists exactly the granted permissions |
| Convert to PDF | `actions: []`, `output: {type: "pdf"}` with a `.docx` / `.png` part | `.docx` text extracted from the output; PNG becomes one page |

Permission names accepted by both: `printing`, `modification`, `extract`,
`annotations_and_forms`, `fill_forms`, `extract_accessibility`, `assemble`,
`print_high_quality`. `printing` alone maps to *low-resolution* print only.

## Two findings that change the design

- **Linearization does not happen.** `output.optimize.linearize: true` is accepted on both
  backends and ignored: a 12-page output is "not linearized" per `qpdf
  --check-linearization`. Worse, **any `optimize` block recompresses images, lossily, even
  with no quality given** (720 KB → 60 KB with `{linearize: true}` alone). A "fast web view"
  option would therefore silently degrade images while not linearizing. Not offered.
- **Input type is sniffed, not trusted.** A `.docx` uploaded with
  `Content-Type: application/pdf` converts exactly like a correctly labelled one, on both
  backends. Sending the real type is still correct, but mislabelling was not why Office
  input failed to be offered.

## Not covered here

Merge, split and data extraction need a job shape other than one-in/one-out. PDF → Office
output was not pursued: the result is not something the viewer is guaranteed to open.
