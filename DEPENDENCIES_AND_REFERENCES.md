# Dependency and external-reference inventory — private draft

This note covers only the exact 179 source files in `SOURCE_SELECTION.json`. It is a static source inventory, not a build lock, dependency license clearance, fetched-data grant, or runnable server claim. No external package, PDF, dataset, model weight, credential, or other server module is bundled in this draft.

## Direct imports

The TypeScript parser reported zero syntax diagnostics in the 179 files. A static import/export/literal-require pass found 943 relative import occurrences in 173 files and 226 bare import occurrences. Of the bare occurrences, 169 use first-party `@shared/` aliases that are not supplied in this isolated draft. The explicitly named third-party modules are `zod` (47 occurrences), `pdfjs-dist/legacy/build/pdf.mjs` (two occurrences), `express`, `fast-glob`, `node-fetch`, and `pg` (one each). Node built-ins are referenced separately. This pass saw no nonliteral `import()` or `require()` call, but does not establish that all runtime loading or transitive dependencies are known.

The earlier source-partition AST review counted 676 static relative references unresolved within the 550-file parent selection, before this narrower draft. It also counted 327 bare imports with a broader syntax collection; that count and this narrower 226-occurrence inventory are not directly comparable. Accordingly, even the source files with only relative imports cannot be assumed to build independently. Obtain first-party dependencies from their separately reviewed source selections and external packages under their own terms. This draft does not license or redistribute those packages.

## Citations, data, and operational assumptions

A bounded sweep found 136 `http(s)`-shaped strings. These primarily name arXiv papers and public reference sites, with some local loopback addresses. The draft includes no fetched paper, PDF, agency dataset, web response, game asset, or observation. URL strings are references, not evidence that an external source was obtained, is current, or may be redistributed. Live-source, diplomacy, theory, and scientific handlers have operational and provenance requirements outside this source selection.

The code includes GR/warp research and diagnostic logic. Its source visibility does not run a Casimir verification, satisfy HARD constraints, establish an `ADMISSIBLE` viability result, certify a proof, or imply physical propulsion or transport. Exact first-party rights, copied-content review, final dependency terms/notices, security review, and a separate Public exposure decision remain open.
