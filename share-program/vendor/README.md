# Vendored QR generator

`qrcodegen-v1.8.0.js` is the unmodified ES2015 JavaScript build from Project Nayuki's QR Code Generator v1.8.0 release. Its MIT license and copyright notice are retained in the file header.

- Documentation and API: https://www.nayuki.io/page/qr-code-generator-library
- Release: https://github.com/nayuki/QR-Code-generator/releases/tag/v1.8.0
- Original file: https://github.com/nayuki/QR-Code-generator/releases/download/v1.8.0/qrcodegen-v1.8.0-es6.js
- SHA-256: `6a1116192ed1dd67fa1bf31e77f5817103d71c23bbac24c382e698b7668bdd01`

The clinic tool uses `QrCode.encodeText(url, QrCode.Ecc.MEDIUM)` and `getModule(x, y)` to draw an SVG with a four-module white quiet zone. It encodes only maintained canonical public program URLs. The browser does not fetch a CDN, generate a remote QR image, or submit the selected program to a service. The tool uses no patient fields or local storage.

The surrounding site continues to use its shared navigation and path-only page analytics. Choice, copy, QR generation, and card print do not emit analytics events.
