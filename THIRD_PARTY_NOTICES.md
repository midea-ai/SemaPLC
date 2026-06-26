# Third-Party Notices

**Sema PLC** (this repository — `sema-plc-web` + `sema-plc-tools`) is released under the
[MIT License](./LICENSE). It depends on the third-party software listed below. Each
component is licensed under its own terms; the original copyright notices and license
texts ship with the corresponding package/source and remain authoritative.

## How Sema PLC uses copyleft (GPL/LGPL) components

Sema PLC's PLC compile/check toolchain is **GPL/LGPL**, but Sema PLC does **not** link to
it or bundle its source in this repository. The toolchain is:

- **invoked as separate command-line processes** (`docker exec … iec2c` / `iec2iec` /
  `plc --check`, and the OpenPLC runtime over its REST API), i.e. arm's-length process
  invocation, which is *mere aggregation* — not a derivative work; and
- **fetched / built at Docker image build time** by `sema-plc-tools/runtime/Dockerfile.plc-dev`
  (matiec downloaded from its release, rusty built from source, OpenPLC built from source),
  so this repository ships only Sema PLC's own MIT code plus a Dockerfile that obtains them.

Because of this, the GPL/LGPL terms of those tools do **not** extend to Sema PLC's own
source, which is therefore MIT. See [GNU's guidance on aggregation](https://www.gnu.org/licenses/gpl-faq.html#MereAggregation).

> **Redistributing the built Docker image.** The image produced by the Dockerfile bundles
> the matiec (GPLv3), rusty (LGPL-3.0) and OpenPLC (GPLv3) binaries. Anyone who redistributes
> that image must comply with those licenses *for those binaries* (carry their license texts
> and provide/point to the corresponding source). All sources are public (links below) and
> the Dockerfile builds/downloads from them, so the source-availability obligation is readily
> met. This obligation falls on the image's redistributor, not on Sema PLC's source.

## Build / runtime toolchain (separate binaries, built into the Docker image)

| Component | License | Used as | Source |
| --- | --- | --- | --- |
| **matiec** (`iec2c`, `iec2iec`) | **GPL-3.0** | IEC 61131-3 → C compiler; called via `docker exec` | https://github.com/Autonomy-Logic/matiec |
| **rusty** (`plc`) | **LGPL-3.0** | ST syntax/semantic checker (`plc --check`); called via `docker exec` | https://github.com/PLC-lang/rusty |
| **OpenPLC Runtime** | **GPL-3.0** | PLC execution runtime; called over REST API | https://github.com/autonomy-logic/openplc-runtime |
| **xml2st** | per upstream | debug/glue generation tool (optional) | https://github.com/Autonomy-Logic/xml2st |

> matiec applies a runtime-library exception to its generated output, so compiled PLC
> programs produced via `iec2c` are not themselves GPL-licensed.

## Bundled / embedded code (permissive)

| Component | License | How it is included | Source |
| --- | --- | --- | --- |
| **sema-core** | MIT | vendored tarball `sema-plc-web/vendor/sema-core-2.0.5.tgz`, installed via a `file:` dependency | https://github.com/midea-ai/sema-code-core |
| **ladder-logic-editor** | MIT | lifted into `sema-plc-web/src/{lang,models,transformer,ladder-nodes}/` (see `sema-plc-web/LICENSE`) | https://github.com/cdilga/ladder-logic-editor |

## npm dependencies

Both packages' runtime/dev dependencies are resolved from the npm registry under permissive
licenses (MIT / ISC / BSD / Apache-2.0 / BlueOak-1.0.0 / 0BSD). The authoritative license
text for each ships in `node_modules/<package>/LICENSE`; resolved versions are pinned in each
package's `package-lock.json` for reproducible installs and license traceability.
