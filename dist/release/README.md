# Releases

Each folder is one release of Beethoven for VS Code (Ashley for VS Code up to 3.0.0): its changelog,
agreements, privacy statement, third-party notices, `SHA256SUMS` and `SHA256SUMS.sig`.

The packages of 2.0.0, 3.0.0 and 4.0.0 (`ashley-2.0.0.vsix`, `ashley-3.0.0.vsix`,
`beethoven-4.0.0.vsix`, and their copies in `dist/`) were withdrawn on 2026-10-04 because they ask for
an Anthropic API key, and Beethoven uses no API key anywhere. Do not install them, nor Ashley for VS
Code 3.0.0 from the Marketplace. Their records stay here as they were released; the signed checksums
still name the package, which only the repository's history before that day holds, for checking a
copy that is already out there, never for installing it (`verify-release` on one of these folders
needs that package put back beside the records first).

The next package is 5.0.0, `5.0.0/beethoven-5.0.0.vsix`, built and signed by the maintainer with
`tools/release.mjs` (`docs/LICENSING.md`). Until it is here there is no package to install from this
repository.
